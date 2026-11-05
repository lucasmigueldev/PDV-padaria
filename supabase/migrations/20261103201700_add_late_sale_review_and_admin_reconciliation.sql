DO $migration$
BEGIN
    IF to_regclass('public.cash_register_admin_events') IS NULL
       OR to_regclass('public.cash_registers') IS NULL
       OR to_regclass('public.cash_closures') IS NULL
       OR to_regclass('public.sales') IS NULL
       OR to_regclass('public.sale_items') IS NULL
       OR to_regclass('public.products') IS NULL
       OR to_regclass('public.product_stock') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.current_user_bakery_ids()') IS NULL THEN
        RAISE EXCEPTION
            'Late-sale review requires the established administrative closure and financial schema';
    END IF;
END;
$migration$;

ALTER TABLE public.cash_register_admin_events
    DROP CONSTRAINT cash_register_admin_events_type_fields_check,
    ADD CONSTRAINT cash_register_admin_events_type_fields_check CHECK (
        (
            event_type = 'administrative_close'
            AND actor_user_id IS DISTINCT FROM operator_user_id
            AND reason IS NOT NULL
            AND length(btrim(reason)) BETWEEN 1 AND 500
            AND idempotency_key IS NULL
            AND payload IS NULL
            AND offline_session_id IS NULL
            AND claimed_occurred_at IS NULL
            AND review_status = 'financial_reconciliation_pending'
            AND retry_count = 0
            AND last_retry_at IS NULL
        )
        OR
        (
            event_type = 'late_sale'
            AND actor_user_id = operator_user_id
            AND reason IS NULL
            AND idempotency_key IS NOT NULL
            AND jsonb_typeof(payload) = 'object'
            AND review_status IN ('pending_review', 'approved', 'rejected')
        )
    );

CREATE TABLE public.cash_register_late_sale_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_event_id uuid NOT NULL UNIQUE
        REFERENCES public.cash_register_admin_events(id) ON DELETE RESTRICT,
    cash_register_id uuid NOT NULL
        REFERENCES public.cash_registers(id) ON DELETE RESTRICT,
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id) ON DELETE RESTRICT,
    operator_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    reviewer_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    decided_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    sale_id uuid UNIQUE REFERENCES public.sales(id) ON DELETE RESTRICT,
    historical_values_accepted boolean NOT NULL DEFAULT false,
    price_divergence_detected boolean NOT NULL DEFAULT false,
    price_divergence_accepted boolean NOT NULL DEFAULT false,
    CONSTRAINT cash_register_late_sale_reviews_decision_fields_check CHECK (
        (
            decision = 'approved'
            AND sale_id IS NOT NULL
            AND historical_values_accepted
            AND (NOT price_divergence_detected OR price_divergence_accepted)
        )
        OR
        (
            decision = 'rejected'
            AND sale_id IS NULL
            AND NOT historical_values_accepted
            AND NOT price_divergence_detected
            AND NOT price_divergence_accepted
        )
    )
);

CREATE INDEX cash_register_late_sale_reviews_register_idx
    ON public.cash_register_late_sale_reviews (bakery_id, cash_register_id, decided_at);

CREATE TABLE public.cash_register_admin_reconciliations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cash_register_id uuid NOT NULL UNIQUE
        REFERENCES public.cash_registers(id) ON DELETE RESTRICT,
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id) ON DELETE RESTRICT,
    administrative_close_event_id uuid NOT NULL UNIQUE
        REFERENCES public.cash_register_admin_events(id) ON DELETE RESTRICT,
    reconciled_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    reconciled_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    reconciliation_mode text NOT NULL
        DEFAULT 'exceptional_unverified_offline_completeness'
        CHECK (reconciliation_mode = 'exceptional_unverified_offline_completeness'),
    counted_amount numeric(12, 2) NOT NULL
        CHECK (counted_amount >= 0),
    expected_amount numeric(12, 2) NOT NULL
        CHECK (expected_amount >= 0),
    difference_amount numeric(12, 2) NOT NULL,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    unknown_offline_sales_acknowledged boolean NOT NULL
        CHECK (unknown_offline_sales_acknowledged),
    late_sales_received_after_reconciliation boolean NOT NULL DEFAULT false,
    CONSTRAINT cash_register_admin_reconciliations_difference_check
        CHECK (difference_amount = counted_amount - expected_amount)
);

