-- Migration: gestão de operadores pelo proprietário sem travas de caixa/estoque
-- 1. Restaura a validação de `sessions_revoked_at` em private.is_cashier() e em
--    private.assert_active_operator_write (a migration de múltiplas unidades
--    sobrescreveu as duas funções e removeu a checagem de sessão revogada).
-- 2. Cria private.lock_operator_bakeries(): trava as unidades sem as travas
--    de negócio (caixa aberto / estoque zerado), usadas pelas RPCs administrativas.
-- 3. update_operator_profile, update_operator_profile_with_email,
--    validate_operator_profile_update, deactivate_operator e
--    revoke_operator_sessions passam a usar a trava administrativa.
-- 4. deactivate_operator passa a revogar as sessões do operador desativado.

DO $migration$
BEGIN
    IF to_regclass('public.users') IS NULL
       OR to_regclass('public.bakeries') IS NULL
       OR to_regclass('auth.sessions') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL THEN
        RAISE EXCEPTION
            'Operator administration requires the established user, bakery, session, and authorization objects';
    END IF;
END;
$migration$;

-- 1. private.is_cashier(): volta a considerar as sessões revogadas.
CREATE OR REPLACE FUNCTION private.is_cashier()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.users AS u
        JOIN public.user_bakeries AS ub ON ub.user_id = u.id
        JOIN public.bakeries AS b ON b.id = ub.bakery_id
        WHERE u.id = (SELECT auth.uid())
          AND u.role = 'cashier'
          AND u.active IS TRUE
          AND b.active = TRUE
          AND (
              u.sessions_revoked_at IS NULL
              OR EXISTS (
                  SELECT 1
                  FROM auth.sessions AS auth_session
                  WHERE auth_session.id::text = (SELECT auth.jwt() ->> 'session_id')
                    AND auth_session.user_id = u.id
                    AND auth_session.created_at > u.sessions_revoked_at
              )
          )
    );
$function$;

ALTER FUNCTION private.is_cashier() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.is_cashier() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_cashier() TO authenticated;

