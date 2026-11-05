\set ON_ERROR_STOP on

\ir adminCashRegisterBackend.sql

ALTER TABLE public.users ADD COLUMN name text;
UPDATE public.users
SET name = CASE id
    WHEN '20000000-0000-4000-8000-000000000001' THEN 'Owner'
    WHEN '20000000-0000-4000-8000-000000000002' THEN 'Operator One'
    WHEN '20000000-0000-4000-8000-000000000003' THEN 'Operator Two'
    ELSE 'Inactive Operator'
END;

\ir ../supabase/migrations/20261103201700_add_late_sale_review_and_admin_reconciliation.sql

CREATE TEMP TABLE review_test_events (
    event_label text PRIMARY KEY,
    admin_event_id uuid NOT NULL
);

CREATE TEMP TABLE review_test_stock AS
SELECT product_id, quantity AS initial_quantity
FROM public.product_stock
WHERE product_id = '30000000-0000-4000-8000-000000000001';

DO $test$
DECLARE
    v_payload jsonb;
    v_event_id uuid;
    v_register_opened_at timestamptz;
    v_fixture record;
BEGIN
    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000002',
        false
    );

    SELECT opened_at INTO v_register_opened_at
    FROM public.cash_registers
    WHERE id = '40000000-0000-4000-8000-000000000001';

    FOR v_fixture IN
        SELECT *
        FROM (VALUES
            ('approval', '50000000-0000-4000-8000-000000000040'::uuid, 1, 'cash', 10::numeric),
            ('insufficient-stock', '50000000-0000-4000-8000-000000000041'::uuid, 11, 'pix', 110::numeric),
            ('rejection', '50000000-0000-4000-8000-000000000042'::uuid, 1, 'pix', 10::numeric),
            ('reconcile-pending', '50000000-0000-4000-8000-000000000043'::uuid, 1, 'pix', 10::numeric)
        ) AS fixture(event_label, idempotency_key, quantity, payment_method, amount)
    LOOP
        v_payload := jsonb_build_object(
            'id', v_fixture.idempotency_key,
            'idempotencyKey', v_fixture.idempotency_key,
            'localRef', v_fixture.idempotency_key,
            'offlineSessionId', NULL,
            'cashRegisterId', '40000000-0000-4000-8000-000000000001',
            'bakeryId', '10000000-0000-4000-8000-000000000001',
            'operatorUserId', '20000000-0000-4000-8000-000000000002',
            'occurredAt', (v_register_opened_at + interval '1 minute')::text,
            'createdAt', pg_catalog.clock_timestamp()::text,
            'paymentMethod', v_fixture.payment_method,
            'receivedAmount', CASE
                WHEN v_fixture.payment_method = 'cash' THEN v_fixture.amount
                ELSE NULL
            END,
            'changeAmount', CASE
                WHEN v_fixture.payment_method = 'cash' THEN 0
                ELSE NULL
            END,
            'total', v_fixture.amount,
            'items', jsonb_build_array(jsonb_build_object(
                'productId', '30000000-0000-4000-8000-000000000001',
                'name', 'Produto',
                'barcode', '123',
                'price', 10,
                'quantity', v_fixture.quantity
            )),
            'status', 'pending'
        );

        v_event_id := public.receive_late_offline_sale(v_payload);
        INSERT INTO review_test_events VALUES (v_fixture.event_label, v_event_id);
    END LOOP;

    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000001',
        false
    );

    FOR v_event_id IN
        SELECT admin_event.id
        FROM public.cash_register_admin_events AS admin_event
        WHERE admin_event.cash_register_id =
                '40000000-0000-4000-8000-000000000001'
          AND admin_event.event_type = 'late_sale'
          AND admin_event.review_status = 'pending_review'
          AND NOT EXISTS (
              SELECT 1 FROM review_test_events AS test_event
              WHERE test_event.admin_event_id = admin_event.id
          )
    LOOP
        PERFORM public.review_late_offline_sale(
            v_event_id,
            'rejected',
            'Pre-existing test fixture reviewed before reconciliation',
            false,
            false
        );
    END LOOP;