ALTER TABLE public.cash_register_late_sale_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_register_admin_reconciliations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cash_register_late_sale_reviews,
              public.cash_register_admin_reconciliations
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cash_register_late_sale_reviews,
                     public.cash_register_admin_reconciliations
    TO authenticated;

CREATE POLICY cash_register_late_sale_reviews_select_owner
    ON public.cash_register_late_sale_reviews
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        AND bakery_id = ANY (
            SELECT unnest(private.current_user_bakery_ids())
        )
    );

CREATE POLICY cash_register_admin_reconciliations_select_owner
    ON public.cash_register_admin_reconciliations
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        AND bakery_id = ANY (
            SELECT unnest(private.current_user_bakery_ids())
        )
    );

CREATE FUNCTION private.mark_late_sale_received_after_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF NEW.event_type = 'late_sale' THEN
        UPDATE public.cash_register_admin_reconciliations
        SET late_sales_received_after_reconciliation = true
        WHERE cash_register_id = NEW.cash_register_id
          AND bakery_id = NEW.bakery_id;
    END IF;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION private.mark_late_sale_received_after_reconciliation()
    OWNER TO postgres;
REVOKE ALL ON FUNCTION private.mark_late_sale_received_after_reconciliation()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER mark_late_sale_received_after_reconciliation
    AFTER INSERT ON public.cash_register_admin_events
    FOR EACH ROW
    EXECUTE FUNCTION private.mark_late_sale_received_after_reconciliation();