-- 2. private.assert_active_operator_write(): volta a exigir sessão válida.
CREATE OR REPLACE FUNCTION private.assert_active_operator_write(
    p_user_id uuid,
    p_bakery_id uuid,
    p_allow_owner boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_role text;
    v_user_active boolean;
    v_user_bakery_id uuid;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN;
    END IF;

    SELECT u.role, u.active, u.bakery_id
    INTO v_role, v_user_active, v_user_bakery_id
    FROM public.users AS u
    WHERE u.id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The authenticated profile does not exist'
            USING ERRCODE = '42501';
    END IF;

    IF v_role = 'owner' AND p_allow_owner IS TRUE THEN
        RETURN;
    END IF;

    IF v_role IS DISTINCT FROM 'cashier'
       OR v_user_active IS DISTINCT FROM true
       OR v_user_bakery_id IS DISTINCT FROM p_bakery_id
       OR NOT (SELECT private.is_cashier())
       OR NOT EXISTS (
            SELECT 1
            FROM public.bakeries AS bakery
            WHERE bakery.id = p_bakery_id
              AND bakery.active = true
       ) THEN
        RAISE EXCEPTION 'An active operator with a current session assigned to this bakery is required'
            USING ERRCODE = '42501';
    END IF;
END;
$function$;

ALTER FUNCTION private.assert_active_operator_write(uuid, uuid, boolean)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION private.assert_active_operator_write(uuid, uuid, boolean)
    FROM PUBLIC, anon, authenticated;

-- 3. private.lock_operator_bakeries(): trava as unidades do operador sem as
--    travas de negócio (caixa aberto / estoque zerado). Usada pelas RPCs
--    administrativas, que devem funcionar mesmo com caixa aberto e estoque.
CREATE OR REPLACE FUNCTION private.lock_operator_bakeries(
    p_bakery_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_bakery_id uuid;
    v_bakery_ids uuid[];
BEGIN
    SELECT array_agg(requested.bakery_id ORDER BY requested.bakery_id)
    INTO v_bakery_ids
    FROM (
        SELECT DISTINCT requested_bakery.bakery_id
        FROM unnest(p_bakery_ids) AS requested_bakery(bakery_id)
        WHERE requested_bakery.bakery_id IS NOT NULL
    ) AS requested;

    IF COALESCE(cardinality(v_bakery_ids), 0) = 0 THEN
        RAISE EXCEPTION 'At least one operator bakery is required'
            USING ERRCODE = '22023';
    END IF;

    FOREACH v_bakery_id IN ARRAY v_bakery_ids
    LOOP
        PERFORM 1
        FROM public.bakeries AS bakery
        WHERE bakery.id = v_bakery_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'The operator bakery does not exist'
                USING ERRCODE = '23503';
        END IF;
    END LOOP;
END;
$function$;

ALTER FUNCTION private.lock_operator_bakeries(uuid[])
    OWNER TO postgres;

REVOKE ALL ON FUNCTION private.lock_operator_bakeries(uuid[])
    FROM PUBLIC, anon, authenticated;

-- 4. private.revoke_operator_sessions_internal(): encerra de fato as sessões
--    do operador (deleta as sessões do Auth) e marca a revogação, para que
--    private.is_cashier() reprove a sessão e o operador seja desconectado.
CREATE OR REPLACE FUNCTION private.revoke_operator_sessions_internal(
    p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    UPDATE public.users
    SET sessions_revoked_at = clock_timestamp()
    WHERE id = p_user_id;

    DELETE FROM auth.sessions
    WHERE user_id = p_user_id;
END;
$function$;

ALTER FUNCTION private.revoke_operator_sessions_internal(uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION private.revoke_operator_sessions_internal(uuid)
    FROM PUBLIC, anon, authenticated;

-- 5. RPCs administrativas: travas de caixa/estoque removidas.
--    A administração de operadores é uma ação do proprietário e não pode ser
--    bloqueada por caixa aberto ou estoque em andamento. As proteções das
--    ações do próprio operador (RLS e private.assert_active_operator_write)
--    permanecem intactas.

-- 5a. public.validate_operator_profile_update
CREATE OR REPLACE FUNCTION public.validate_operator_profile_update(
    p_user_id uuid,
    p_bakery_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_role text;
    v_user_active boolean;
    v_current_bakery_id uuid;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an authenticated owner may validate an operator update'
            USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL OR p_bakery_id IS NULL THEN
        RAISE EXCEPTION 'An operator and destination bakery are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT target_user.role, target_user.active, target_user.bakery_id
    INTO v_user_role, v_user_active, v_current_bakery_id
    FROM public.users AS target_user
    WHERE target_user.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator does not exist'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_user_role IS DISTINCT FROM 'cashier' THEN
        RAISE EXCEPTION 'Owner profiles cannot be changed as operators'
            USING ERRCODE = '42501';
    END IF;

    IF v_user_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Inactive operators cannot be changed'
            USING ERRCODE = '42501';
    END IF;

    IF v_current_bakery_id IS NULL THEN
        RAISE EXCEPTION 'The operator has no assigned bakery'
            USING ERRCODE = '23514';
    END IF;

    PERFORM private.lock_operator_bakeries(
        ARRAY[v_current_bakery_id, p_bakery_id]::uuid[]
    );

    RETURN p_user_id;
END;
$function$;

ALTER FUNCTION public.validate_operator_profile_update(uuid, uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.validate_operator_profile_update(uuid, uuid)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.validate_operator_profile_update(uuid, uuid)
    TO authenticated;

-- 5b. public.update_operator_profile
CREATE OR REPLACE FUNCTION public.update_operator_profile(
    p_user_id uuid,
    p_name text,
    p_bakery_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_role text;
    v_user_active boolean;
    v_current_bakery_id uuid;
    v_updated_user_id uuid;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an authenticated owner may update an operator'
            USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL
       OR p_bakery_id IS NULL
       OR p_name IS NULL
       OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'An operator, non-empty name, and destination bakery are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT target_user.role, target_user.active, target_user.bakery_id
    INTO v_user_role, v_user_active, v_current_bakery_id
    FROM public.users AS target_user
    WHERE target_user.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator does not exist'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_user_role IS DISTINCT FROM 'cashier' THEN
        RAISE EXCEPTION 'Owner profiles cannot be changed as operators'
            USING ERRCODE = '42501';
    END IF;

    IF v_user_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Inactive operators cannot be changed'
            USING ERRCODE = '42501';
    END IF;

    IF v_current_bakery_id IS NULL THEN
        RAISE EXCEPTION 'The operator has no assigned bakery'
            USING ERRCODE = '23514';
    END IF;

    PERFORM private.lock_operator_bakeries(
        ARRAY[v_current_bakery_id, p_bakery_id]::uuid[]
    );

    UPDATE public.users
    SET name = btrim(p_name),
        bakery_id = p_bakery_id
    WHERE id = p_user_id
      AND role = 'cashier'
      AND active IS TRUE
    RETURNING id INTO v_updated_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator profile changed before the update completed'
            USING ERRCODE = '40001';
    END IF;

    -- Trocar a unidade do operador invalida as sessões existentes: as
    -- permissões da sessão antiga apontam para a unidade anterior.
    IF v_current_bakery_id IS DISTINCT FROM p_bakery_id THEN
        PERFORM private.revoke_operator_sessions_internal(p_user_id);
    END IF;

    RETURN v_updated_user_id;
END;
$function$;

ALTER FUNCTION public.update_operator_profile(uuid, text, uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_operator_profile(uuid, text, uuid)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_operator_profile(uuid, text, uuid)
    TO authenticated;

-- 5c. public.update_operator_profile_with_email
CREATE OR REPLACE FUNCTION public.update_operator_profile_with_email(
    p_user_id uuid,
    p_name text,
    p_email text,
    p_bakery_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_role text;
    v_user_active boolean;
    v_current_bakery_id uuid;
    v_current_email text;
    v_updated_user_id uuid;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an authenticated owner may update an operator'
            USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL
       OR p_bakery_id IS NULL
       OR p_name IS NULL
       OR btrim(p_name) = ''
       OR p_email IS NULL
       OR btrim(p_email) = '' THEN
        RAISE EXCEPTION 'An operator, non-empty name and email, and destination bakery are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT target_user.role, target_user.active, target_user.bakery_id, target_user.email
    INTO v_user_role, v_user_active, v_current_bakery_id, v_current_email
    FROM public.users AS target_user
    WHERE target_user.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator does not exist'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_user_role IS DISTINCT FROM 'cashier' THEN
        RAISE EXCEPTION 'Owner profiles cannot be changed as operators'
            USING ERRCODE = '42501';
    END IF;

    IF v_user_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Inactive operators cannot be changed'
            USING ERRCODE = '42501';
    END IF;

    IF v_current_bakery_id IS NULL THEN
        RAISE EXCEPTION 'The operator has no assigned bakery'
            USING ERRCODE = '23514';
    END IF;

    PERFORM private.lock_operator_bakeries(
        ARRAY[v_current_bakery_id, p_bakery_id]::uuid[]
    );

    UPDATE public.users
    SET name = btrim(p_name),
        email = lower(btrim(p_email)),
        bakery_id = p_bakery_id
    WHERE id = p_user_id
      AND role = 'cashier'
      AND active IS TRUE
    RETURNING id INTO v_updated_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator profile changed before the update completed'
            USING ERRCODE = '40001';
    END IF;

    -- Mudança de credencial (e-mail) ou de unidade invalida as sessões
    -- abertas do operador em qualquer dispositivo.
    IF v_current_email IS DISTINCT FROM lower(btrim(p_email))
       OR v_current_bakery_id IS DISTINCT FROM p_bakery_id THEN
        PERFORM private.revoke_operator_sessions_internal(p_user_id);
    END IF;

    RETURN v_updated_user_id;
END;
$function$;

ALTER FUNCTION public.update_operator_profile_with_email(uuid, text, text, uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_operator_profile_with_email(uuid, text, text, uuid)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_operator_profile_with_email(uuid, text, text, uuid)
    TO authenticated;
-- 5d. public.deactivate_operator: desativa o operador, encerra todas as
--     sessões dele e não exige caixa fechado nem estoque zerado.
CREATE OR REPLACE FUNCTION public.deactivate_operator(
    p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_role text;
    v_bakery_id uuid;
    v_deactivated_user_id uuid;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an authenticated owner may deactivate an operator'
            USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'An operator is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT target_user.role, target_user.bakery_id
    INTO v_user_role, v_bakery_id
    FROM public.users AS target_user
    WHERE target_user.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator does not exist'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_user_role IS DISTINCT FROM 'cashier' THEN
        RAISE EXCEPTION 'Owner profiles cannot be deactivated as operators'
            USING ERRCODE = '42501';
    END IF;

    IF v_bakery_id IS NULL THEN
        RAISE EXCEPTION 'The operator has no assigned bakery'
            USING ERRCODE = '23514';
    END IF;

    PERFORM private.lock_operator_bakeries(
        ARRAY[v_bakery_id]::uuid[]
    );

    UPDATE public.users
    SET active = false
    WHERE id = p_user_id
      AND role = 'cashier'
    RETURNING id INTO v_deactivated_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator profile changed before deactivation completed'
            USING ERRCODE = '40001';
    END IF;

    -- Desativar o operador encerra as sessões abertas em qualquer dispositivo.
    PERFORM private.revoke_operator_sessions_internal(p_user_id);

    RETURN v_deactivated_user_id;
END;
$function$;

ALTER FUNCTION public.deactivate_operator(uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.deactivate_operator(uuid)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.deactivate_operator(uuid)
    TO authenticated;

-- 5e. public.revoke_operator_sessions: encerra as sessões do operador sem
--     as travas de caixa/estoque.
CREATE OR REPLACE FUNCTION public.revoke_operator_sessions(
    p_user_id uuid,
    p_bakery_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_role text;
    v_user_active boolean;
    v_current_bakery_id uuid;
    v_revoked_user_id uuid;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an authenticated owner may revoke operator sessions'
            USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL OR p_bakery_id IS NULL THEN
        RAISE EXCEPTION 'An operator and destination bakery are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT target_user.role, target_user.active, target_user.bakery_id
    INTO v_user_role, v_user_active, v_current_bakery_id
    FROM public.users AS target_user
    WHERE target_user.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator does not exist'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_user_role IS DISTINCT FROM 'cashier' THEN
        RAISE EXCEPTION 'Owner profiles cannot have operator sessions revoked'
            USING ERRCODE = '42501';
    END IF;

    IF v_user_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Inactive operators cannot be changed'
            USING ERRCODE = '42501';
    END IF;

    IF v_current_bakery_id IS NULL THEN
        RAISE EXCEPTION 'The operator has no assigned bakery'
            USING ERRCODE = '23514';
    END IF;

    PERFORM private.lock_operator_bakeries(
        ARRAY[v_current_bakery_id, p_bakery_id]::uuid[]
    );

    UPDATE public.users
    SET sessions_revoked_at = clock_timestamp()
    WHERE id = p_user_id
      AND role = 'cashier'
      AND active IS TRUE
    RETURNING id INTO v_revoked_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator changed before session revocation completed'
            USING ERRCODE = '40001';
    END IF;

    -- Encerra de fato as sessões do Auth (multi-dispositivo).
    DELETE FROM auth.sessions
    WHERE user_id = p_user_id;

    RETURN v_revoked_user_id;
END;
$function$;

ALTER FUNCTION public.revoke_operator_sessions(uuid, uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.revoke_operator_sessions(uuid, uuid)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.revoke_operator_sessions(uuid, uuid)
    TO authenticated;

-- 6. public.operator_session_status(): o operador consulta periodicamente
--    para saber se a sessão ainda é válida (usuário ativo e sessão não
--    revogada). Retorna false quando o operador foi desativado ou teve as
--    credenciais alteradas pelo proprietário, encerrando a sessão em todos
--    os dispositivos. O proprietário nunca é invalidado por esta verificação.
CREATE OR REPLACE FUNCTION public.operator_session_status()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT CASE
        WHEN (SELECT u.role FROM public.users AS u WHERE u.id = (SELECT auth.uid())) = 'owner' THEN
            true
        ELSE EXISTS (
            SELECT 1
            FROM public.users AS u
            JOIN auth.sessions AS auth_session
                ON auth_session.id::text = (SELECT auth.jwt() ->> 'session_id')
            WHERE u.id = (SELECT auth.uid())
              AND u.role = 'cashier'
              AND u.active IS TRUE
              AND (
                  u.sessions_revoked_at IS NULL
                  OR auth_session.created_at > u.sessions_revoked_at
              )
        )
    END;
$function$;

ALTER FUNCTION public.operator_session_status()
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.operator_session_status()
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.operator_session_status()
    TO authenticated;
