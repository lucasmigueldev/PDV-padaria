ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS idempotency_key uuid,
    ADD COLUMN IF NOT EXISTS idempotency_payload jsonb;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_metadata
        WHERE constraint_metadata.conrelid = 'public.sales'::regclass
          AND constraint_metadata.conname = 'sales_idempotency_fields_check'
    ) THEN
        ALTER TABLE public.sales
            ADD CONSTRAINT sales_idempotency_fields_check
            CHECK (
                (idempotency_key IS NULL)
                = (idempotency_payload IS NULL)
            );
    END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS sales_cashier_idempotency_key_uidx
    ON public.sales (cashier_user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION private.enforce_cash_register_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status IS DISTINCT FROM 'open' THEN
            RAISE EXCEPTION 'Cash registers must be created open'
                USING ERRCODE = '23514';
        END IF;

        PERFORM 1
        FROM public.bakeries AS bakery
        WHERE bakery.id = NEW.bakery_id
          AND bakery.active = true
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'An active bakery is required to open a cash register'
                USING ERRCODE = '23503';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.cash_registers AS cash_register
            WHERE cash_register.bakery_id = NEW.bakery_id
              AND cash_register.status = 'open'
        ) THEN
            RAISE EXCEPTION 'This bakery already has an open cash register'
                USING ERRCODE = '23505';
        END IF;

        v_user_id := (SELECT auth.uid());

        IF v_user_id IS NULL
           OR NOT (SELECT private.is_cashier())
           OR NEW.opened_by IS DISTINCT FROM v_user_id
           OR NEW.bakery_id IS DISTINCT FROM
                (SELECT private.current_user_bakery_id()) THEN
            RAISE EXCEPTION 'Only an active cashier may open a cash register for their bakery'
                USING ERRCODE = '42501';
        END IF;

        IF NEW.initial_amount IS NULL
           OR NEW.initial_amount::text IN ('NaN', 'Infinity', '-Infinity')
           OR NEW.initial_amount < 0 THEN
            RAISE EXCEPTION 'Cash register initial amount must be finite and non-negative'
                USING ERRCODE = '22023';
        END IF;

        RETURN NEW;
    END IF;

    IF OLD.status IS DISTINCT FROM 'open'
       OR NEW.status IS DISTINCT FROM 'closed' THEN
        RAISE EXCEPTION 'Cash registers can only transition from open to closed'
            USING ERRCODE = '23514';
    END IF;

    IF ROW(
        NEW.id,
        NEW.bakery_id,
        NEW.opened_at,
        NEW.initial_amount,
        NEW.opened_by
    ) IS DISTINCT FROM ROW(
        OLD.id,
        OLD.bakery_id,
        OLD.opened_at,
        OLD.initial_amount,
        OLD.opened_by
    ) THEN
        RAISE EXCEPTION 'Cash register opening details are immutable'
            USING ERRCODE = '23514';
    END IF;

    v_user_id := (SELECT auth.uid());

    IF v_user_id IS NULL
       OR NOT (SELECT private.is_cashier())
       OR (SELECT private.current_user_bakery_id()) IS DISTINCT FROM OLD.bakery_id
       OR NOT EXISTS (
        SELECT 1
        FROM public.cash_closures AS closure
        WHERE closure.cash_register_id = OLD.id
          AND closure.bakery_id = OLD.bakery_id
          AND closure.closed_by = v_user_id
    ) THEN
        RAISE EXCEPTION 'An authorized matching closure by the authenticated operator is required'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION private.enforce_cash_register_state_transition()
    OWNER TO postgres;

REVOKE ALL ON FUNCTION private.enforce_cash_register_state_transition()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cash_register_state_transition_guard
    ON public.cash_registers;

CREATE TRIGGER cash_register_state_transition_guard
    BEFORE INSERT OR UPDATE ON public.cash_registers
    FOR EACH ROW
    EXECUTE FUNCTION private.enforce_cash_register_state_transition();

