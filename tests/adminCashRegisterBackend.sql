\set ON_ERROR_STOP on

DO $test$
BEGIN
    IF current_database() NOT LIKE 'pdv_admin_backend_test_%' THEN
        RAISE EXCEPTION
            'Run this integration test only in a disposable database named pdv_admin_backend_test_*';
    END IF;
END;
$test$;

DO $test$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'CREATE ROLE anon NOLOGIN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'CREATE ROLE authenticated NOLOGIN';
    END IF;
END;
$test$;

CREATE SCHEMA auth;
CREATE SCHEMA private;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$function$;

CREATE TABLE public.users (
    id uuid PRIMARY KEY,
    role text NOT NULL,
    active boolean NOT NULL DEFAULT true
);

CREATE TABLE public.bakeries (
    id uuid PRIMARY KEY,
    active boolean NOT NULL DEFAULT true,
    cash_register_monitoring_enabled boolean NOT NULL DEFAULT false,
    cash_register_deadline_hour smallint
);

CREATE TABLE public.user_bakeries (
    user_id uuid NOT NULL REFERENCES public.users(id),
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id),
    PRIMARY KEY (user_id, bakery_id)
);

CREATE TABLE public.cash_registers (
    id uuid PRIMARY KEY,
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id),
    opened_by uuid NOT NULL REFERENCES public.users(id),
    opened_at timestamptz NOT NULL,
    initial_amount numeric(12, 2) NOT NULL,
    status text NOT NULL CHECK (status IN ('open', 'closed'))
);

CREATE TABLE public.cash_closures (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cash_register_id uuid NOT NULL REFERENCES public.cash_registers(id),
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id),
    closed_by uuid NOT NULL REFERENCES public.users(id),
    counted_amount numeric(12, 2),
    cash_sales_amount numeric(12, 2),
    expected_amount numeric(12, 2),
    difference_amount numeric(12, 2)
);

CREATE TABLE public.sales (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id),
    cash_register_id uuid NOT NULL REFERENCES public.cash_registers(id),
    cashier_user_id uuid NOT NULL REFERENCES public.users(id),
    total numeric(12, 2),
    payment_method text,
    received_amount numeric(12, 2),
    change_amount numeric(12, 2),
    idempotency_key uuid,
    idempotency_payload jsonb,
    occurred_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE UNIQUE INDEX sales_cashier_idempotency_key_uidx
    ON public.sales (cashier_user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE public.products (
    id uuid PRIMARY KEY,
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id),
    name text NOT NULL,
    barcode text NOT NULL,
    price numeric(12, 2) NOT NULL
);

CREATE TABLE public.sale_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id uuid NOT NULL REFERENCES public.sales(id),
    product_id uuid REFERENCES public.products(id),
    name text NOT NULL,
    barcode text NOT NULL,
    price numeric(12, 2) NOT NULL,
    quantity integer NOT NULL
);

CREATE TABLE public.product_stock (
    product_id uuid PRIMARY KEY REFERENCES public.products(id),
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id),
    quantity integer NOT NULL
);

CREATE FUNCTION private.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'owner'
    );
$function$;

CREATE FUNCTION private.is_cashier()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.users AS cashier
        JOIN public.user_bakeries AS assignment ON assignment.user_id = cashier.id
        JOIN public.bakeries AS bakery ON bakery.id = assignment.bakery_id
        WHERE cashier.id = auth.uid()
          AND cashier.role = 'cashier'
          AND cashier.active
          AND bakery.active
    );
$function$;

CREATE FUNCTION private.current_user_bakery_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
AS $function$
    SELECT CASE
        WHEN private.is_owner() THEN (
            SELECT array_agg(id) FROM public.bakeries WHERE active
        )
        ELSE (
            SELECT array_agg(assignment.bakery_id)
            FROM public.user_bakeries AS assignment
            JOIN public.users AS cashier ON cashier.id = assignment.user_id
            JOIN public.bakeries AS bakery ON bakery.id = assignment.bakery_id
            WHERE cashier.id = auth.uid()
              AND cashier.active
              AND bakery.active
        )
    END;