CREATE FUNCTION public.list_pending_late_offline_sales(
    p_cash_register_id uuid
)
RETURNS TABLE (
    admin_event_id uuid,
    cash_register_id uuid,
    bakery_id uuid,
    operator_user_id uuid,
    operator_name text,
    server_received_at timestamptz,
    claimed_occurred_at timestamptz,
    idempotency_key uuid,
    offline_session_id uuid,
    payload jsonb,
    retry_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_bakery_id uuid;
BEGIN
    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an owner may review late offline sales'
            USING ERRCODE = '42501';
    END IF;

    SELECT cash_register.bakery_id
    INTO v_bakery_id
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = p_cash_register_id
      AND cash_register.bakery_id = ANY (
          SELECT unnest(private.current_user_bakery_ids())
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No authorized cash register exists for this request'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        admin_event.id,
        admin_event.cash_register_id,
        admin_event.bakery_id,
        admin_event.operator_user_id,
        operator.name,
        admin_event.server_recorded_at,
        admin_event.claimed_occurred_at,
        admin_event.idempotency_key,
        admin_event.offline_session_id,
        admin_event.payload,
        admin_event.retry_count
    FROM public.cash_register_admin_events AS admin_event
    JOIN public.users AS operator
        ON operator.id = admin_event.operator_user_id
    WHERE admin_event.cash_register_id = p_cash_register_id
      AND admin_event.bakery_id = v_bakery_id
      AND admin_event.event_type = 'late_sale'
      AND admin_event.review_status = 'pending_review'
    ORDER BY admin_event.server_recorded_at, admin_event.id;
END;
$function$;

ALTER FUNCTION public.list_pending_late_offline_sales(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_pending_late_offline_sales(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_late_offline_sales(uuid)
    TO authenticated;

CREATE FUNCTION public.get_late_offline_sale_review_details(
    p_admin_event_id uuid
)
RETURNS TABLE (
    admin_event_id uuid,
    cash_register_id uuid,
    bakery_id uuid,
    operator_user_id uuid,
    operator_name text,
    server_received_at timestamptz,
    claimed_occurred_at timestamptz,
    idempotency_key uuid,
    offline_session_id uuid,
    payload jsonb,
    retry_count integer,
    review_status text,
    review_id uuid,
    decision text,
    reviewer_user_id uuid,
    decided_at timestamptz,
    decision_reason text,
    sale_id uuid,
    historical_values_accepted boolean,
    price_divergence_detected boolean,
    price_divergence_accepted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an owner may view late offline sale details'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        admin_event.id,
        admin_event.cash_register_id,
        admin_event.bakery_id,
        admin_event.operator_user_id,
        operator.name,
        admin_event.server_recorded_at,
        admin_event.claimed_occurred_at,
        admin_event.idempotency_key,
        admin_event.offline_session_id,
        admin_event.payload,
        admin_event.retry_count,
        admin_event.review_status,
        review.id,
        review.decision,
        review.reviewer_user_id,
        review.decided_at,
        review.reason,
        review.sale_id,
        review.historical_values_accepted,
        review.price_divergence_detected,
        review.price_divergence_accepted
    FROM public.cash_register_admin_events AS admin_event
    JOIN public.users AS operator
        ON operator.id = admin_event.operator_user_id
    LEFT JOIN public.cash_register_late_sale_reviews AS review
        ON review.admin_event_id = admin_event.id
       AND review.bakery_id = admin_event.bakery_id
    WHERE admin_event.id = p_admin_event_id
      AND admin_event.event_type = 'late_sale'
      AND admin_event.bakery_id = ANY (
          SELECT unnest(private.current_user_bakery_ids())
      );
END;
$function$;

ALTER FUNCTION public.get_late_offline_sale_review_details(uuid)
    OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_late_offline_sale_review_details(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_late_offline_sale_review_details(uuid)
    TO authenticated;

CREATE FUNCTION public.review_late_offline_sale(
    p_admin_event_id uuid,
    p_decision text,
    p_reason text,
    p_accept_unverified_historical_values boolean DEFAULT false,
    p_accept_price_divergence boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_cash_register_id uuid;
    v_bakery_id uuid;
    v_operator_user_id uuid;
    v_event_status text;
    v_payload jsonb;
    v_idempotency_key uuid;
    v_offline_session_id uuid;
    v_occurred_at timestamptz;
    v_total numeric;
    v_payment_method text;
    v_received_amount numeric;
    v_change_amount numeric;
    v_items jsonb;
    v_idempotency_items jsonb;
    v_idempotency_payload jsonb;
    v_price_divergence boolean := false;
    v_existing_review public.cash_register_late_sale_reviews%ROWTYPE;
    v_sale_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_quantity integer;
    v_current_product_price numeric;
    v_stock_quantity integer;
    v_rows integer;
    v_expected_total numeric := 0;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Late-sale review requires READ COMMITTED isolation'
            USING ERRCODE = '0A000';
    END IF;

    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an owner may decide late offline sales'
            USING ERRCODE = '42501';
    END IF;

    IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Decision must be approved or rejected'
            USING ERRCODE = '22023';
    END IF;

    IF p_accept_unverified_historical_values IS NULL
       OR p_accept_price_divergence IS NULL THEN
        RAISE EXCEPTION 'Historical-value and price-divergence decisions must be explicit'
            USING ERRCODE = '22023';
    END IF;

    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'A review reason of 1 to 1000 characters is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT admin_event.operator_user_id, admin_event.idempotency_key
    INTO v_operator_user_id, v_idempotency_key
    FROM public.cash_register_admin_events AS admin_event
    WHERE admin_event.id = p_admin_event_id
      AND admin_event.event_type = 'late_sale'
      AND admin_event.bakery_id = ANY (
          SELECT unnest(private.current_user_bakery_ids())
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No authorized late offline sale exists for this request'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            v_operator_user_id::text || ':' || v_idempotency_key::text,
            0
        )
    );

    SELECT
        admin_event.cash_register_id,
        admin_event.bakery_id,
        admin_event.operator_user_id,
        admin_event.review_status,
        admin_event.payload,
        admin_event.idempotency_key,
        admin_event.offline_session_id,
        admin_event.claimed_occurred_at
    INTO
        v_cash_register_id,
        v_bakery_id,
        v_operator_user_id,
        v_event_status,
        v_payload,
        v_idempotency_key,
        v_offline_session_id,
        v_occurred_at
    FROM public.cash_register_admin_events AS admin_event
    WHERE admin_event.id = p_admin_event_id
      AND admin_event.event_type = 'late_sale'
      AND admin_event.bakery_id = ANY (
          SELECT unnest(private.current_user_bakery_ids())
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No authorized late offline sale exists for this request'
            USING ERRCODE = '42501';
    END IF;

    PERFORM 1
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = v_cash_register_id
      AND cash_register.bakery_id = v_bakery_id
      AND cash_register.status = 'closed'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The late sale cash register is not closed'
            USING ERRCODE = '23514';
    END IF;

    SELECT review.*
    INTO v_existing_review
    FROM public.cash_register_late_sale_reviews AS review
    WHERE review.admin_event_id = p_admin_event_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_review.decision = p_decision
           AND v_existing_review.reason = btrim(p_reason)
           AND v_existing_review.historical_values_accepted
                = (p_decision = 'approved' AND p_accept_unverified_historical_values)
           AND v_existing_review.price_divergence_accepted
                = (p_decision = 'approved' AND p_accept_price_divergence) THEN
            RETURN coalesce(v_existing_review.sale_id, p_admin_event_id);
        END IF;

        RAISE EXCEPTION 'This late sale already has a conflicting administrative decision'
            USING ERRCODE = '23505';
    END IF;

    IF v_event_status IS DISTINCT FROM 'pending_review' THEN
        RAISE EXCEPTION 'This late sale is not pending review'
            USING ERRCODE = '23505';
    END IF;

    IF p_decision = 'rejected' THEN
        IF p_accept_unverified_historical_values OR p_accept_price_divergence THEN
            RAISE EXCEPTION 'A rejection cannot accept historical values or price divergence'
                USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.cash_register_late_sale_reviews (
            admin_event_id,
            cash_register_id,
            bakery_id,
            operator_user_id,
            reviewer_user_id,
            decision,
            reason
        )
        VALUES (
            p_admin_event_id,
            v_cash_register_id,
            v_bakery_id,
            v_operator_user_id,
            v_user_id,
            'rejected',
            btrim(p_reason)
        );

        UPDATE public.cash_register_admin_events
        SET review_status = 'rejected'
        WHERE id = p_admin_event_id;

        RETURN p_admin_event_id;
    END IF;

    IF p_accept_unverified_historical_values IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Approval requires explicit acceptance of unverified device-provided historical values'
            USING ERRCODE = '22023';
    END IF;

    v_total := (v_payload ->> 'total')::numeric;
    v_payment_method := v_payload ->> 'paymentMethod';
    v_received_amount := (v_payload ->> 'receivedAmount')::numeric;
    v_change_amount := (v_payload ->> 'changeAmount')::numeric;
    v_items := v_payload -> 'items';

    IF v_total IS NULL
       OR v_total <= 0
       OR v_total > 9999999999.99
       OR trunc(v_total, 2) <> v_total
       OR v_payment_method NOT IN ('cash', 'pix', 'card')
       OR jsonb_typeof(v_items) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'The quarantined sale payload is not financially valid'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_items) AS requested(item)
        WHERE jsonb_typeof(requested.item -> 'productId') IS DISTINCT FROM 'string'
           OR jsonb_typeof(requested.item -> 'name') IS DISTINCT FROM 'string'
           OR jsonb_typeof(requested.item -> 'barcode') IS DISTINCT FROM 'string'
           OR jsonb_typeof(requested.item -> 'price') IS DISTINCT FROM 'number'
           OR jsonb_typeof(requested.item -> 'quantity') IS DISTINCT FROM 'number'
           OR (requested.item ->> 'price')::numeric <= 0
           OR trunc((requested.item ->> 'price')::numeric, 2)
                <> (requested.item ->> 'price')::numeric
           OR (requested.item ->> 'quantity')::numeric <= 0
           OR (requested.item ->> 'quantity')::numeric
                <> trunc((requested.item ->> 'quantity')::numeric)
    ) THEN
        RAISE EXCEPTION 'The quarantined sale contains invalid historical item values'
            USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(sum(
        (requested.item ->> 'price')::numeric
        * (requested.item ->> 'quantity')::numeric
    ), 0)
    INTO v_expected_total
    FROM jsonb_array_elements(v_items) AS requested(item);

    IF v_expected_total IS DISTINCT FROM v_total THEN
        RAISE EXCEPTION 'The historical item snapshots do not match the stored sale total'
            USING ERRCODE = '22023';
    END IF;

    IF v_payment_method = 'cash' THEN
        IF v_received_amount IS NULL
           OR v_change_amount IS NULL
           OR v_received_amount < v_total
           OR v_change_amount < 0
           OR v_received_amount - v_total IS DISTINCT FROM v_change_amount THEN
            RAISE EXCEPTION 'The quarantined cash payment amounts are inconsistent'
                USING ERRCODE = '22023';
        END IF;
    ELSIF v_received_amount IS NOT NULL OR v_change_amount IS NOT NULL THEN
        RAISE EXCEPTION 'Non-cash quarantined sales must have null received amount and change'
            USING ERRCODE = '22023';
    END IF;

    SELECT jsonb_agg(
        jsonb_build_object(
            'product_id', item.value -> 'productId',
            'quantity', item.value -> 'quantity'
        )
        ORDER BY item.ordinality
    )
    INTO v_idempotency_items
    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS item(value, ordinality);

    v_idempotency_payload := jsonb_build_object(
        'cash_register_id', v_cash_register_id,
        'payment_method', v_payment_method,
        'received_amount', v_received_amount,
        'change_amount', v_change_amount,
        'items', v_idempotency_items
    );
    IF v_offline_session_id IS NOT NULL THEN
        v_idempotency_payload := v_idempotency_payload
            || jsonb_build_object('offline_session_id', v_offline_session_id);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.sales AS sale
        WHERE sale.cashier_user_id = v_operator_user_id
          AND sale.idempotency_key = v_idempotency_key
    ) THEN
        RAISE EXCEPTION 'The original idempotency key already belongs to a financial sale'
            USING ERRCODE = '23505';
    END IF;

    FOR v_item IN
        SELECT requested.value
        FROM jsonb_array_elements(v_items) AS requested(value)
        ORDER BY (requested.value ->> 'productId')::uuid
    LOOP
        v_product_id := (v_item ->> 'productId')::uuid;
        v_quantity := (v_item ->> 'quantity')::integer;

        SELECT product.price
        INTO v_current_product_price
        FROM public.products AS product
        WHERE product.id = v_product_id
          AND product.bakery_id = v_bakery_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'A historical sale product no longer belongs to this bakery'
                USING ERRCODE = '23503';
        END IF;

        IF v_current_product_price IS DISTINCT FROM
            (v_item ->> 'price')::numeric THEN
            v_price_divergence := true;
        END IF;

        PERFORM 1
        FROM public.product_stock AS stock
        WHERE stock.product_id = v_product_id
          AND stock.bakery_id = v_bakery_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Stock must be initialized before approving this historical sale'
                USING ERRCODE = '23514';
        END IF;

        SELECT stock.quantity
        INTO v_stock_quantity
        FROM public.product_stock AS stock
        WHERE stock.product_id = v_product_id
          AND stock.bakery_id = v_bakery_id;

        IF v_stock_quantity IS NULL OR v_stock_quantity < v_quantity THEN
            RAISE EXCEPTION 'Insufficient stock to approve historical sale for product %', v_product_id
                USING ERRCODE = '23514';
        END IF;
    END LOOP;

    IF v_price_divergence AND p_accept_price_divergence IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'The stored historical price differs from the current catalog; explicit divergence acceptance is required'
            USING ERRCODE = '22023';
    END IF;

    IF NOT v_price_divergence AND p_accept_price_divergence THEN
        RAISE EXCEPTION 'Price divergence was acknowledged but no divergence was detected'
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
        idempotency_payload,
        offline_session_id,
        occurred_at
    )
    VALUES (
        v_bakery_id,
        v_cash_register_id,
        v_operator_user_id,
        v_total,
        v_payment_method,
        v_received_amount,
        v_change_amount,
        v_idempotency_key,
        v_idempotency_payload,
        v_offline_session_id,
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
        (item.value ->> 'productId')::uuid,
        item.value ->> 'name',
        item.value ->> 'barcode',
        (item.value ->> 'price')::numeric,
        (item.value ->> 'quantity')::integer
    FROM jsonb_array_elements(v_items) AS item(value);

    FOR v_item IN
        SELECT requested.value
        FROM jsonb_array_elements(v_items) AS requested(value)
        ORDER BY (requested.value ->> 'productId')::uuid
    LOOP
        UPDATE public.product_stock AS stock
        SET quantity = stock.quantity - (v_item ->> 'quantity')::integer
        WHERE stock.product_id = (v_item ->> 'productId')::uuid
          AND stock.bakery_id = v_bakery_id
          AND stock.quantity >= (v_item ->> 'quantity')::integer;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
            RAISE EXCEPTION 'Stock changed while approving the historical sale'
                USING ERRCODE = '40001';
        END IF;
    END LOOP;

    INSERT INTO public.cash_register_late_sale_reviews (
        admin_event_id,
        cash_register_id,
        bakery_id,
        operator_user_id,
        reviewer_user_id,
        decision,
        reason,
        sale_id,
        historical_values_accepted,
        price_divergence_detected,
        price_divergence_accepted
    )
    VALUES (
        p_admin_event_id,
        v_cash_register_id,
        v_bakery_id,
        v_operator_user_id,
        v_user_id,
        'approved',
        btrim(p_reason),
        v_sale_id,
        true,
        v_price_divergence,
        p_accept_price_divergence
    );

    UPDATE public.cash_register_admin_events
    SET review_status = 'approved'
    WHERE id = p_admin_event_id;

    RETURN v_sale_id;
END;
$function$;

ALTER FUNCTION public.review_late_offline_sale(uuid, text, text, boolean, boolean)
    OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_late_offline_sale(uuid, text, text, boolean, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_late_offline_sale(uuid, text, text, boolean, boolean)
    TO authenticated;

CREATE FUNCTION public.reconcile_administratively_closed_cash_register(
    p_cash_register_id uuid,
    p_counted_amount numeric,
    p_reason text,
    p_acknowledge_unverified_offline_completeness boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_bakery_id uuid;
    v_initial_amount numeric;
    v_admin_event_id uuid;
    v_cash_sales_amount numeric;
    v_expected_amount numeric;
    v_difference_amount numeric;
    v_reconciliation_id uuid;
    v_existing_reconciliation public.cash_register_admin_reconciliations%ROWTYPE;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Administrative cash reconciliation requires READ COMMITTED isolation'
            USING ERRCODE = '0A000';
    END IF;

    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an owner may reconcile an administratively closed cash register'
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

    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'A reconciliation reason of 1 to 1000 characters is required'
            USING ERRCODE = '22023';
    END IF;

    IF p_acknowledge_unverified_offline_completeness IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Reconciliation requires explicit acknowledgement that offline sales completeness cannot be proven'
            USING ERRCODE = '22023';
    END IF;

    SELECT
        cash_register.bakery_id,
        cash_register.initial_amount
    INTO v_bakery_id, v_initial_amount
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = p_cash_register_id
      AND cash_register.status = 'closed'
      AND cash_register.bakery_id = ANY (
          SELECT unnest(private.current_user_bakery_ids())
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No authorized closed cash register exists for this request'
            USING ERRCODE = '42501';
    END IF;

    SELECT admin_event.id
    INTO v_admin_event_id
    FROM public.cash_register_admin_events AS admin_event
    WHERE admin_event.cash_register_id = p_cash_register_id
      AND admin_event.bakery_id = v_bakery_id
      AND admin_event.event_type = 'administrative_close'
      AND admin_event.review_status = 'financial_reconciliation_pending'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The cash register was not closed administratively'
            USING ERRCODE = '23514';
    END IF;

    SELECT reconciliation.*
    INTO v_existing_reconciliation
    FROM public.cash_register_admin_reconciliations AS reconciliation
    WHERE reconciliation.cash_register_id = p_cash_register_id
      AND reconciliation.bakery_id = v_bakery_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_reconciliation.reconciled_by = v_user_id
           AND v_existing_reconciliation.counted_amount = p_counted_amount
           AND v_existing_reconciliation.reason = btrim(p_reason)
           AND p_acknowledge_unverified_offline_completeness IS TRUE THEN
            RETURN v_existing_reconciliation.id;
        END IF;

        RAISE EXCEPTION 'This cash register already has a conflicting final reconciliation'
            USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.cash_closures AS closure
        WHERE closure.cash_register_id = p_cash_register_id
          AND closure.bakery_id = v_bakery_id
    ) THEN
        RAISE EXCEPTION 'A standard financial closure already exists; it will not be modified'
            USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.cash_register_admin_events AS late_sale
        WHERE late_sale.cash_register_id = p_cash_register_id
          AND late_sale.bakery_id = v_bakery_id
          AND late_sale.event_type = 'late_sale'
          AND late_sale.review_status = 'pending_review'
    ) THEN
        RAISE EXCEPTION 'Known late offline sales must be reviewed before reconciliation'
            USING ERRCODE = '23514';
    END IF;

    SELECT coalesce(sum(sale.total), 0)
    INTO v_cash_sales_amount
    FROM public.sales AS sale
    WHERE sale.cash_register_id = p_cash_register_id
      AND sale.bakery_id = v_bakery_id
      AND sale.payment_method = 'cash';

    v_expected_amount := v_initial_amount + v_cash_sales_amount;
    IF v_expected_amount IS NULL
       OR v_expected_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_expected_amount < 0
       OR v_expected_amount > 9999999999.99 THEN
        RAISE EXCEPTION 'Expected cash amount must fit numeric(12,2)'
            USING ERRCODE = '23514';
    END IF;

    v_difference_amount := p_counted_amount - v_expected_amount;

    INSERT INTO public.cash_register_admin_reconciliations (
        cash_register_id,
        bakery_id,
        administrative_close_event_id,
        reconciled_by,
        counted_amount,
        expected_amount,
        difference_amount,
        reason,
        unknown_offline_sales_acknowledged
    )
    VALUES (
        p_cash_register_id,
        v_bakery_id,
        v_admin_event_id,
        v_user_id,
        p_counted_amount,
        v_expected_amount,
        v_difference_amount,
        btrim(p_reason),
        true
    )
    RETURNING id INTO v_reconciliation_id;

    RETURN v_reconciliation_id;
END;
$function$;

ALTER FUNCTION public.reconcile_administratively_closed_cash_register(
    uuid, numeric, text, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_administratively_closed_cash_register(
    uuid, numeric, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_administratively_closed_cash_register(
    uuid, numeric, text, boolean
) TO authenticated;

COMMENT ON TABLE public.cash_register_late_sale_reviews IS
    'Append-only administrative decisions for quarantined offline sales; original payloads remain in cash_register_admin_events.';
COMMENT ON TABLE public.cash_register_admin_reconciliations IS
    'Exceptional reconciliation snapshots for administratively closed registers. Offline queue completeness is never asserted.';
COMMENT ON FUNCTION public.review_late_offline_sale(uuid, text, text, boolean, boolean) IS
    'Owners explicitly decide quarantined sales. Approval uses stored item prices, inserts one financial sale, and decrements stock once in the same transaction.';
COMMENT ON FUNCTION public.reconcile_administratively_closed_cash_register(uuid, numeric, text, boolean) IS
    'Records a one-time exceptional counted-cash reconciliation without modifying normal cash_closures and with explicit acknowledgement of unknown offline sales.';