CREATE OR REPLACE FUNCTION public.open_cash_register(
    p_initial_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_bakery_id uuid;
    v_cash_register_id uuid;
BEGIN
    v_user_id := (SELECT auth.uid());

    IF v_user_id IS NULL OR NOT (SELECT private.is_cashier()) THEN
        RAISE EXCEPTION 'Only an active cashier can open a cash register'
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
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The authenticated cashier has no active bakery'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.cash_registers AS cash_register
        WHERE cash_register.bakery_id = v_bakery_id
          AND cash_register.status = 'open'
    ) THEN
        RAISE EXCEPTION 'This bakery already has an open cash register'
            USING ERRCODE = '23505';
    END IF;

    IF p_initial_amount IS NULL
       OR p_initial_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_initial_amount < 0
       OR p_initial_amount > 9999999999.99
       OR trunc(p_initial_amount, 2) <> p_initial_amount THEN
        RAISE EXCEPTION 'Initial amount must fit numeric(12,2) and be non-negative'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.cash_registers (
        bakery_id,
        initial_amount,
        opened_by,
        status
    )
    VALUES (
        v_bakery_id,
        p_initial_amount,
        v_user_id,
        'open'
    )
    RETURNING id INTO v_cash_register_id;

    RETURN v_cash_register_id;
END;
$function$;

