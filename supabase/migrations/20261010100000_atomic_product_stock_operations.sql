-- Depends on the base product/product_stock schema, private authorization
-- helpers, and public.set_product_stock() from 20261009114600.
-- The current frontend still writes product rows directly and keeps stock
-- local. These RPCs are ready for the later integration; direct product DML
-- is intentionally not revoked in this migration to avoid breaking it now.

DO $migration$
BEGIN
    IF to_regclass('public.products') IS NULL
       OR to_regclass('public.product_stock') IS NULL
       OR to_regclass('public.bakeries') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL
       OR to_regprocedure('private.current_user_bakery_id()') IS NULL
       OR to_regprocedure('public.set_product_stock(uuid,uuid,text,integer)') IS NULL THEN
        RAISE EXCEPTION
            'Atomic product/stock operations require the established product, stock, bakery, and authorization objects';
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.create_product_with_initial_stock(
    p_name text,
    p_barcode text,
    p_price numeric,
    p_initial_quantity integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_bakery_id uuid;
    v_product_id uuid;
BEGIN
    v_user_id := (SELECT auth.uid());

    IF v_user_id IS NULL OR NOT (SELECT private.is_cashier()) THEN
        RAISE EXCEPTION 'Only an active cashier can create a product'
            USING ERRCODE = '42501';
    END IF;

    v_bakery_id := (SELECT private.current_user_bakery_id());

    IF v_bakery_id IS NULL THEN
        RAISE EXCEPTION 'The authenticated cashier has no active bakery'
            USING ERRCODE = '42501';
    END IF;

    PERFORM 1
    FROM public.bakeries AS bakery
    WHERE bakery.id = v_bakery_id
      AND bakery.active = true
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The authenticated cashier has no active bakery'
            USING ERRCODE = '42501';
    END IF;

    IF p_name IS NULL OR btrim(p_name) = ''
       OR p_barcode IS NULL OR btrim(p_barcode) = ''
       OR p_price IS NULL
       OR p_price::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_price <= 0
       OR p_price > 9999999999.99
       OR trunc(p_price, 2) <> p_price
       OR p_initial_quantity IS NULL
       OR p_initial_quantity < 0 THEN
        RAISE EXCEPTION 'A product name, barcode, positive two-decimal price, and non-negative initial quantity are required'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.products (
        bakery_id,
        name,
        barcode,
        price
    )
    VALUES (
        v_bakery_id,
        btrim(p_name),
        btrim(p_barcode),
        p_price
    )
    RETURNING id INTO v_product_id;

    PERFORM public.set_product_stock(
        v_product_id,
        v_bakery_id,
        'initialize',
        p_initial_quantity
    );

    RETURN v_product_id;
END;
$function$;

ALTER FUNCTION public.create_product_with_initial_stock(text, text, numeric, integer)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_product_with_initial_stock(text, text, numeric, integer)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_product_with_initial_stock(text, text, numeric, integer)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.update_product_with_stock(
    p_product_id uuid,
    p_name text,
    p_barcode text,
    p_price numeric,
    p_quantity integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_bakery_id uuid;
    v_product_bakery_id uuid;
BEGIN
    v_user_id := (SELECT auth.uid());

    IF v_user_id IS NULL OR NOT (SELECT private.is_cashier()) THEN
        RAISE EXCEPTION 'Only an active cashier can update a product and its stock'
            USING ERRCODE = '42501';
    END IF;

    v_bakery_id := (SELECT private.current_user_bakery_id());

    IF v_bakery_id IS NULL THEN
        RAISE EXCEPTION 'The authenticated cashier has no active bakery'
            USING ERRCODE = '42501';
    END IF;

    PERFORM 1
    FROM public.bakeries AS bakery
    WHERE bakery.id = v_bakery_id
      AND bakery.active = true
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The authenticated cashier has no active bakery'
            USING ERRCODE = '42501';
    END IF;

    IF p_product_id IS NULL
       OR p_name IS NULL OR btrim(p_name) = ''
       OR p_barcode IS NULL OR btrim(p_barcode) = ''
       OR p_price IS NULL
       OR p_price::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_price <= 0
       OR p_price > 9999999999.99
       OR trunc(p_price, 2) <> p_price
       OR p_quantity IS NULL
       OR p_quantity < 0 THEN
        RAISE EXCEPTION 'A product, name, barcode, positive two-decimal price, and non-negative quantity are required'
            USING ERRCODE = '22023';
    END IF;

    SELECT product.bakery_id
    INTO v_product_bakery_id
    FROM public.products AS product
    WHERE product.id = p_product_id
    FOR UPDATE;

    IF NOT FOUND OR v_product_bakery_id IS DISTINCT FROM v_bakery_id THEN
        RAISE EXCEPTION 'The product does not belong to the authenticated cashier bakery'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.products
    SET name = btrim(p_name),
        barcode = btrim(p_barcode),
        price = p_price
    WHERE id = p_product_id
      AND bakery_id = v_bakery_id;

    IF EXISTS (
        SELECT 1
        FROM public.product_stock AS stock
        WHERE stock.product_id = p_product_id
          AND stock.bakery_id = v_bakery_id
    ) THEN
        PERFORM public.set_product_stock(
            p_product_id,
            v_bakery_id,
            'set',
            p_quantity
        );
    ELSE
        PERFORM public.set_product_stock(
            p_product_id,
            v_bakery_id,
            'initialize',
            p_quantity
        );
    END IF;

    RETURN p_product_id;
END;
$function$;

ALTER FUNCTION public.update_product_with_stock(uuid, text, text, numeric, integer)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_product_with_stock(uuid, text, text, numeric, integer)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_product_with_stock(uuid, text, text, numeric, integer)
    TO authenticated;

COMMENT ON FUNCTION public.create_product_with_initial_stock(text, text, numeric, integer) IS
    'Atomically creates a product for the authenticated cashier bakery and initializes its stock.';

COMMENT ON FUNCTION public.update_product_with_stock(uuid, text, text, numeric, integer) IS
    'Atomically updates a product and sets or initializes its stock for the authenticated cashier bakery.';
