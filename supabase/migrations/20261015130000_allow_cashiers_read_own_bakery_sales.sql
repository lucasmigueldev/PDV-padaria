DO $migration$
BEGIN
    IF to_regclass('public.sales') IS NULL
       OR to_regclass('public.sale_items') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL
       OR to_regprocedure('private.current_user_bakery_id()') IS NULL THEN
        RAISE EXCEPTION
            'Sales history authorization requires the established sales tables and authorization helpers';
    END IF;
END;
$migration$;

-- Replace only the read policies created by the operational-read migration.
-- Sales writes are performed by protected RPCs, not by FOR ALL policies.
-- Fail closed if an unexpected permissive read or FOR ALL policy remains.
-- This avoids weakening unknown write policies or leaving a broader read path.
DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies AS policy
        WHERE policy.schemaname = 'public'
          AND policy.tablename IN ('sales', 'sale_items')
          AND policy.cmd IN ('SELECT', 'ALL')
          AND NOT (
              (policy.tablename = 'sales'
               AND policy.policyname = 'sales_select_owner'
               AND policy.cmd = 'SELECT')
              OR
              (policy.tablename = 'sale_items'
               AND policy.policyname = 'sale_items_select_owner'
               AND policy.cmd = 'SELECT')
          )
    ) THEN
        RAISE EXCEPTION
            'Unexpected sales or sale_items read policy remains; review it before applying bakery-scoped history authorization';
    END IF;
END;
$migration$;

DROP POLICY IF EXISTS sales_select_owner
    ON public.sales;

DROP POLICY IF EXISTS sale_items_select_owner
    ON public.sale_items;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_select_owner_or_cashier_own_bakery
    ON public.sales
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (
            (SELECT private.is_cashier())
            AND bakery_id = (SELECT private.current_user_bakery_id())
        )
    );

CREATE POLICY sale_items_select_owner_or_cashier_own_bakery
    ON public.sale_items
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (
            (SELECT private.is_cashier())
            AND EXISTS (
                SELECT 1
                FROM public.sales AS sale
                WHERE sale.id = sale_items.sale_id
                  AND sale.bakery_id = (SELECT private.current_user_bakery_id())
            )
        )
    );