END;
$test$;

DO $test$
DECLARE
    v_count integer;
    v_detail record;
BEGIN
    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000001',
        false
    );

    SELECT count(*) INTO v_count
    FROM public.list_pending_late_offline_sales(
        '40000000-0000-4000-8000-000000000001'
    );

    IF v_count < 4 THEN
        RAISE EXCEPTION 'Owner pending-sale list omitted quarantined events';
    END IF;

    SELECT * INTO v_detail
    FROM public.get_late_offline_sale_review_details(
        (SELECT admin_event_id FROM review_test_events WHERE event_label = 'approval')
    );

    IF v_detail.operator_user_id IS DISTINCT FROM
            '20000000-0000-4000-8000-000000000002'::uuid
       OR v_detail.operator_name IS DISTINCT FROM 'Operator One'
       OR v_detail.payload ->> 'paymentMethod' IS DISTINCT FROM 'cash'
       OR v_detail.idempotency_key IS DISTINCT FROM
            '50000000-0000-4000-8000-000000000040'::uuid THEN
        RAISE EXCEPTION 'Late-sale detail omitted operator, payment, or idempotency metadata';
    END IF;

    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000002',
        false
    );

    BEGIN
        PERFORM * FROM public.list_pending_late_offline_sales(
            '40000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'An operator unexpectedly listed pending late sales';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM public.review_late_offline_sale(
            (SELECT admin_event_id FROM review_test_events WHERE event_label = 'approval'),
            'approved',
            'operator attempt',
            true,
            false
        );
        RAISE EXCEPTION 'An operator unexpectedly reviewed a late sale';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM public.reconcile_administratively_closed_cash_register(
            '40000000-0000-4000-8000-000000000001',
            60,
            'operator attempt',
            true
        );
        RAISE EXCEPTION 'An operator unexpectedly reconciled a register';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000001',
        false
    );

    BEGIN
        PERFORM * FROM public.list_pending_late_offline_sales(
            '40000000-0000-4000-8000-000000000004'
        );
        RAISE EXCEPTION 'An owner unexpectedly accessed a register outside the active bakery scope';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    IF has_table_privilege('authenticated', 'public.sales', 'INSERT')
       OR has_table_privilege('authenticated', 'public.product_stock', 'UPDATE')
       OR has_table_privilege(
            'authenticated',
            'public.cash_register_late_sale_reviews',
            'INSERT'
       ) THEN
        RAISE EXCEPTION 'Authenticated users received direct financial or review write privileges';
    END IF;
END;
$test$;

DO $test$
DECLARE
    v_event_id uuid;
    v_sale_id uuid;
    v_retry_sale_id uuid;
    v_stock integer;
    v_count integer;
