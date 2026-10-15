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

    PERFORM private.lock_and_validate_operator_bakeries(
        ARRAY[v_current_bakery_id, p_bakery_id]::uuid[]
    );

    RETURN p_user_id;
END;
$function$;

ALTER FUNCTION public.validate_operator_profile_update(uuid, uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.validate_operator_profile_update(uuid, uuid)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validate_operator_profile_update(uuid, uuid)
    TO authenticated;

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

    PERFORM private.lock_and_validate_operator_bakeries(
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

    RETURN v_updated_user_id;
END;
$function$;

ALTER FUNCTION public.update_operator_profile_with_email(uuid, text, text, uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_operator_profile_with_email(uuid, text, text, uuid)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_operator_profile_with_email(uuid, text, text, uuid)
    TO authenticated;
