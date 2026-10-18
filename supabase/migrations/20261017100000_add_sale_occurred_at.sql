-- 2026-10-17 — Campo occurred_at na tabela sales e na RPC create_sale_with_items.
--
-- Os PDVs offline registram a data/hora real em que a venda foi feita. Essa
-- informação não era persistida, o que impediria o dono de diferenciar vendas
-- registradas com o relógio do dispositivo de vendas e vendas assíncronas.
--
-- A migration é executada em dois passos:
--  1. adiciona a coluna occurred_at e o índice;
--  2. substitui a função RPC (assinatura antiga é dropada para que o novo
--     parâmetro opcional p_occurred_at seja suportado, mantendo compatibilidade
--     para clientes antigos que enviam apenas os seis parâmetros originais).

-- 1. Coluna + índice
ALTER TABLE public.sales
    ADD COLUMN occurred_at timestamptz NOT NULL
    DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_sales_occurred_at
    ON public.sales (occurred_at);

-- 2. Função RPC com suporte a p_occurred_at (padrão NULL para compatibilidade)
--    e validação de consistência horária com o caixa aberto.
DROP FUNCTION IF EXISTS public.create_sale_with_items(
    uuid, text, numeric, numeric, jsonb, uuid
);

CREATE FUNCTION public.create_sale_with_items(
    p_cash_register_id uuid,
    p_payment_method text,
    p_received_amount numeric,
    p_change_amount numeric,
    p_items jsonb,
    p_idempotency_key uuid,
    p_occurred_at timestamptz DEFAULT NULL
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
    v_opened_at timestamptz;
    v_occurred_at timestamptz;
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

    SELECT opened_at INTO v_opened_at FROM public.cash_registers WHERE id = p_cash_register_id;

    IF p_occurred_at IS NOT NULL THEN
        IF p_occurred_at > now() + interval '5 minutes' THEN
            RAISE EXCEPTION 'Sale occurrence time cannot be in the future'
                USING ERRCODE = '22023';
        END IF;

        IF p_occurred_at < v_opened_at THEN
            RAISE EXCEPTION 'Sale occurrence time cannot precede the register opening'
                USING ERRCODE = '22023';
        END IF;
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

    v_occurred_at := coalesce(p_occurred_at, now());

    INSERT INTO public.sales (
        bakery_id,
        cash_register_id,
        cashier_user_id,
        total,
        payment_method,
        received_amount,
        change_amount,
        idempotency_key,
        idempotency_payload,
        occurred_at
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
        v_idempotency_payload,
        v_occurred_at
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

        IF v_affected_rows = 0 THEN
            RAISE EXCEPTION 'Failed to decrement stock for product %'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;

    RETURN v_sale_id;
END;
$function$;

ALTER FUNCTION public.create_sale_with_items(
    p_cash_register_id uuid,
    p_payment_method text,
    p_received_amount numeric,
    p_change_amount numeric,
    p_items jsonb,
    p_idempotency_key uuid,
    p_occurred_at timestamptz DEFAULT NULL
)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_sale_with_items(
    p_cash_register_id uuid,
    p_payment_method text,
    p_received_amount numeric,
    p_change_amount numeric,
    p_items jsonb,
    p_idempotency_key uuid,
    p_occurred_at timestamptz DEFAULT NULL
)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_sale_with_items(
    p_cash_register_id uuid,
    p_payment_method text,
    p_received_amount numeric,
    p_change_amount numeric,
    p_items jsonb,
    p_idempotency_key uuid,
    p_occurred_at timestamptz DEFAULT NULL
)
    TO authenticated;