BEGIN
    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000001',
        false
    );

    SELECT admin_event_id INTO v_event_id
    FROM review_test_events WHERE event_label = 'approval';

    UPDATE public.products SET price = 11
    WHERE id = '30000000-0000-4000-8000-000000000001';

    BEGIN
        PERFORM public.review_late_offline_sale(
            v_event_id, 'approved', 'Price history reviewed', true, false
        );
        RAISE EXCEPTION 'Approval unexpectedly ignored a historical/current price divergence';
    EXCEPTION
        WHEN invalid_parameter_value THEN NULL;
    END;

    v_sale_id := public.review_late_offline_sale(
        v_event_id,
        'approved',
        'Approved stored historical price after explicit catalog divergence review',
        true,
        true
    );

    v_retry_sale_id := public.review_late_offline_sale(
        v_event_id,
        'approved',
        'Approved stored historical price after explicit catalog divergence review',
        true,
        true
    );

    IF v_retry_sale_id IS DISTINCT FROM v_sale_id THEN
        RAISE EXCEPTION 'Repeated approval did not return the same financial sale';
    END IF;

    UPDATE public.products SET price = 10
    WHERE id = '30000000-0000-4000-8000-000000000001';

    SELECT quantity INTO v_stock
    FROM public.product_stock
    WHERE product_id = '30000000-0000-4000-8000-000000000001';

    SELECT count(*) INTO v_count FROM public.sales
    WHERE idempotency_key = '50000000-0000-4000-8000-000000000040'
      AND total = 10;

    IF v_stock <> (
            SELECT initial_quantity - 1
            FROM review_test_stock
            WHERE product_id = '30000000-0000-4000-8000-000000000001'
       )
       OR v_count <> 1
       OR (SELECT price FROM public.sale_items WHERE sale_id = v_sale_id) <> 10
       OR (SELECT price_divergence_detected FROM public.cash_register_late_sale_reviews
           WHERE admin_event_id = v_event_id) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Approval did not preserve the historical price and decrement stock exactly once';
    END IF;

    BEGIN
        PERFORM public.review_late_offline_sale(
            v_event_id, 'rejected', 'Conflicting decision', false, false
        );
        RAISE EXCEPTION 'A conflicting second decision unexpectedly succeeded';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;

    SELECT admin_event_id INTO v_event_id
    FROM review_test_events WHERE event_label = 'insufficient-stock';

    BEGIN
        PERFORM public.review_late_offline_sale(
            v_event_id, 'approved', 'Cannot fulfill current stock', true, false
        );
        RAISE EXCEPTION 'Approval unexpectedly allowed insufficient stock';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    IF (SELECT review_status FROM public.cash_register_admin_events
        WHERE id = v_event_id) <> 'pending_review'
       OR EXISTS (SELECT 1 FROM public.sales
           WHERE idempotency_key = '50000000-0000-4000-8000-000000000041')
       OR (SELECT quantity FROM public.product_stock
           WHERE product_id = '30000000-0000-4000-8000-000000000001')
            <> (SELECT initial_quantity - 1 FROM review_test_stock
                WHERE product_id = '30000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'Failed stock validation partially recorded a late sale';
    END IF;

    PERFORM public.review_late_offline_sale(
        v_event_id,
        'rejected',
        'Rejected because available stock could not be reconciled safely',
        false,
        false
    );

    SELECT admin_event_id INTO v_event_id
    FROM review_test_events WHERE event_label = 'rejection';
    v_sale_id := public.review_late_offline_sale(
        v_event_id, 'rejected', 'Rejected after documentary review', false, false
    );
    IF v_sale_id IS DISTINCT FROM v_event_id
       OR (SELECT review_status FROM public.cash_register_admin_events
           WHERE id = v_event_id) <> 'rejected'
       OR EXISTS (SELECT 1 FROM public.sales
           WHERE idempotency_key = '50000000-0000-4000-8000-000000000042') THEN
        RAISE EXCEPTION 'Rejection did not preserve quarantine without creating financial records';
    END IF;

    SELECT admin_event_id INTO v_event_id
    FROM review_test_events WHERE event_label = 'reconcile-pending';
    BEGIN
        PERFORM public.reconcile_administratively_closed_cash_register(
            '40000000-0000-4000-8000-000000000001',
            58,
            'Counted cash with unresolved offline sale',
            true
        );
        RAISE EXCEPTION 'Reconciliation unexpectedly succeeded with a pending late sale';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    PERFORM public.review_late_offline_sale(
        v_event_id, 'rejected', 'Rejected before reconciliation', false, false
    );
END;
$test$;

DO $test$
DECLARE
    v_reconciliation_id uuid;
    v_retry_id uuid;
BEGIN
    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000001',
        false
    );

    BEGIN
        PERFORM public.reconcile_administratively_closed_cash_register(
            '40000000-0000-4000-8000-000000000001',
            58,
            'Missing risk acknowledgement',
            false
        );
        RAISE EXCEPTION 'Reconciliation unexpectedly omitted the unknown-sales acknowledgement';
    EXCEPTION
        WHEN invalid_parameter_value THEN NULL;
    END;

    v_reconciliation_id := public.reconcile_administratively_closed_cash_register(
        '40000000-0000-4000-8000-000000000001',
        58,
        'Counted cash; offline queue completeness cannot be proven',
        true
    );

    v_retry_id := public.reconcile_administratively_closed_cash_register(
        '40000000-0000-4000-8000-000000000001',
        58,
        'Counted cash; offline queue completeness cannot be proven',
        true
    );

    IF v_retry_id IS DISTINCT FROM v_reconciliation_id
       OR (SELECT expected_amount FROM public.cash_register_admin_reconciliations
           WHERE id = v_reconciliation_id) <> 60
       OR (SELECT difference_amount FROM public.cash_register_admin_reconciliations
           WHERE id = v_reconciliation_id) <> -2
       OR (SELECT reconciliation_mode FROM public.cash_register_admin_reconciliations
           WHERE id = v_reconciliation_id)
            <> 'exceptional_unverified_offline_completeness'
       OR EXISTS (SELECT 1 FROM public.cash_closures
           WHERE cash_register_id = '40000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'Exceptional reconciliation values, idempotency, or normal closure isolation failed';
    END IF;

    BEGIN
        PERFORM public.reconcile_administratively_closed_cash_register(
            '40000000-0000-4000-8000-000000000001',
            59,
            'Conflicting count',
            true
        );
        RAISE EXCEPTION 'A conflicting final reconciliation unexpectedly succeeded';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;
END;
$test$;

DO $test$
DECLARE
    v_event_id uuid;
    v_reconciliation_id uuid;
    v_concurrent_event_id uuid;
    v_review_retry_event_id uuid;
BEGIN
    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000002',
        false
    );

    v_event_id := public.receive_late_offline_sale(jsonb_build_object(
        'id', '50000000-0000-4000-8000-000000000044',
        'idempotencyKey', '50000000-0000-4000-8000-000000000044',
        'localRef', '50000000-0000-4000-8000-000000000044',
        'offlineSessionId', NULL,
        'cashRegisterId', '40000000-0000-4000-8000-000000000001',
        'bakeryId', '10000000-0000-4000-8000-000000000001',
        'operatorUserId', '20000000-0000-4000-8000-000000000002',
        'occurredAt', (
            SELECT (opened_at + interval '2 minutes')::text
            FROM public.cash_registers
            WHERE id = '40000000-0000-4000-8000-000000000001'
        ),
        'createdAt', pg_catalog.clock_timestamp()::text,
        'paymentMethod', 'pix',
        'receivedAmount', NULL,
        'changeAmount', NULL,
        'total', 10,
        'items', jsonb_build_array(jsonb_build_object(
            'productId', '30000000-0000-4000-8000-000000000001',
            'name', 'Produto',
            'barcode', '123',
            'price', 10,
            'quantity', 1
        )),
        'status', 'pending'
    ));
    INSERT INTO review_test_events VALUES ('late-after-reconcile', v_event_id);

    v_concurrent_event_id := public.receive_late_offline_sale(jsonb_build_object(
        'id', '50000000-0000-4000-8000-000000000045',
        'idempotencyKey', '50000000-0000-4000-8000-000000000045',
        'localRef', '50000000-0000-4000-8000-000000000045',
        'offlineSessionId', NULL,
        'cashRegisterId', '40000000-0000-4000-8000-000000000001',
        'bakeryId', '10000000-0000-4000-8000-000000000001',
        'operatorUserId', '20000000-0000-4000-8000-000000000002',
        'occurredAt', (
            SELECT (opened_at + interval '3 minutes')::text
            FROM public.cash_registers
            WHERE id = '40000000-0000-4000-8000-000000000001'
        ),
        'createdAt', pg_catalog.clock_timestamp()::text,
        'paymentMethod', 'pix',
        'receivedAmount', NULL,
        'changeAmount', NULL,
        'total', 10,
        'items', jsonb_build_array(jsonb_build_object(
            'productId', '30000000-0000-4000-8000-000000000001',
            'name', 'Produto',
            'barcode', '123',
            'price', 10,
            'quantity', 1
        )),
        'status', 'pending'
    ));
    INSERT INTO review_test_events VALUES ('concurrent-review', v_concurrent_event_id);

    v_review_retry_event_id := public.receive_late_offline_sale(jsonb_build_object(
        'id', '50000000-0000-4000-8000-000000000046',
        'idempotencyKey', '50000000-0000-4000-8000-000000000046',
        'localRef', '50000000-0000-4000-8000-000000000046',
        'offlineSessionId', NULL,
        'cashRegisterId', '40000000-0000-4000-8000-000000000001',
        'bakeryId', '10000000-0000-4000-8000-000000000001',
        'operatorUserId', '20000000-0000-4000-8000-000000000002',
        'occurredAt', (
            SELECT (opened_at + interval '4 minutes')::text
            FROM public.cash_registers
            WHERE id = '40000000-0000-4000-8000-000000000001'
        ),
        'createdAt', pg_catalog.clock_timestamp()::text,
        'paymentMethod', 'pix',
        'receivedAmount', NULL,
        'changeAmount', NULL,
        'total', 10,
        'items', jsonb_build_array(jsonb_build_object(
            'productId', '30000000-0000-4000-8000-000000000001',
            'name', 'Produto',
            'barcode', '123',
            'price', 10,
            'quantity', 1
        )),
        'status', 'pending'
    ));
    INSERT INTO review_test_events VALUES ('review-retry-race', v_review_retry_event_id);

    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000001',
        false
    );

    SELECT id INTO v_reconciliation_id
    FROM public.cash_register_admin_reconciliations
    WHERE cash_register_id = '40000000-0000-4000-8000-000000000001';

    IF (SELECT late_sales_received_after_reconciliation
        FROM public.cash_register_admin_reconciliations
        WHERE id = v_reconciliation_id) IS DISTINCT FROM true
       OR (SELECT expected_amount FROM public.cash_register_admin_reconciliations
           WHERE id = v_reconciliation_id) <> 60 THEN
        RAISE EXCEPTION 'A later offline sale was not flagged without rewriting the reconciliation snapshot';
    END IF;

    PERFORM set_config(
        'request.jwt.claim.sub',
        '20000000-0000-4000-8000-000000000001',
        false
    );
    PERFORM public.review_late_offline_sale(
        v_event_id,
        'approved',
        'Approved after reconciliation with explicit historical-value acknowledgement',
        true,
        false
    );

    IF (SELECT quantity FROM public.product_stock
        WHERE product_id = '30000000-0000-4000-8000-000000000001')
        <> (SELECT initial_quantity - 2 FROM review_test_stock
            WHERE product_id = '30000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'A post-reconciliation approved sale was not recorded exactly once';
    END IF;
END;
$test$;

CREATE FUNCTION public.test_pause_reviewed_sale()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.idempotency_key IN (
        '50000000-0000-4000-8000-000000000045',
        '50000000-0000-4000-8000-000000000046'
    ) THEN
        PERFORM pg_catalog.pg_sleep(0.5);
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER test_pause_reviewed_sale
    BEFORE INSERT ON public.sales
    FOR EACH ROW
    EXECUTE FUNCTION public.test_pause_reviewed_sale();

SELECT dblink_connect(
    'review_one',
    format(
        'dbname=%s host=%s port=%s user=postgres',
        current_database(),
        inet_server_addr(),
        current_setting('port')
    )
);
SELECT dblink_connect(
    'review_two',
    format(
        'dbname=%s host=%s port=%s user=postgres',
        current_database(),
        inet_server_addr(),
        current_setting('port')
    )
);
SELECT dblink_exec(
    'review_one',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000001'''
);
SELECT dblink_exec(
    'review_two',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000001'''
);
SELECT dblink_send_query(
    'review_one',
    format(
        'SELECT public.review_late_offline_sale(%L::uuid, %L, %L, true, false)',
        (SELECT admin_event_id FROM review_test_events WHERE event_label = 'concurrent-review'),
        'approved',
        'Concurrent identical administrative approval'
    )
);
SELECT pg_catalog.pg_sleep(0.05);
SELECT dblink_send_query(
    'review_two',
    format(
        'SELECT public.review_late_offline_sale(%L::uuid, %L, %L, true, false)',
        (SELECT admin_event_id FROM review_test_events WHERE event_label = 'concurrent-review'),
        'approved',
        'Concurrent identical administrative approval'
    )
);

CREATE TEMP TABLE concurrent_review_results (sale_id uuid);
INSERT INTO concurrent_review_results
SELECT result.sale_id FROM dblink_get_result('review_one') AS result(sale_id uuid);
INSERT INTO concurrent_review_results
SELECT result.sale_id FROM dblink_get_result('review_two') AS result(sale_id uuid);
SELECT * FROM dblink_get_result('review_one') AS result(sale_id uuid);
SELECT * FROM dblink_get_result('review_two') AS result(sale_id uuid);

DO $test$
BEGIN
    IF (SELECT count(*) FROM concurrent_review_results) <> 2
       OR (SELECT count(DISTINCT sale_id) FROM concurrent_review_results) <> 1
       OR (SELECT count(*) FROM public.sales
           WHERE idempotency_key = '50000000-0000-4000-8000-000000000045') <> 1
       OR (SELECT count(*) FROM public.cash_register_late_sale_reviews
           WHERE admin_event_id = (
               SELECT admin_event_id FROM review_test_events
               WHERE event_label = 'concurrent-review'
           )) <> 1
       OR (SELECT quantity FROM public.product_stock
           WHERE product_id = '30000000-0000-4000-8000-000000000001')
            <> (SELECT initial_quantity - 3 FROM review_test_stock
                WHERE product_id = '30000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'Concurrent duplicate reviews created conflicting or duplicate sales';
    END IF;
END;
$test$;

SELECT dblink_exec(
    'review_one',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000001'''
);
SELECT dblink_exec(
    'review_two',
    'SET request.jwt.claim.sub = ''20000000-0000-4000-8000-000000000002'''
);
SELECT dblink_send_query(
    'review_one',
    format(
        'SELECT public.review_late_offline_sale(%L::uuid, %L, %L, true, false)',
        (SELECT admin_event_id FROM review_test_events WHERE event_label = 'review-retry-race'),
        'approved',
        'Approval racing a duplicate device retry'
    )
);
SELECT pg_catalog.pg_sleep(0.05);
SELECT dblink_send_query(
    'review_two',
    format(
        'SELECT public.receive_late_offline_sale(%L::jsonb)',
        (
            SELECT (admin_event.payload || jsonb_build_object('status', 'pending'))::text
            FROM public.cash_register_admin_events AS admin_event
            WHERE admin_event.id = (
                SELECT admin_event_id
                FROM review_test_events
                WHERE event_label = 'review-retry-race'
            )
        )
    )
);

CREATE TEMP TABLE review_retry_race_results (result_id uuid);
INSERT INTO review_retry_race_results
SELECT result.result_id FROM dblink_get_result('review_one') AS result(result_id uuid);
INSERT INTO review_retry_race_results
SELECT result.result_id FROM dblink_get_result('review_two') AS result(result_id uuid);
SELECT * FROM dblink_get_result('review_one') AS result(result_id uuid);
SELECT * FROM dblink_get_result('review_two') AS result(result_id uuid);

DO $test$
BEGIN
    IF (SELECT count(*) FROM review_retry_race_results) <> 2
       OR (SELECT count(*) FROM public.sales
           WHERE idempotency_key = '50000000-0000-4000-8000-000000000046') <> 1
       OR (SELECT retry_count FROM public.cash_register_admin_events
           WHERE idempotency_key = '50000000-0000-4000-8000-000000000046'
             AND event_type = 'late_sale') <> 1
       OR (SELECT count(*) FROM public.cash_register_late_sale_reviews
           WHERE admin_event_id = (
               SELECT admin_event_id FROM review_test_events
               WHERE event_label = 'review-retry-race'
           )) <> 1
       OR (SELECT quantity FROM public.product_stock
           WHERE product_id = '30000000-0000-4000-8000-000000000001')
            <> (SELECT initial_quantity - 4 FROM review_test_stock
                WHERE product_id = '30000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'A concurrent device retry and review deadlocked or duplicated financial/inventory changes';
    END IF;
END;
$test$;

SELECT dblink_disconnect('review_one');
SELECT dblink_disconnect('review_two');

\echo 'PASS: late-sale review and exceptional reconciliation backend checks'