$function$;

CREATE FUNCTION private.current_user_bakery_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
    SELECT (private.current_user_bakery_ids())[1];
$function$;

\set ON_ERROR_STOP off
CREATE FUNCTION public.create_sale_with_items(
    uuid, text, numeric, numeric, jsonb, uuid, timestamptz
)
RETURNS uuid
LANGUAGE sql
AS $function$
    SELECT gen_random_uuid();
$function$;
\set ON_ERROR_STOP on

\ir ../supabase/migrations/20261102174500_add_offline_sale_session_id.sql
\ir ../supabase/migrations/20261103193600_add_admin_cash_register_closure_and_late_sales.sql

CREATE TRIGGER cash_register_state_transition_guard
    BEFORE UPDATE ON public.cash_registers
    FOR EACH ROW
    EXECUTE FUNCTION private.enforce_cash_register_state_transition();

INSERT INTO public.bakeries (
    id, active, cash_register_monitoring_enabled, cash_register_deadline_hour
)
VALUES
    (
        '10000000-0000-4000-8000-000000000001',
        true,
        true,
        (extract(hour FROM (pg_catalog.clock_timestamp() AT TIME ZONE 'America/Sao_Paulo'))::integer + 1) % 24
    ),
    (
        '10000000-0000-4000-8000-000000000002',
        true,
        true,
        (extract(hour FROM (pg_catalog.clock_timestamp() AT TIME ZONE 'America/Sao_Paulo'))::integer + 1) % 24
    ),
    ('10000000-0000-4000-8000-000000000003', false, true, 23);

INSERT INTO public.users (id, role, active)
VALUES
    ('20000000-0000-4000-8000-000000000001', 'owner', true),
    ('20000000-0000-4000-8000-000000000002', 'cashier', true),
    ('20000000-0000-4000-8000-000000000003', 'cashier', true),
    ('20000000-0000-4000-8000-000000000004', 'cashier', false);

INSERT INTO public.user_bakeries (user_id, bakery_id)
VALUES
    ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'),
    ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
    ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001');

INSERT INTO public.products (id, bakery_id, name, barcode, price)
VALUES
    ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Produto', '123', 10),
    ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Outro produto', '456', 10);

INSERT INTO public.product_stock (product_id, bakery_id, quantity)
VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 10);

INSERT INTO public.cash_registers (id, bakery_id, opened_by, opened_at, initial_amount, status)
VALUES
    (
        '40000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        pg_catalog.clock_timestamp() - interval '2 days',
        50,
        'open'
    ),
    (
        '40000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        pg_catalog.clock_timestamp() - interval '30 minutes',
        50,
        'open'
    ),
    (
        '40000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000003',
        pg_catalog.clock_timestamp() - interval '2 days',
        50,
        'open'
    ),
    (
        '40000000-0000-4000-8000-000000000004',
        '10000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000004',
        pg_catalog.clock_timestamp() - interval '2 days',
        50,
        'open'
    ),
    (
        '40000000-0000-4000-8000-000000000005',
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        pg_catalog.clock_timestamp() - interval '2 days',
        50,
        'open'
    ),
    (
        '40000000-0000-4000-8000-000000000006',
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        pg_catalog.clock_timestamp() - interval '2 days',
        50,
        'open'
    ),
    (
        '40000000-0000-4000-8000-000000000007',
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        pg_catalog.clock_timestamp() - interval '2 days',
        50,
        'open'
    );

DO $test$
DECLARE
    v_event_id uuid;
    v_retry_event_id uuid;
    v_sale_event_id uuid;
    v_payload jsonb;
