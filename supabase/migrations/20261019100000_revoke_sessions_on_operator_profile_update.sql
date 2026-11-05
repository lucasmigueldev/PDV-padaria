-- Migration: revoga as sessões do operador em qualquer alteração de perfil
-- A migration 20261019000000 só revogava as sessões quando o e-mail ou a
-- unidade do operador mudavam. Renomear o operador (sem trocar e-mail ou
-- unidade) deixava a sessão antiga válida, contrariando o objetivo de que
-- qualquer alteração administrativa de perfil encerre as sessões abertas em
-- todos os dispositivos.
--
-- Esta migration redefine public.update_operator_profile para revogar as
-- sessões sempre que o nome ou a unidade do operador mudarem. As travas de
-- negócio (caixa aberto / estoque) continuam ignoradas: a administração de
-- operadores é uma ação do proprietário.

DO $migration$
BEGIN
    IF to_regclass('public.users') IS NULL
       OR to_regclass('public.bakeries') IS NULL
       OR to_regclass('auth.sessions') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.revoke_operator_sessions_internal(uuid)') IS NULL
       OR to_regprocedure('private.lock_operator_bakeries(uuid[])') IS NULL THEN
        RAISE EXCEPTION
            'Operator session revocation on profile update requires the established user, bakery, session, and authorization objects';
    END IF;
END;
$migration$;

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
    v_current_name text;
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

    SELECT target_user.role, target_user.active, target_user.bakery_id, target_user.name
    INTO v_user_role, v_user_active, v_current_bakery_id, v_current_name
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

    -- Qualquer alteração de perfil (nome ou unidade) invalida as sessões
    -- existentes: o operador precisa entrar novamente com as credenciais
    -- atuais em todos os dispositivos.
    IF v_current_bakery_id IS DISTINCT FROM p_bakery_id
       OR v_current_name IS DISTINCT FROM btrim(p_name) THEN
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

-- public.update_operator_profile_with_email: revoga as sessões também quando
-- apenas o nome do operador muda (antes, só a troca de e-mail ou de unidade
-- invalidava as sessões).
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
    v_current_name text;
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

    SELECT target_user.role, target_user.active, target_user.bakery_id, target_user.email, target_user.name
    INTO v_user_role, v_user_active, v_current_bakery_id, v_current_email, v_current_name
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

    -- Mudança de credencial (e-mail), de nome ou de unidade invalida as
    -- sessões abertas do operador em qualquer dispositivo.
    IF v_current_email IS DISTINCT FROM lower(btrim(p_email))
       OR v_current_bakery_id IS DISTINCT FROM p_bakery_id
       OR v_current_name IS DISTINCT FROM btrim(p_name) THEN
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