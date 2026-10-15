DO $migration$
BEGIN
    IF to_regclass('public.users') IS NULL
       OR to_regclass('public.bakeries') IS NULL
       OR to_regclass('auth.sessions') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL
       OR to_regprocedure('private.lock_and_validate_operator_bakeries(uuid[])') IS NULL THEN
        RAISE EXCEPTION
            'Operator session revocation requires the established profile, bakery, session, authorization, and operator validation objects';
    END IF;
END;
$migration$;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;

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
        JOIN public.bakeries AS b
            ON b.id = u.bakery_id
        WHERE u.id = (SELECT auth.uid())
          AND u.role = 'cashier'
          AND u.active IS TRUE
          AND b.active = true
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

ALTER FUNCTION private.is_cashier()
    OWNER TO postgres;

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

    PERFORM private.lock_and_validate_operator_bakeries(
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

    RETURN v_revoked_user_id;
END;
$function$;

ALTER FUNCTION public.revoke_operator_sessions(uuid, uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.revoke_operator_sessions(uuid, uuid)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.revoke_operator_sessions(uuid, uuid)
    TO authenticated;