BEGIN
    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000002',
        false
    );

    BEGIN
        PERFORM public.administratively_close_overdue_cash_register(
            '40000000-0000-4000-8000-000000000001',
            'tentativa de operador'
        );
        RAISE EXCEPTION 'Cashier unexpectedly administratively closed a register';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000001',
        false
    );

    BEGIN
        PERFORM public.administratively_close_overdue_cash_register(
            '40000000-0000-4000-8000-000000000002',
            'caixa ainda no prazo'
        );
        RAISE EXCEPTION 'A non-overdue register was unexpectedly closed';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        PERFORM public.administratively_close_overdue_cash_register(
            '40000000-0000-4000-8000-000000000004',
            'padaria inativa'
        );
        RAISE EXCEPTION 'An unauthorized inactive bakery register was unexpectedly closed';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    v_event_id := public.administratively_close_overdue_cash_register(
        '40000000-0000-4000-8000-000000000001',
        'operador indisponível'
    );

    IF (SELECT status FROM public.cash_registers
        WHERE id = '40000000-0000-4000-8000-000000000001') <> 'closed' THEN
        RAISE EXCEPTION 'Administrative close did not close the register';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cash_closures
        WHERE cash_register_id = '40000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'Administrative close created an invented financial closure';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.cash_register_admin_events
        WHERE id = v_event_id
          AND actor_user_id = '20000000-0000-4000-8000-000000000001'
          AND operator_user_id = '20000000-0000-4000-8000-000000000002'
          AND reason = 'operador indisponível'
          AND review_status = 'financial_reconciliation_pending'
          AND server_recorded_at <= pg_catalog.clock_timestamp()
    ) THEN
        RAISE EXCEPTION 'Administrative close audit record is incomplete';
    END IF;

    v_retry_event_id := public.administratively_close_overdue_cash_register(
        '40000000-0000-4000-8000-000000000001',
        'motivo repetido não substitui o original'
    );
    IF v_retry_event_id IS DISTINCT FROM v_event_id THEN
        RAISE EXCEPTION 'Repeated administrative close did not return the original event';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.administratively_close_overdue_cash_register(uuid,text)',
        'EXECUTE'
    )
       OR has_function_privilege(
           'authenticated',
           'public.administratively_close_overdue_cash_register(uuid,text)',
           'EXECUTE'
       ) IS FALSE
       OR has_table_privilege('authenticated', 'public.cash_register_admin_events', 'INSERT') THEN
        RAISE EXCEPTION 'Administrative backend privileges are broader than intended';
    END IF;

    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000002',
        false
    );

    v_payload := jsonb_build_object(
        'id', '50000000-0000-4000-8000-000000000001',
        'idempotencyKey', '50000000-0000-4000-8000-000000000001',
        'localRef', '50000000-0000-4000-8000-000000000001',
        'offlineSessionId', '60000000-0000-4000-8000-000000000001',
        'cashRegisterId', '40000000-0000-4000-8000-000000000001',
        'bakeryId', '10000000-0000-4000-8000-000000000001',
        'operatorUserId', '20000000-0000-4000-8000-000000000002',
        'occurredAt', (
            SELECT (opened_at + interval '1 minute')::text
            FROM public.cash_registers
            WHERE id = '40000000-0000-4000-8000-000000000001'
        ),
        'createdAt', pg_catalog.clock_timestamp()::text,
        'paymentMethod', 'cash',
        'receivedAmount', 10,
        'changeAmount', 0,
        'total', 10,
        'items', jsonb_build_array(jsonb_build_object(
            'productId', '30000000-0000-4000-8000-000000000001',
            'name', 'Produto',
            'barcode', '123',
            'price', 10,
            'quantity', 1
        )),
        'status', 'pending'
    );

    v_sale_event_id := public.receive_late_offline_sale(v_payload);

    IF NOT EXISTS (
        SELECT 1
        FROM public.cash_register_admin_events
        WHERE id = v_sale_event_id
          AND event_type = 'late_sale'
          AND review_status = 'pending_review'
          AND claimed_occurred_at < server_recorded_at
          AND payload = v_payload - 'status'
    ) THEN
        RAISE EXCEPTION 'Late sale was not stored in quarantine with its untrusted time claim';
    END IF;

    v_retry_event_id := public.receive_late_offline_sale(
        (v_payload - 'status') || jsonb_build_object(
            'status', 'failed',
            'errorMessage', 'ordinary sync rejected after closure'
        )
    );
    IF v_retry_event_id IS DISTINCT FROM v_sale_event_id THEN
        RAISE EXCEPTION 'Retry did not return the original quarantined event';
    END IF;
    IF (SELECT retry_count FROM public.cash_register_admin_events
        WHERE id = v_sale_event_id) <> 1 THEN
        RAISE EXCEPTION 'Idempotent retry was not recorded';
    END IF;

    BEGIN
        PERFORM public.receive_late_offline_sale(
            (v_payload - 'status') || jsonb_build_object(
                'status', 'failed',
                'total', 11,
                'errorMessage', 'changed financial content'
            )
        );
        RAISE EXCEPTION 'Changed payload unexpectedly reused an idempotency key';
    EXCEPTION
        WHEN invalid_parameter_value THEN NULL;
    END;

    BEGIN
        PERFORM public.receive_late_offline_sale(
            (v_payload - 'status') || jsonb_build_object(
                'status', 'failed',
                'idempotencyKey', '50000000-0000-4000-8000-000000000005',
                'occurredAt', (
                    SELECT (server_recorded_at + interval '1 minute')::text
                    FROM public.cash_register_admin_events
                    WHERE id = v_event_id
                )
            )
        );
        RAISE EXCEPTION 'A device time claim after administrative closure was accepted';
    EXCEPTION
        WHEN invalid_parameter_value THEN NULL;
    END;

    BEGIN
        PERFORM public.receive_late_offline_sale(
            (v_payload - 'status') || jsonb_build_object(
                'status', 'failed',
                'idempotencyKey', '50000000-0000-4000-8000-000000000006',
                'bakeryId', '10000000-0000-4000-8000-000000000002',
                'cashRegisterId', '40000000-0000-4000-8000-000000000003',
                'items', jsonb_build_array(jsonb_build_object(
                    'productId', '30000000-0000-4000-8000-000000000002',
                    'name', 'Outro produto',
                    'barcode', '456',
                    'price', 10,
                    'quantity', 1
                ))
            )
        );
        RAISE EXCEPTION 'A cashier submitted a sale for a different bakery';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM public.receive_late_offline_sale(
            (v_payload - 'status') || jsonb_build_object(
                'status', 'failed',
                'idempotencyKey', '50000000-0000-4000-8000-000000000002',
                'items', jsonb_build_array(jsonb_build_object(
                    'productId', '30000000-0000-4000-8000-000000000001',
                    'name', 'Produto',
                    'barcode', '123',
                    'price', 10,
                    'quantity', 1.5
                ))
            )
        );
        RAISE EXCEPTION 'A fractional item quantity was unexpectedly accepted';
    EXCEPTION
        WHEN invalid_parameter_value THEN NULL;
    END;

    BEGIN
        PERFORM public.receive_late_offline_sale(
            (v_payload - 'status') || jsonb_build_object(
                'status', 'failed',
                'idempotencyKey', '50000000-0000-4000-8000-000000000003',
                'bakeryId', '10000000-0000-4000-8000-000000000002',
                'cashRegisterId', '40000000-0000-4000-8000-000000000001',
                'operatorUserId', '20000000-0000-4000-8000-000000000002',
                'items', jsonb_build_array(jsonb_build_object(
                    'productId', '30000000-0000-4000-8000-000000000002',
                    'name', 'Outro produto',
                    'barcode', '456',
                    'price', 10,
                    'quantity', 1
                ))
            )
        );
        RAISE EXCEPTION 'A cashier submitted a sale for a bakery they do not belong to';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    IF (SELECT quantity FROM public.product_stock
        WHERE product_id = '30000000-0000-4000-8000-000000000001') <> 10
       OR EXISTS (SELECT 1 FROM public.sales
           WHERE idempotency_key = '50000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'Quarantine changed inventory or created a financial sale';
    END IF;

    INSERT INTO public.cash_closures (
        id, cash_register_id, bakery_id, closed_by,
        counted_amount, cash_sales_amount, expected_amount, difference_amount
    )
    VALUES (
        '70000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000006',
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
        50, 0, 50, 0
    );
    UPDATE public.cash_registers
    SET status = 'closed'
    WHERE id = '40000000-0000-4000-8000-000000000006';

    BEGIN
        PERFORM public.receive_late_offline_sale(
            (v_payload - 'status') || jsonb_build_object(
                'status', 'failed',
                'idempotencyKey', '50000000-0000-4000-8000-000000000004',
                'cashRegisterId', '40000000-0000-4000-8000-000000000006'
            )
        );
        RAISE EXCEPTION 'Late sale was accepted for a register not administratively closed';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000001',
        false
    );
    BEGIN
        UPDATE public.cash_registers
        SET status = 'closed'
        WHERE id = '40000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'A direct duplicate register transition unexpectedly succeeded';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    IF (SELECT status FROM public.cash_registers
        WHERE id = '40000000-0000-4000-8000-000000000006') <> 'closed' THEN
        RAISE EXCEPTION 'Normal operator closure compatibility regressed';
    END IF;
