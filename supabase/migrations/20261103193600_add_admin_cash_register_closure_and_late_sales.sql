DO $migration$
BEGIN
    IF to_regclass('public.cash_registers') IS NULL
       OR to_regclass('public.bakeries') IS NULL
       OR to_regclass('public.users') IS NULL
       OR to_regclass('public.cash_closures') IS NULL
       OR to_regclass('public.sales') IS NULL
       OR to_regclass('public.products') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL
       OR to_regprocedure('private.current_user_bakery_id()') IS NULL
       OR to_regprocedure('private.current_user_bakery_ids()') IS NULL THEN
        RAISE EXCEPTION
            'Administrative cash register closure requires the established PDV schema and authorization helpers';
    END IF;
END;
$migration$;

CREATE TABLE public.cash_register_admin_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cash_register_id uuid NOT NULL
        REFERENCES public.cash_registers(id) ON DELETE RESTRICT,
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id) ON DELETE RESTRICT,
    operator_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    event_type text NOT NULL
        CHECK (event_type IN ('administrative_close', 'late_sale')),
    actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    server_recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    reason text,
    idempotency_key uuid,
    payload jsonb,
    offline_session_id uuid,
    claimed_occurred_at timestamptz,
    review_status text NOT NULL,
    retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    last_retry_at timestamptz,
    CONSTRAINT cash_register_admin_events_type_fields_check CHECK (
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
            AND review_status = 'pending_review'
        )
    )
);

CREATE UNIQUE INDEX cash_register_admin_events_one_close_per_register_uidx
    ON public.cash_register_admin_events (cash_register_id)
    WHERE event_type = 'administrative_close';

CREATE UNIQUE INDEX cash_register_admin_events_late_sale_idempotency_uidx
    ON public.cash_register_admin_events (operator_user_id, idempotency_key)
    WHERE event_type = 'late_sale';

CREATE INDEX cash_register_admin_events_history_idx
    ON public.cash_register_admin_events (bakery_id, cash_register_id, server_recorded_at);

COMMENT ON COLUMN public.cash_register_admin_events.claimed_occurred_at IS
    'Device-provided time claim for a quarantined sale; it is not proof of when the sale occurred.';

ALTER TABLE public.cash_register_admin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cash_register_admin_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cash_register_admin_events TO authenticated;

CREATE POLICY cash_register_admin_events_select_owner
    ON public.cash_register_admin_events
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        AND bakery_id = ANY (
            SELECT unnest(private.current_user_bakery_ids())
        )
    );

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

    IF v_user_id IS NOT NULL
       AND (SELECT private.is_owner())
       AND OLD.bakery_id = ANY (
           SELECT unnest(private.current_user_bakery_ids())
       )
       AND EXISTS (
           SELECT 1
           FROM public.cash_register_admin_events AS admin_event
           WHERE admin_event.cash_register_id = OLD.id
             AND admin_event.bakery_id = OLD.bakery_id
             AND admin_event.operator_user_id = OLD.opened_by
             AND admin_event.actor_user_id = v_user_id
             AND admin_event.event_type = 'administrative_close'
             AND admin_event.review_status = 'financial_reconciliation_pending'
       ) THEN
        RETURN NEW;
    END IF;

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