ALTER FUNCTION public.open_cash_register(numeric)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.open_cash_register(numeric)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.open_cash_register(numeric)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.create_sale_with_items(
    p_cash_register_id uuid,
    p_payment_method text,
    p_received_amount numeric,
    p_change_amount numeric,
    p_items jsonb,
    p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_bakery_id uuid;
    v_sale_id uuid;
    v_total numeric := 0;
    v_item_json jsonb;
    v_product_id uuid;
    v_product_ids uuid[] := ARRAY[]::uuid[];
    v_quantities integer[] := ARRAY[]::integer[];
    v_quantity_numeric numeric;
    v_quantity integer;
    v_stock_quantity integer;
    v_product_price numeric;
    v_item_subtotal numeric;
    v_expected_change numeric;
    v_item_count integer;
    v_affected_rows integer;
    v_stock_row_count bigint;
    v_idempotency_payload jsonb;
    v_existing_idempotency_payload jsonb;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Sale registration requires READ COMMITTED isolation'
            USING ERRCODE = '0A000';
    END IF;

    v_user_id := (SELECT auth.uid());

    IF v_user_id IS NULL OR NOT (SELECT private.is_cashier()) THEN
        RAISE EXCEPTION 'Only an active cashier can register a sale'
            USING ERRCODE = '42501';
    END IF;

    v_bakery_id := (SELECT private.current_user_bakery_id());

    IF v_bakery_id IS NULL THEN
        RAISE EXCEPTION 'The authenticated cashier has no active bakery'
            USING ERRCODE = '42501';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'An idempotency key is required for every sale'
            USING ERRCODE = '22023';
    END IF;

    v_idempotency_payload := jsonb_build_object(
        'cash_register_id', p_cash_register_id,
        'payment_method', p_payment_method,
        'received_amount', p_received_amount,
        'change_amount', p_change_amount,
        'items', p_items
    );

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            v_user_id::text || ':' || p_idempotency_key::text,
            0
        )
    );

    SELECT sale.id, sale.idempotency_payload
    INTO v_sale_id, v_existing_idempotency_payload
    FROM public.sales AS sale
    WHERE sale.cashier_user_id = v_user_id
      AND sale.idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_idempotency_payload
            IS DISTINCT FROM v_idempotency_payload THEN
            RAISE EXCEPTION 'Idempotency key was already used with a different sale request'
                USING ERRCODE = '22023';
        END IF;

        RETURN v_sale_id;
    END IF;

    IF (p_received_amount IS NOT NULL
        AND p_received_amount::text IN ('NaN', 'Infinity', '-Infinity'))
       OR (p_change_amount IS NOT NULL
        AND p_change_amount::text IN ('NaN', 'Infinity', '-Infinity')) THEN
        RAISE EXCEPTION 'Received amount and change must be finite'
            USING ERRCODE = '22023';
    END IF;

    IF (p_received_amount IS NOT NULL
        AND trunc(p_received_amount, 2) <> p_received_amount)
       OR (p_change_amount IS NOT NULL
        AND trunc(p_change_amount, 2) <> p_change_amount) THEN
        RAISE EXCEPTION 'Cash amounts may have at most two decimal places'
            USING ERRCODE = '22023';
    END IF;

    IF (p_received_amount IS NOT NULL
        AND p_received_amount > 9999999999.99)
       OR (p_change_amount IS NOT NULL
        AND p_change_amount > 9999999999.99) THEN
        RAISE EXCEPTION 'Cash amounts must fit numeric(12,2)'
            USING ERRCODE = '22023';
    END IF;

    IF p_payment_method IS NULL
       OR p_payment_method NOT IN ('cash', 'pix', 'card') THEN
        RAISE EXCEPTION 'Invalid payment method'
            USING ERRCODE = '22023';
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Sale items must be a JSON array'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'A sale must contain at least one item'
            USING ERRCODE = '22023';
    END IF;

    FOR v_item_json IN
        SELECT item.value
        FROM jsonb_array_elements(p_items) AS item(value)
    LOOP
        IF jsonb_typeof(v_item_json) IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_item_json -> 'product_id') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_item_json -> 'quantity') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'Every sale item requires a UUID product_id and integer quantity'
                USING ERRCODE = '22023';
        END IF;

        BEGIN
            v_product_id := (v_item_json ->> 'product_id')::uuid;
            v_quantity_numeric := (v_item_json ->> 'quantity')::numeric;
        EXCEPTION
            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                RAISE EXCEPTION 'Every sale item requires a valid product_id and integer quantity'
                    USING ERRCODE = '22023';
        END;

        IF v_quantity_numeric <= 0
           OR v_quantity_numeric <> trunc(v_quantity_numeric)
           OR v_quantity_numeric > 2147483647 THEN
            RAISE EXCEPTION 'Sale item quantity must be a positive integer'
                USING ERRCODE = '22023';
        END IF;

        v_quantity := v_quantity_numeric::integer;

        IF array_position(v_product_ids, v_product_id) IS NOT NULL THEN
            RAISE EXCEPTION 'A product may appear only once in a sale'
                USING ERRCODE = '22023';
        END IF;

        v_product_ids := array_append(v_product_ids, v_product_id);
        v_quantities := array_append(v_quantities, v_quantity);
    END LOOP;

    PERFORM 1
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = p_cash_register_id
      AND cash_register.bakery_id = v_bakery_id
      AND cash_register.status = 'open'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No open cash register exists for this bakery'
            USING ERRCODE = '23514';
    END IF;

    v_item_count := cardinality(v_product_ids);

    FOR v_product_id IN
        SELECT item.product_id
        FROM unnest(v_product_ids) AS item(product_id)
        ORDER BY item.product_id
    LOOP
        SELECT product.price
        INTO v_product_price
        FROM public.products AS product
        WHERE product.id = v_product_id
          AND product.bakery_id = v_bakery_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Every product must belong to the cashier bakery'
                USING ERRCODE = '23503';
        END IF;

        IF v_product_price IS NULL
           OR v_product_price::text IN ('NaN', 'Infinity', '-Infinity')
           OR v_product_price <= 0 THEN
            RAISE EXCEPTION 'Every product must have a finite positive price'
                USING ERRCODE = '23514';
        END IF;

        v_item_subtotal := v_product_price
            * v_quantities[array_position(v_product_ids, v_product_id)];

        IF v_item_subtotal::text IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION 'Every item subtotal must be finite'
                USING ERRCODE = '23514';
        END IF;

        IF v_item_subtotal > 9999999999.99 THEN
            RAISE EXCEPTION 'Every item subtotal must fit numeric(12,2)'
                USING ERRCODE = '22003';
        END IF;

        v_total := v_total + v_item_subtotal;

        IF v_total::text IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION 'Sale total must be finite'
                USING ERRCODE = '23514';
        END IF;

        IF v_total > 9999999999.99 THEN
            RAISE EXCEPTION 'Sale total must fit numeric(12,2)'
                USING ERRCODE = '22003';
        END IF;
    END LOOP;

    FOR v_product_id IN
        SELECT item.product_id
        FROM unnest(v_product_ids) AS item(product_id)
        ORDER BY item.product_id
    LOOP
        PERFORM 1
        FROM public.product_stock AS product_stock
        WHERE product_stock.product_id = v_product_id
          AND product_stock.bakery_id = v_bakery_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Every product must have a stock row for the cashier bakery'
                USING ERRCODE = '23514';
        END IF;

        SELECT count(*)
        INTO v_stock_row_count
        FROM public.product_stock AS product_stock
        WHERE product_stock.product_id = v_product_id
          AND product_stock.bakery_id = v_bakery_id;

        IF v_stock_row_count <> 1 THEN
            RAISE EXCEPTION 'Every product must have exactly one stock row for the cashier bakery'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;

    FOR v_product_id IN
        SELECT item.product_id
        FROM unnest(v_product_ids) AS item(product_id)
        ORDER BY item.product_id
    LOOP
        SELECT product_stock.quantity
        INTO v_stock_quantity
        FROM public.product_stock AS product_stock
        WHERE product_stock.product_id = v_product_id
          AND product_stock.bakery_id = v_bakery_id;

        IF NOT FOUND
           OR v_stock_quantity IS NULL
           OR v_stock_quantity < v_quantities[array_position(v_product_ids, v_product_id)] THEN
            RAISE EXCEPTION 'Insufficient stock for product %', v_product_id
                USING ERRCODE = '23514';
        END IF;
    END LOOP;

    IF p_payment_method = 'cash' THEN
        IF p_received_amount IS NULL
           OR p_change_amount IS NULL
           OR p_received_amount < v_total
           OR p_change_amount < 0 THEN
            RAISE EXCEPTION 'Invalid cash received or change amount'
                USING ERRCODE = '22023';
        END IF;

        v_expected_change := p_received_amount - v_total;

        IF v_expected_change::text IN ('NaN', 'Infinity', '-Infinity')
           OR p_change_amount <> v_expected_change THEN
            RAISE EXCEPTION 'Invalid cash received or change amount'
                USING ERRCODE = '22023';
        END IF;
    ELSIF p_received_amount IS NOT NULL OR p_change_amount IS NOT NULL THEN
        RAISE EXCEPTION 'Received amount and change must be null for non-cash payments'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.sales (
        bakery_id,
        cash_register_id,
        cashier_user_id,
        total,
        payment_method,
        received_amount,
        change_amount,
        idempotency_key,
        idempotency_payload
    )
    VALUES (
        v_bakery_id,
        p_cash_register_id,
        v_user_id,
        v_total,
        p_payment_method,
        p_received_amount,
        p_change_amount,
        p_idempotency_key,
        v_idempotency_payload
    )
    RETURNING id INTO v_sale_id;

    INSERT INTO public.sale_items (
        sale_id,
        product_id,
        name,
        barcode,
        price,
        quantity
    )
    SELECT
        v_sale_id,
        requested.product_id,
        product.name,
        product.barcode,
        product.price,
        requested.quantity
    FROM unnest(v_product_ids, v_quantities) AS requested(product_id, quantity)
    JOIN public.products AS product
        ON product.id = requested.product_id
       AND product.bakery_id = v_bakery_id;

    GET DIAGNOSTICS v_affected_rows = ROW_COUNT;

    IF v_affected_rows <> v_item_count THEN
        RAISE EXCEPTION 'Sale item insertion did not create the expected number of rows'
            USING ERRCODE = '23514';
    END IF;

    FOR v_product_id IN
        SELECT item.product_id
        FROM unnest(v_product_ids) AS item(product_id)
        ORDER BY item.product_id
    LOOP
        UPDATE public.product_stock AS product_stock
        SET quantity = product_stock.quantity
            - v_quantities[array_position(v_product_ids, v_product_id)]
        WHERE product_stock.product_id = v_product_id
          AND product_stock.bakery_id = v_bakery_id
          AND product_stock.quantity
              >= v_quantities[array_position(v_product_ids, v_product_id)];

        GET DIAGNOSTICS v_affected_rows = ROW_COUNT;

        IF v_affected_rows <> 1 THEN
            RAISE EXCEPTION 'Stock update did not affect exactly one row for product %', v_product_id
                USING ERRCODE = '23514';
        END IF;
    END LOOP;

    RETURN v_sale_id;