END;
$test$;

CREATE EXTENSION dblink;

CREATE FUNCTION public.test_pause_admin_register_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.status = 'open' AND NEW.status = 'closed' THEN
        PERFORM pg_catalog.pg_sleep(0.5);
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER test_pause_admin_register_update
    BEFORE UPDATE OF status ON public.cash_registers
    FOR EACH ROW
    EXECUTE FUNCTION public.test_pause_admin_register_update();

CREATE FUNCTION public.test_create_sale_with_items(
    p_cash_register_id uuid,
    p_idempotency_key uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_error_message text;
BEGIN
    RETURN public.create_sale_with_items(
        p_cash_register_id,
        'cash',
        10,
        0,
        jsonb_build_array(jsonb_build_object(
            'product_id', '30000000-0000-4000-8000-000000000001',
            'quantity', 1
        )),
        p_idempotency_key,
        (
            SELECT cash_register.opened_at + interval '1 minute'
            FROM public.cash_registers AS cash_register
            WHERE cash_register.id = p_cash_register_id
        ),
        '60000000-0000-4000-8000-000000000021'
    );
EXCEPTION
    WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
        IF v_error_message <> 'No open cash register exists for this bakery' THEN
            RAISE;
        END IF;
        RETURN NULL;
END;
$function$;

CREATE FUNCTION public.test_pause_real_sale_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.idempotency_key = '50000000-0000-4000-8000-000000000021' THEN
        PERFORM pg_catalog.pg_sleep(0.5);
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER test_pause_real_sale_insert
    BEFORE INSERT ON public.sales
    FOR EACH ROW
    EXECUTE FUNCTION public.test_pause_real_sale_insert();

SELECT dblink_connect(
    'admin_close_one',
    format(
        'dbname=%s host=%s port=%s user=postgres',
        current_database(),
        inet_server_addr(),
        current_setting('port')
    )
);
SELECT dblink_connect(
    'admin_close_two',
    format(
        'dbname=%s host=%s port=%s user=postgres',
        current_database(),
        inet_server_addr(),
        current_setting('port')
    )
);
SELECT dblink_exec(
    'admin_close_one',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000001'''
);
SELECT dblink_exec(
    'admin_close_two',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000001'''
);

SELECT dblink_exec(
    'admin_close_one',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000002'''
);
SELECT dblink_send_query(
    'admin_close_one',
    'SELECT public.test_create_sale_with_items(''40000000-0000-4000-8000-000000000005'', ''50000000-0000-4000-8000-000000000021'')'
);
SELECT pg_catalog.pg_sleep(0.1);
SELECT dblink_send_query(
    'admin_close_two',
    'SELECT public.administratively_close_overdue_cash_register(''40000000-0000-4000-8000-000000000005'', ''sale wins register lock'')'
);

CREATE TEMP TABLE normal_sale_first_result (sale_id uuid);
CREATE TEMP TABLE close_after_sale_result (event_id uuid);
INSERT INTO normal_sale_first_result
SELECT result.sale_inserted
FROM dblink_get_result('admin_close_one') AS result(sale_inserted uuid);
INSERT INTO close_after_sale_result
SELECT result.event_id
FROM dblink_get_result('admin_close_two') AS result(event_id uuid);
SELECT * FROM dblink_get_result('admin_close_one') AS result(sale_inserted uuid);
SELECT * FROM dblink_get_result('admin_close_two') AS result(event_id uuid);

DO $test$
BEGIN
    IF (SELECT sale_id FROM normal_sale_first_result) IS NULL
       OR NOT EXISTS (
           SELECT 1 FROM public.sales
           WHERE idempotency_key = '50000000-0000-4000-8000-000000000021'
       )
       OR NOT EXISTS (
           SELECT 1
           FROM public.sale_items AS item
           JOIN public.sales AS sale ON sale.id = item.sale_id
           WHERE sale.idempotency_key = '50000000-0000-4000-8000-000000000021'
             AND item.quantity = 1
             AND item.price = 10
       )
       OR (SELECT quantity FROM public.product_stock
           WHERE product_id = '30000000-0000-4000-8000-000000000001') <> 9
       OR (SELECT status FROM public.cash_registers
           WHERE id = '40000000-0000-4000-8000-000000000005') <> 'closed'
       OR NOT EXISTS (
           SELECT 1 FROM close_after_sale_result
           WHERE event_id IS NOT NULL
       ) THEN
        RAISE EXCEPTION 'In-flight normal sale did not serialize before administrative closure';
    END IF;
END;
$test$;

DO $test$
DECLARE
    v_sale_id uuid;
    v_retry_sale_id uuid;
BEGIN
    SELECT sale.id INTO v_sale_id
    FROM public.sales AS sale
    WHERE sale.idempotency_key = '50000000-0000-4000-8000-000000000021';

    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000002',
        false
    );
    v_retry_sale_id := public.create_sale_with_items(
        '40000000-0000-4000-8000-000000000005',
        'cash',
        10,
        0,
        '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]',
        '50000000-0000-4000-8000-000000000021',
        (
            SELECT opened_at + interval '1 minute'
            FROM public.cash_registers
            WHERE id = '40000000-0000-4000-8000-000000000005'
        ),
        '60000000-0000-4000-8000-000000000021'
    );

    IF v_retry_sale_id IS DISTINCT FROM v_sale_id
       OR (SELECT quantity FROM public.product_stock
           WHERE product_id = '30000000-0000-4000-8000-000000000001') <> 9
       OR EXISTS (
           SELECT 1 FROM public.cash_register_admin_events
           WHERE event_type = 'late_sale'
             AND idempotency_key = '50000000-0000-4000-8000-000000000021'
       ) THEN
        RAISE EXCEPTION 'A confirmed normal sale retry was duplicated or sent to quarantine';
    END IF;

    BEGIN
        PERFORM public.receive_late_offline_sale(jsonb_build_object(
            'id', '50000000-0000-4000-8000-000000000021',
            'idempotencyKey', '50000000-0000-4000-8000-000000000021',
            'localRef', '50000000-0000-4000-8000-000000000021',
            'offlineSessionId', '60000000-0000-4000-8000-000000000021',
            'cashRegisterId', '40000000-0000-4000-8000-000000000005',
            'bakeryId', '10000000-0000-4000-8000-000000000001',
            'operatorUserId', '20000000-0000-4000-8000-000000000002',
            'occurredAt', (
                SELECT (opened_at + interval '1 minute')::text
                FROM public.cash_registers
                WHERE id = '40000000-0000-4000-8000-000000000005'
            ),
            'createdAt', pg_catalog.clock_timestamp()::text,
            'paymentMethod', 'cash',
            'receivedAmount', 10,
            'changeAmount', 0,
            'total', 10,
            'items', jsonb_build_array(jsonb_build_object(
                'productId', '30000000-0000-4000-8000-000000000001',
                'name', 'Produto',
                'barcode', '123',
                'price', 10,
                'quantity', 1
            )),
            'status', 'failed'
        ));
        RAISE EXCEPTION 'A confirmed financial sale was accepted into late-sale quarantine';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;

    IF EXISTS (
        SELECT 1 FROM public.cash_register_admin_events
        WHERE event_type = 'late_sale'
          AND idempotency_key = '50000000-0000-4000-8000-000000000021'
    ) THEN
        RAISE EXCEPTION 'A confirmed normal sale was incorrectly quarantined';
    END IF;
END;
$test$;

SELECT dblink_exec(
    'admin_close_one',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000001'''
);
SELECT dblink_send_query(
    'admin_close_one',
    'SELECT public.administratively_close_overdue_cash_register(''40000000-0000-4000-8000-000000000007'', ''close wins register lock'')'
);
SELECT pg_catalog.pg_sleep(0.1);
SELECT dblink_exec(
    'admin_close_two',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000002'''
);
SELECT dblink_send_query(
    'admin_close_two',
    'SELECT public.test_create_sale_with_items(''40000000-0000-4000-8000-000000000007'', ''50000000-0000-4000-8000-000000000022'')'
);

CREATE TEMP TABLE close_before_sale_result (event_id uuid);
CREATE TEMP TABLE normal_sale_rejected_result (sale_id uuid);
INSERT INTO close_before_sale_result
SELECT result.event_id
FROM dblink_get_result('admin_close_one') AS result(event_id uuid);
INSERT INTO normal_sale_rejected_result
SELECT result.sale_inserted
FROM dblink_get_result('admin_close_two') AS result(sale_inserted uuid);
SELECT * FROM dblink_get_result('admin_close_one') AS result(event_id uuid);
SELECT * FROM dblink_get_result('admin_close_two') AS result(sale_inserted uuid);

DO $test$
BEGIN
    IF (SELECT sale_id FROM normal_sale_rejected_result) IS NOT NULL
       OR EXISTS (
           SELECT 1 FROM public.sales
           WHERE idempotency_key = '50000000-0000-4000-8000-000000000022'
       )
       OR NOT EXISTS (
           SELECT 1 FROM close_before_sale_result
           WHERE event_id IS NOT NULL
       ) THEN
        RAISE EXCEPTION 'Normal sale was not rejected after administrative closure won the register lock';
    END IF;
END;
$test$;

SELECT dblink_exec(
    'admin_close_one',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000001'''
);
SELECT dblink_exec(
    'admin_close_two',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000001'''
);
SELECT dblink_send_query(
    'admin_close_one',
    'SELECT public.administratively_close_overdue_cash_register(''40000000-0000-4000-8000-000000000003'', ''concurrent close'')'
);
SELECT pg_catalog.pg_sleep(0.1);
SELECT dblink_send_query(
    'admin_close_two',
    'SELECT public.administratively_close_overdue_cash_register(''40000000-0000-4000-8000-000000000003'', ''concurrent close'')'
);

CREATE TEMP TABLE admin_close_results (event_id uuid);
INSERT INTO admin_close_results
SELECT result.event_id
FROM dblink_get_result('admin_close_one') AS result(event_id uuid);
INSERT INTO admin_close_results
SELECT result.event_id
FROM dblink_get_result('admin_close_two') AS result(event_id uuid);
SELECT * FROM dblink_get_result('admin_close_one') AS result(event_id uuid);
SELECT * FROM dblink_get_result('admin_close_two') AS result(event_id uuid);

DO $test$
BEGIN
    IF (SELECT count(*) FROM admin_close_results) <> 2
       OR (SELECT count(DISTINCT event_id) FROM admin_close_results) <> 1
       OR (SELECT count(*) FROM public.cash_register_admin_events
           WHERE cash_register_id = '40000000-0000-4000-8000-000000000003'
             AND event_type = 'administrative_close') <> 1 THEN
        RAISE EXCEPTION 'Concurrent administrative close was not serialized idempotently';
    END IF;
END;
$test$;

CREATE FUNCTION public.test_pause_late_sale_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.event_type = 'late_sale' THEN
        PERFORM pg_catalog.pg_sleep(0.5);
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER test_pause_late_sale_insert
    BEFORE INSERT ON public.cash_register_admin_events
    FOR EACH ROW
    EXECUTE FUNCTION public.test_pause_late_sale_insert();

SELECT dblink_exec(
    'admin_close_one',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000003'''
);
SELECT dblink_exec(
    'admin_close_two',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000003'''
);

SELECT dblink_send_query(
    'admin_close_one',
    format(
        'SELECT public.receive_late_offline_sale(%L::jsonb)',
        jsonb_build_object(
            'id', '50000000-0000-4000-8000-000000000011',
            'idempotencyKey', '50000000-0000-4000-8000-000000000011',
            'localRef', '50000000-0000-4000-8000-000000000011',
            'offlineSessionId', NULL,
            'cashRegisterId', '40000000-0000-4000-8000-000000000003',
            'bakeryId', '10000000-0000-4000-8000-000000000002',
            'operatorUserId', '20000000-0000-4000-8000-000000000003',
            'occurredAt', (
                SELECT (opened_at + interval '1 minute')::text
                FROM public.cash_registers
                WHERE id = '40000000-0000-4000-8000-000000000003'
            ),
            'createdAt', '2026-11-03T19:00:01Z',
            'paymentMethod', 'pix',
            'receivedAmount', NULL,
            'changeAmount', NULL,
            'total', 10,
            'items', jsonb_build_array(jsonb_build_object(
                'productId', '30000000-0000-4000-8000-000000000002',
                'name', 'Produto',
                'barcode', '456',
                'price', 10,
                'quantity', 1
            )),
            'status', 'pending'
        )::text
    )
);
SELECT pg_catalog.pg_sleep(0.1);
SELECT dblink_send_query(
    'admin_close_two',
    format(
        'SELECT public.receive_late_offline_sale(%L::jsonb)',
        jsonb_build_object(
            'id', '50000000-0000-4000-8000-000000000011',
            'idempotencyKey', '50000000-0000-4000-8000-000000000011',
            'localRef', '50000000-0000-4000-8000-000000000011',
            'offlineSessionId', NULL,
            'cashRegisterId', '40000000-0000-4000-8000-000000000003',
            'bakeryId', '10000000-0000-4000-8000-000000000002',
            'operatorUserId', '20000000-0000-4000-8000-000000000003',
            'occurredAt', (
                SELECT (opened_at + interval '1 minute')::text
                FROM public.cash_registers
                WHERE id = '40000000-0000-4000-8000-000000000003'
            ),
            'createdAt', '2026-11-03T19:00:01Z',
            'paymentMethod', 'pix',
            'receivedAmount', NULL,
            'changeAmount', NULL,
            'total', 10,
            'items', jsonb_build_array(jsonb_build_object(
                'productId', '30000000-0000-4000-8000-000000000002',
                'name', 'Produto',
                'barcode', '456',
                'price', 10,
                'quantity', 1
            )),
            'status', 'pending'
        )::text
    )
);

CREATE TEMP TABLE late_sale_results (event_id uuid);
INSERT INTO late_sale_results
SELECT result.event_id
FROM dblink_get_result('admin_close_one') AS result(event_id uuid);
INSERT INTO late_sale_results
SELECT result.event_id
FROM dblink_get_result('admin_close_two') AS result(event_id uuid);
SELECT * FROM dblink_get_result('admin_close_one') AS result(event_id uuid);
SELECT * FROM dblink_get_result('admin_close_two') AS result(event_id uuid);

DO $test$
BEGIN
    IF (SELECT count(*) FROM late_sale_results) <> 2
       OR (SELECT count(DISTINCT event_id) FROM late_sale_results) <> 1
       OR (SELECT count(*) FROM public.cash_register_admin_events
           WHERE idempotency_key = '50000000-0000-4000-8000-000000000011'
             AND event_type = 'late_sale') <> 1
       OR (SELECT retry_count FROM public.cash_register_admin_events
           WHERE idempotency_key = '50000000-0000-4000-8000-000000000011') <> 1 THEN
        RAISE EXCEPTION 'Concurrent late-sale submissions were not idempotent';
    END IF;
END;
$test$;

SELECT dblink_disconnect('admin_close_one');
SELECT dblink_disconnect('admin_close_two');

\echo 'PASS: administrative closure and late-sale backend integration checks'