ALTER FUNCTION private.enforce_cash_register_state_transition() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_cash_register_state_transition()
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.administratively_close_overdue_cash_register(
    p_cash_register_id uuid,
    p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_bakery_id uuid;
    v_operator_user_id uuid;
    v_register_status text;
    v_opened_at timestamptz;
    v_deadline_hour smallint;
    v_opened_local timestamp without time zone;
    v_deadline_local timestamp without time zone;
    v_deadline_at timestamptz;
    v_now timestamptz;
    v_event_id uuid;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Administrative cash register closure requires READ COMMITTED isolation'
            USING ERRCODE = '0A000';
    END IF;

    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an owner may administratively close a cash register'
            USING ERRCODE = '42501';
    END IF;

    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'A reason of 1 to 500 characters is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT
        cash_register.bakery_id,
        cash_register.opened_by,
        cash_register.status,
        cash_register.opened_at
    INTO
        v_bakery_id,
        v_operator_user_id,
        v_register_status,
        v_opened_at
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = p_cash_register_id
      AND cash_register.bakery_id = ANY (
          SELECT unnest(private.current_user_bakery_ids())
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No authorized cash register exists for this request'
            USING ERRCODE = '42501';
    END IF;

    IF v_register_status = 'closed' THEN
        SELECT admin_event.id
        INTO v_event_id
        FROM public.cash_register_admin_events AS admin_event
        WHERE admin_event.cash_register_id = p_cash_register_id
          AND admin_event.bakery_id = v_bakery_id
          AND admin_event.event_type = 'administrative_close';

        IF FOUND THEN
            RETURN v_event_id;
        END IF;

        RAISE EXCEPTION 'A normally closed cash register cannot be administratively closed'
            USING ERRCODE = '23514';
    END IF;

    IF v_register_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'Only an open cash register can be administratively closed'
            USING ERRCODE = '23514';
    END IF;

    SELECT bakery.cash_register_deadline_hour
    INTO v_deadline_hour
    FROM public.bakeries AS bakery
    WHERE bakery.id = v_bakery_id
      AND bakery.active IS TRUE
      AND bakery.cash_register_monitoring_enabled IS TRUE
      AND bakery.cash_register_deadline_hour IS NOT NULL
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cash register deadline monitoring is not enabled for this bakery'
            USING ERRCODE = '23514';
    END IF;

    v_opened_local := v_opened_at AT TIME ZONE 'America/Sao_Paulo';
    v_deadline_local := v_opened_local::date
        + pg_catalog.make_interval(hours => v_deadline_hour::integer);
    IF v_deadline_local <= v_opened_local THEN
        v_deadline_local := v_deadline_local + interval '1 day';
    END IF;
    v_deadline_at := v_deadline_local AT TIME ZONE 'America/Sao_Paulo';
    v_now := pg_catalog.clock_timestamp();

    IF v_deadline_at > v_now THEN
        RAISE EXCEPTION 'The cash register has not reached its configured deadline'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.cash_register_admin_events (
        cash_register_id,
        bakery_id,
        operator_user_id,
        event_type,
        actor_user_id,
        server_recorded_at,
        reason,
        review_status
    )
    VALUES (
        p_cash_register_id,
        v_bakery_id,
        v_operator_user_id,
        'administrative_close',
        v_user_id,
        v_now,
        btrim(p_reason),
        'financial_reconciliation_pending'
    )
    RETURNING id INTO v_event_id;

    UPDATE public.cash_registers
    SET status = 'closed'
    WHERE id = p_cash_register_id
      AND bakery_id = v_bakery_id
      AND status = 'open';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cash register status changed before administrative closure completed'
            USING ERRCODE = '40001';
    END IF;

    RETURN v_event_id;
END;
$function$;

ALTER FUNCTION public.administratively_close_overdue_cash_register(uuid, text)
    OWNER TO postgres;
REVOKE ALL ON FUNCTION public.administratively_close_overdue_cash_register(uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.administratively_close_overdue_cash_register(uuid, text)
    TO authenticated;

CREATE FUNCTION public.receive_late_offline_sale(p_sale_payload jsonb)
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
    v_register_bakery_id uuid;
    v_register_operator_id uuid;
    v_register_opened_at timestamptz;
    v_admin_closed_at timestamptz;
    v_idempotency_key uuid;
    v_offline_session_id uuid;
    v_claimed_occurred_at timestamptz;
    v_total numeric;
    v_received_amount numeric;
    v_change_amount numeric;
    v_expected_total numeric := 0;
    v_item jsonb;
    v_product_id uuid;
    v_product_ids uuid[] := ARRAY[]::uuid[];
    v_quantity_numeric numeric;
    v_item_price numeric;
    v_existing_payload jsonb;
    v_existing_event_id uuid;
    v_event_id uuid;
    v_product_count bigint;
    v_payload jsonb;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Late offline sale receipt requires READ COMMITTED isolation'
            USING ERRCODE = '0A000';
    END IF;

    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.users AS cashier
        WHERE cashier.id = v_user_id
          AND cashier.role = 'cashier'
          AND cashier.active IS TRUE
    ) THEN
        RAISE EXCEPTION 'Only an active cashier can submit a late offline sale'
            USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_sale_payload) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_sale_payload -> 'cashRegisterId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_sale_payload -> 'bakeryId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_sale_payload -> 'operatorUserId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_sale_payload -> 'idempotencyKey') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_sale_payload -> 'occurredAt') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_sale_payload -> 'createdAt') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_sale_payload -> 'id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_sale_payload -> 'localRef') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_sale_payload -> 'paymentMethod') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_sale_payload -> 'items') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_sale_payload -> 'total') IS DISTINCT FROM 'number'
       OR NOT (p_sale_payload ? 'receivedAmount')
       OR NOT (p_sale_payload ? 'changeAmount')
       OR jsonb_typeof(p_sale_payload -> 'status') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Late offline sale payload is incomplete or malformed'
            USING ERRCODE = '22023';
    END IF;

    IF p_sale_payload ->> 'status' NOT IN ('pending', 'failed') THEN
        RAISE EXCEPTION 'Late offline sale has an invalid queue status'
            USING ERRCODE = '22023';
    END IF;

    BEGIN
        v_cash_register_id := (p_sale_payload ->> 'cashRegisterId')::uuid;
        v_bakery_id := (p_sale_payload ->> 'bakeryId')::uuid;
        v_operator_user_id := (p_sale_payload ->> 'operatorUserId')::uuid;
        v_idempotency_key := (p_sale_payload ->> 'idempotencyKey')::uuid;
        v_claimed_occurred_at := (p_sale_payload ->> 'occurredAt')::timestamptz;
        PERFORM (p_sale_payload ->> 'createdAt')::timestamptz;
        IF jsonb_typeof(p_sale_payload -> 'offlineSessionId') = 'string' THEN
            v_offline_session_id := (p_sale_payload ->> 'offlineSessionId')::uuid;
        ELSIF p_sale_payload ? 'offlineSessionId'
              AND jsonb_typeof(p_sale_payload -> 'offlineSessionId') IS DISTINCT FROM 'null' THEN
            RAISE EXCEPTION 'Invalid offline session identifier'
                USING ERRCODE = '22023';
        END IF;
        v_total := (p_sale_payload ->> 'total')::numeric;
    EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RAISE EXCEPTION 'Late offline sale contains an invalid identifier, time, or amount'
                USING ERRCODE = '22023';
    END;

    IF v_operator_user_id IS DISTINCT FROM v_user_id
       OR v_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Late offline sale must belong to the authenticated operator'
            USING ERRCODE = '42501';
    END IF;

    v_payload := p_sale_payload - 'status' - 'errorMessage' - 'remoteSaleId';

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            v_user_id::text || ':' || v_idempotency_key::text,
            0
        )
    );

    SELECT admin_event.id, admin_event.payload
    INTO v_existing_event_id, v_existing_payload
    FROM public.cash_register_admin_events AS admin_event
    WHERE admin_event.operator_user_id = v_user_id
      AND admin_event.idempotency_key = v_idempotency_key
      AND admin_event.event_type = 'late_sale'
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_payload IS DISTINCT FROM v_payload THEN
            RAISE EXCEPTION 'Idempotency key was already used with a different late sale payload'
                USING ERRCODE = '22023';
        END IF;

        UPDATE public.cash_register_admin_events
        SET retry_count = retry_count + 1,
            last_retry_at = pg_catalog.clock_timestamp()
        WHERE id = v_existing_event_id;
        RETURN v_existing_event_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.sales AS sale
        WHERE sale.cashier_user_id = v_user_id
          AND sale.idempotency_key = v_idempotency_key
    ) THEN
        RAISE EXCEPTION 'This idempotency key already belongs to a registered sale'
            USING ERRCODE = '23505';
    END IF;

    SELECT cash_register.bakery_id, cash_register.opened_by, cash_register.opened_at
    INTO v_register_bakery_id, v_register_operator_id, v_register_opened_at
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = v_cash_register_id
      AND cash_register.status = 'closed'
    FOR UPDATE;

    IF NOT FOUND
       OR v_register_bakery_id IS DISTINCT FROM v_bakery_id
       OR v_register_operator_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'The authenticated operator, bakery, and closed cash register do not match'
            USING ERRCODE = '42501';
    END IF;

    SELECT admin_event.server_recorded_at
    INTO v_admin_closed_at
    FROM public.cash_register_admin_events AS admin_event
    WHERE admin_event.cash_register_id = v_cash_register_id
      AND admin_event.bakery_id = v_bakery_id
      AND admin_event.operator_user_id = v_user_id
      AND admin_event.event_type = 'administrative_close'
      AND admin_event.review_status = 'financial_reconciliation_pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Late offline sales are only accepted for administratively closed cash registers'
            USING ERRCODE = '23514';
    END IF;

    IF v_claimed_occurred_at < v_register_opened_at
       OR v_claimed_occurred_at > v_admin_closed_at THEN
        RAISE EXCEPTION 'The device time claim falls outside the cash register open interval'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_sale_payload -> 'items') = 0
       OR jsonb_array_length(p_sale_payload -> 'items') > 500 THEN
        RAISE EXCEPTION 'A late offline sale must contain between 1 and 500 items'
            USING ERRCODE = '22023';
    END IF;

    IF v_total::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_total <= 0
       OR v_total > 9999999999.99
       OR trunc(v_total, 2) <> v_total THEN
        RAISE EXCEPTION 'Late offline sale total must be positive and fit numeric(12,2)'
            USING ERRCODE = '22023';
    END IF;

    FOR v_item IN
        SELECT item.value
        FROM jsonb_array_elements(p_sale_payload -> 'items') AS item(value)
    LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_item -> 'productId') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_item -> 'name') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_item -> 'barcode') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_item -> 'price') IS DISTINCT FROM 'number'
           OR jsonb_typeof(v_item -> 'quantity') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'Every late sale item requires a product UUID, name, barcode, price, and quantity'
                USING ERRCODE = '22023';
        END IF;

        BEGIN
            v_product_id := (v_item ->> 'productId')::uuid;
            v_item_price := (v_item ->> 'price')::numeric;
            v_quantity_numeric := (v_item ->> 'quantity')::numeric;
        EXCEPTION
            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                RAISE EXCEPTION 'Late sale item contains an invalid product or numeric value'
                    USING ERRCODE = '22023';
        END;

        IF v_item_price::text IN ('NaN', 'Infinity', '-Infinity')
           OR v_item_price <= 0
           OR v_item_price > 9999999999.99
           OR trunc(v_item_price, 2) <> v_item_price
           OR v_quantity_numeric <= 0
           OR v_quantity_numeric <> trunc(v_quantity_numeric)
           OR v_quantity_numeric > 2147483647
           OR array_position(v_product_ids, v_product_id) IS NOT NULL THEN
            RAISE EXCEPTION 'Late sale item price or quantity is invalid, or the product is repeated'
                USING ERRCODE = '22023';
        END IF;

        v_product_ids := array_append(v_product_ids, v_product_id);
        v_expected_total := v_expected_total + v_item_price * v_quantity_numeric;
    END LOOP;

    SELECT count(*)
    INTO v_product_count
    FROM public.products AS product
    WHERE product.id = ANY(v_product_ids)
      AND product.bakery_id = v_bakery_id;

    IF v_product_count <> cardinality(v_product_ids) THEN
        RAISE EXCEPTION 'Every late sale product must belong to the cash register bakery'
            USING ERRCODE = '23503';
    END IF;

    IF v_expected_total IS DISTINCT FROM v_total THEN
        RAISE EXCEPTION 'Late sale total does not match the submitted item prices and quantities'
            USING ERRCODE = '22023';
    END IF;

    IF p_sale_payload ->> 'paymentMethod' NOT IN ('cash', 'pix', 'card') THEN
        RAISE EXCEPTION 'Late sale payment method is invalid'
            USING ERRCODE = '22023';
    END IF;

    IF p_sale_payload ->> 'paymentMethod' = 'cash' THEN
        IF jsonb_typeof(p_sale_payload -> 'receivedAmount') IS DISTINCT FROM 'number'
           OR jsonb_typeof(p_sale_payload -> 'changeAmount') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'Cash late sales require received amount and change'
                USING ERRCODE = '22023';
        END IF;
        BEGIN
            v_received_amount := (p_sale_payload ->> 'receivedAmount')::numeric;
            v_change_amount := (p_sale_payload ->> 'changeAmount')::numeric;
        EXCEPTION
            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                RAISE EXCEPTION 'Cash late sale amounts are invalid'
                    USING ERRCODE = '22023';
        END;

        IF v_received_amount::text IN ('NaN', 'Infinity', '-Infinity')
           OR v_change_amount::text IN ('NaN', 'Infinity', '-Infinity')
           OR v_received_amount < v_total
           OR v_change_amount < 0
           OR v_received_amount > 9999999999.99
           OR v_change_amount > 9999999999.99
           OR trunc(v_received_amount, 2) <> v_received_amount
           OR trunc(v_change_amount, 2) <> v_change_amount
           OR v_received_amount - v_total IS DISTINCT FROM v_change_amount THEN
            RAISE EXCEPTION 'Cash late sale received amount or change is inconsistent'
                USING ERRCODE = '22023';
        END IF;
    ELSIF jsonb_typeof(p_sale_payload -> 'receivedAmount') IS DISTINCT FROM 'null'
       OR jsonb_typeof(p_sale_payload -> 'changeAmount') IS DISTINCT FROM 'null' THEN
        RAISE EXCEPTION 'Non-cash late sales must have null received amount and change'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.cash_register_admin_events (
        cash_register_id,
        bakery_id,
        operator_user_id,
        event_type,
        actor_user_id,
        idempotency_key,
        payload,
        offline_session_id,
        claimed_occurred_at,
        review_status
    )
    VALUES (
        v_cash_register_id,
        v_bakery_id,
        v_user_id,
        'late_sale',
        v_user_id,
        v_idempotency_key,
        v_payload,
        v_offline_session_id,
        v_claimed_occurred_at,
        'pending_review'
    )
    RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$function$;

ALTER FUNCTION public.receive_late_offline_sale(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.receive_late_offline_sale(jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_late_offline_sale(jsonb)
    TO authenticated;
