-- Depends on the base operational tables and private authorization helpers
-- referenced by the already-applied bakery-specific product migration.

DO $migration$
BEGIN
    IF to_regclass('public.cash_registers') IS NULL
       OR to_regclass('public.cash_closures') IS NULL
       OR to_regclass('public.sales') IS NULL
       OR to_regclass('public.sale_items') IS NULL
       OR to_regclass('public.product_stock') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL
       OR to_regprocedure('private.current_user_bakery_id()') IS NULL THEN
        RAISE EXCEPTION
            'Operational read authorization requires the established operational tables and authorization helpers';
    END IF;
END;
$migration$;

-- Replace existing read and ALL policies on the operational tables, so
-- permissive legacy policies cannot widen the new bakery and role boundaries.
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
          AND policy.cmd IN ('SELECT', 'ALL')
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

ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cash_registers,
                      public.cash_closures,
                      public.sales,
                      public.sale_items,
                      public.product_stock
    FROM anon;

GRANT SELECT ON TABLE public.cash_registers,
                     public.cash_closures,
                     public.sales,
                     public.sale_items,
                     public.product_stock
    TO authenticated;

CREATE POLICY cash_registers_select_by_role_and_bakery
    ON public.cash_registers
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (
            (SELECT private.is_cashier())
            AND bakery_id = (SELECT private.current_user_bakery_id())
        )
    );

CREATE POLICY cash_closures_select_owner
    ON public.cash_closures
    FOR SELECT
    TO authenticated
    USING ((SELECT private.is_owner()));

CREATE POLICY sales_select_owner
    ON public.sales
    FOR SELECT
    TO authenticated
    USING ((SELECT private.is_owner()));

CREATE POLICY sale_items_select_owner
    ON public.sale_items
    FOR SELECT
    TO authenticated
    USING ((SELECT private.is_owner()));

CREATE POLICY product_stock_select_by_role_and_bakery
    ON public.product_stock
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (
            (SELECT private.is_cashier())
            AND bakery_id = (SELECT private.current_user_bakery_id())
        )
    );