END;
$function$;

ALTER FUNCTION public.create_sale_with_items(
    uuid,
    text,
    numeric,
    numeric,
    jsonb,
    uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_sale_with_items(
    uuid,
    text,
    numeric,
    numeric,
    jsonb,
    uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_sale_with_items(
    uuid,
    text,
    numeric,
    numeric,
    jsonb,
    uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_cash_register(
    p_cash_register_id uuid,
    p_counted_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_bakery_id uuid;
    v_register_initial_amount numeric;
    v_cash_sales_amount numeric;
    v_expected_amount numeric;
    v_difference_amount numeric;
    v_closure_id uuid;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Cash register closure requires READ COMMITTED isolation'
            USING ERRCODE = '0A000';
    END IF;

    v_user_id := (SELECT auth.uid());

    IF v_user_id IS NULL OR NOT (SELECT private.is_cashier()) THEN
        RAISE EXCEPTION 'Only an active cashier can close a cash register'
            USING ERRCODE = '42501';
    END IF;

    v_bakery_id := (SELECT private.current_user_bakery_id());

    IF v_bakery_id IS NULL THEN
        RAISE EXCEPTION 'The authenticated cashier has no active bakery'
            USING ERRCODE = '42501';
    END IF;

    IF p_counted_amount IS NULL
       OR p_counted_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_counted_amount < 0
       OR p_counted_amount > 9999999999.99
       OR trunc(p_counted_amount, 2) <> p_counted_amount THEN
        RAISE EXCEPTION 'Counted amount must fit numeric(12,2) and be non-negative'
            USING ERRCODE = '22023';
    END IF;

    SELECT cash_register.initial_amount
    INTO v_register_initial_amount
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = p_cash_register_id
      AND cash_register.bakery_id = v_bakery_id
      AND cash_register.status = 'open'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No open cash register exists for this bakery'
            USING ERRCODE = '23514';
    END IF;

    IF v_register_initial_amount IS NULL
       OR v_register_initial_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_register_initial_amount < 0 THEN
        RAISE EXCEPTION 'Cash register initial amount must be finite and non-negative'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.cash_closures AS closure
        WHERE closure.cash_register_id = p_cash_register_id
    ) THEN
        RAISE EXCEPTION 'This cash register already has a closure'
            USING ERRCODE = '23505';
    END IF;

    SELECT COALESCE(SUM(sale.total), 0)
    INTO v_cash_sales_amount
    FROM public.sales AS sale
    WHERE sale.cash_register_id = p_cash_register_id
      AND sale.bakery_id = v_bakery_id
      AND sale.payment_method = 'cash';

    IF v_cash_sales_amount IS NULL
       OR v_cash_sales_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_cash_sales_amount < 0
       OR v_cash_sales_amount > 9999999999.99 THEN
        RAISE EXCEPTION 'Cash sales amount must be finite and non-negative'
            USING ERRCODE = '23514';
    END IF;

    v_expected_amount := v_register_initial_amount + v_cash_sales_amount;

    IF v_expected_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_expected_amount < 0
       OR v_expected_amount > 9999999999.99 THEN
        RAISE EXCEPTION 'Expected cash amount must be finite and non-negative'
            USING ERRCODE = '23514';
    END IF;

    v_difference_amount := p_counted_amount - v_expected_amount;

    IF v_difference_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Cash difference amount must be finite'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.cash_closures (
        cash_register_id,
        bakery_id,
        closed_by,
        counted_amount,
        cash_sales_amount,
        expected_amount,
        difference_amount
    )
    VALUES (
        p_cash_register_id,
        v_bakery_id,
        v_user_id,
        p_counted_amount,
        v_cash_sales_amount,
        v_expected_amount,
        v_difference_amount
    )
    RETURNING id INTO v_closure_id;

    UPDATE public.cash_registers
    SET status = 'closed'
    WHERE id = p_cash_register_id
      AND bakery_id = v_bakery_id
      AND status = 'open';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cash register status changed before closure completed'
            USING ERRCODE = '40001';
    END IF;

    RETURN v_closure_id;
END;
$function$;

ALTER FUNCTION public.close_cash_register(uuid, numeric)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.close_cash_register(uuid, numeric)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.close_cash_register(uuid, numeric)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.set_product_stock(
    p_product_id uuid,
    p_bakery_id uuid,
    p_operation text,
    p_quantity integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_bakery_id uuid;
    v_stock_quantity integer;
BEGIN
    v_user_id := (SELECT auth.uid());

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'An authenticated user is required to change stock'
            USING ERRCODE = '42501';
    END IF;

    IF (SELECT private.is_cashier()) THEN
        v_bakery_id := (SELECT private.current_user_bakery_id());

        IF v_bakery_id IS NULL OR p_bakery_id IS DISTINCT FROM v_bakery_id THEN
            RAISE EXCEPTION 'Cashiers may change stock only for their own active bakery'
                USING ERRCODE = '42501';
        END IF;
    ELSIF (SELECT private.is_owner()) THEN
        IF p_bakery_id IS NULL THEN
            RAISE EXCEPTION 'Owners must specify the bakery for a stock change'
                USING ERRCODE = '22023';
        END IF;

        v_bakery_id := p_bakery_id;
    ELSE
        RAISE EXCEPTION 'Only an owner or active cashier may change stock'
            USING ERRCODE = '42501';
    END IF;

    IF p_product_id IS NULL
       OR p_quantity IS NULL
       OR p_quantity < 0
       OR p_operation IS NULL
       OR p_operation NOT IN ('initialize', 'set') THEN
        RAISE EXCEPTION 'A product, non-negative quantity, and valid stock operation are required'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM public.bakeries AS bakery
    WHERE bakery.id = v_bakery_id
      AND bakery.active = true
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The bakery does not exist or is inactive'
            USING ERRCODE = '23503';
    END IF;

    PERFORM 1
    FROM public.products AS product
    WHERE product.id = p_product_id
      AND product.bakery_id = v_bakery_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The product does not belong to the requested bakery'
            USING ERRCODE = '23503';
    END IF;

    IF p_operation = 'initialize' THEN
        INSERT INTO public.product_stock AS current_stock (
            product_id,
            bakery_id,
            quantity
        )
        VALUES (
            p_product_id,
            v_bakery_id,
            p_quantity
        )
        ON CONFLICT (product_id, bakery_id)
        DO UPDATE
            SET quantity = current_stock.quantity
            WHERE current_stock.quantity = EXCLUDED.quantity
        RETURNING quantity INTO v_stock_quantity;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Stock is already initialized with a different quantity'
                USING ERRCODE = '23505';
        END IF;

        RETURN v_stock_quantity;
    END IF;

    UPDATE public.product_stock
    SET quantity = p_quantity
    WHERE product_id = p_product_id
      AND bakery_id = v_bakery_id
    RETURNING quantity INTO v_stock_quantity;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock is not initialized; initialize it only after a validated count'
            USING ERRCODE = '23514';
    END IF;

    RETURN v_stock_quantity;
END;
$function$;

ALTER FUNCTION public.set_product_stock(uuid, uuid, text, integer)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.set_product_stock(uuid, uuid, text, integer)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_product_stock(uuid, uuid, text, integer)
    TO authenticated;

COMMENT ON FUNCTION public.set_product_stock(uuid, uuid, text, integer) IS
    'Cashiers may initialize or set stock only at their own active bakery; owners may do so at any active bakery. Initialization creates no inferred quantity and rejects a differing existing quantity.';

DO $migration$
DECLARE
    v_policy record;
BEGIN
    FOR v_policy IN
        SELECT policy.schemaname, policy.tablename, policy.policyname
        FROM pg_catalog.pg_policies AS policy
        WHERE policy.schemaname = 'public'
          AND policy.tablename IN (
              'cash_registers',
              'cash_closures',
              'sales',
              'sale_items',
              'product_stock'
          )
          AND policy.cmd <> 'SELECT'
    LOOP
        EXECUTE format(
            'DROP POLICY %I ON %I.%I',
            v_policy.policyname,
            v_policy.schemaname,
            v_policy.tablename
        );
    END LOOP;
END;
$migration$;

REVOKE INSERT, UPDATE, DELETE
    ON TABLE public.cash_registers,
              public.cash_closures,
              public.sales,
              public.sale_items,
              public.product_stock
    FROM authenticated;

DO $migration$
DECLARE
    v_table record;
    v_columns text;
BEGIN
    FOR v_table IN
        SELECT target.table_name
        FROM unnest(ARRAY[
            'cash_registers',
            'cash_closures',
            'sales',
            'sale_items',
            'product_stock'
        ]) AS target(table_name)
    LOOP
        SELECT string_agg(format('%I', attribute.attname), ', ' ORDER BY attribute.attnum)
        INTO v_columns
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = format('public.%I', v_table.table_name)::regclass
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped;

        EXECUTE format(
            'REVOKE INSERT (%1$s), UPDATE (%1$s) ON TABLE public.%2$I FROM authenticated',
            v_columns,
            v_table.table_name
        );
    END LOOP;
END;
$migration$;
