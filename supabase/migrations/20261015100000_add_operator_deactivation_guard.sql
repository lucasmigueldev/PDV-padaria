DO $migration$
BEGIN
    IF to_regclass('public.users') IS NULL
       OR to_regclass('public.bakeries') IS NULL
       OR to_regclass('public.cash_registers') IS NULL
       OR to_regclass('public.products') IS NULL
       OR to_regclass('public.product_stock') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL THEN
        RAISE EXCEPTION
            'Operator administration requires the established user, bakery, cash register, product, stock, and authorization objects';
    END IF;
END;
$migration$;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

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
       OR NOT EXISTS (
            SELECT 1
            FROM public.bakeries AS bakery
            WHERE bakery.id = p_bakery_id
              AND bakery.active = true
       ) THEN
        RAISE EXCEPTION 'An active operator assigned to this bakery is required'
            USING ERRCODE = '42501';
    END IF;
END;
$function$;

ALTER FUNCTION private.assert_active_operator_write(uuid, uuid, boolean)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION private.assert_active_operator_write(uuid, uuid, boolean)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.lock_and_validate_operator_bakeries(
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
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Operator administration requires READ COMMITTED isolation'
            USING ERRCODE = '0A000';
    END IF;

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

    IF EXISTS (
        SELECT 1
        FROM public.cash_registers AS cash_register
        WHERE cash_register.bakery_id = ANY(v_bakery_ids)
          AND cash_register.status = 'open'
    ) THEN
        RAISE EXCEPTION 'Operators cannot be changed while a cash register is open in their bakery'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.products AS product
        LEFT JOIN public.product_stock AS stock
            ON stock.product_id = product.id
           AND stock.bakery_id = product.bakery_id
        WHERE product.bakery_id = ANY(v_bakery_ids)
          AND (
              stock.product_id IS NULL
              OR stock.quantity IS DISTINCT FROM 0
          )
    ) THEN
        RAISE EXCEPTION 'Operators cannot be changed unless every product in their bakery has zero stock'
            USING ERRCODE = '23514';
    END IF;
END;
$function$;

ALTER FUNCTION private.lock_and_validate_operator_bakeries(uuid[])
    OWNER TO postgres;

REVOKE ALL ON FUNCTION private.lock_and_validate_operator_bakeries(uuid[])
    FROM PUBLIC, anon, authenticated;

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

    SELECT target_user.role, target_user.bakery_id
    INTO v_user_role, v_current_bakery_id
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

    IF v_current_bakery_id IS NULL THEN
        RAISE EXCEPTION 'The operator has no assigned bakery'
            USING ERRCODE = '23514';
    END IF;

    PERFORM private.lock_and_validate_operator_bakeries(
        ARRAY[v_current_bakery_id, p_bakery_id]::uuid[]
    );

    UPDATE public.users
    SET name = btrim(p_name),
        bakery_id = p_bakery_id
    WHERE id = p_user_id
      AND role = 'cashier'
    RETURNING id INTO v_updated_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The operator profile changed before the update completed'
            USING ERRCODE = '40001';
    END IF;

    RETURN v_updated_user_id;
END;
$function$;

ALTER FUNCTION public.update_operator_profile(uuid, text, uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_operator_profile(uuid, text, uuid)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_operator_profile(uuid, text, uuid)
    TO authenticated;

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

    PERFORM private.lock_and_validate_operator_bakeries(
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

    RETURN v_deactivated_user_id;
END;
$function$;

ALTER FUNCTION public.deactivate_operator(uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.deactivate_operator(uuid)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.deactivate_operator(uuid)
    TO authenticated;

DROP TRIGGER IF EXISTS prevent_unsafe_operator_profile_change
    ON public.users;

DROP FUNCTION IF EXISTS private.prevent_unsafe_operator_profile_change();

REVOKE INSERT, UPDATE, DELETE ON TABLE public.users
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.prevent_operator_profile_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF OLD.role = 'cashier' THEN
        RAISE EXCEPTION 'Operator profiles must be deactivated instead of physically deleted'
            USING ERRCODE = '23514';
    END IF;

    RETURN OLD;
END;
$function$;

ALTER FUNCTION private.prevent_operator_profile_deletion()
    OWNER TO postgres;

REVOKE ALL ON FUNCTION private.prevent_operator_profile_deletion()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_operator_profile_deletion
    ON public.users;

CREATE TRIGGER prevent_operator_profile_deletion
    BEFORE DELETE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION private.prevent_operator_profile_deletion();

CREATE OR REPLACE FUNCTION private.lock_bakery_for_product_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_bakery_id uuid;
    v_bakery_ids uuid[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_bakery_ids := ARRAY[NEW.bakery_id]::uuid[];
    ELSIF TG_OP = 'DELETE' THEN
        v_bakery_ids := ARRAY[OLD.bakery_id]::uuid[];
    ELSE
        v_bakery_ids := ARRAY[OLD.bakery_id, NEW.bakery_id]::uuid[];
    END IF;

    FOR v_bakery_id IN
        SELECT DISTINCT requested.bakery_id
        FROM unnest(v_bakery_ids) AS requested(bakery_id)
        WHERE requested.bakery_id IS NOT NULL
        ORDER BY requested.bakery_id
    LOOP
        PERFORM 1
        FROM public.bakeries AS bakery
        WHERE bakery.id = v_bakery_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'The product bakery does not exist'
                USING ERRCODE = '23503';
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN
        PERFORM private.assert_active_operator_write(
            (SELECT auth.uid()),
            OLD.bakery_id,
            TG_TABLE_NAME = 'product_stock'
        );
        RETURN OLD;
    END IF;

    PERFORM private.assert_active_operator_write(
        (SELECT auth.uid()),
        NEW.bakery_id,
        TG_TABLE_NAME = 'product_stock'
    );

    RETURN NEW;
END;
$function$;

ALTER FUNCTION private.lock_bakery_for_product_write()
    OWNER TO postgres;

REVOKE ALL ON FUNCTION private.lock_bakery_for_product_write()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS lock_bakery_for_product_write
    ON public.products;

CREATE TRIGGER lock_bakery_for_product_write
    BEFORE INSERT OR UPDATE OR DELETE ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION private.lock_bakery_for_product_write();

DROP TRIGGER IF EXISTS lock_bakery_for_product_stock_write
    ON public.product_stock;

CREATE TRIGGER lock_bakery_for_product_stock_write
    BEFORE INSERT OR UPDATE OR DELETE ON public.product_stock
    FOR EACH ROW
    EXECUTE FUNCTION private.lock_bakery_for_product_write();
