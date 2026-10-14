-- Depends on the established users/bakeries tables and private authorization
-- helpers. Auth user creation/deletion and credential changes stay in the
-- Supabase Auth administrative service, not in SQL functions.

DO $migration$
BEGIN
    IF to_regclass('public.users') IS NULL
       OR to_regclass('public.bakeries') IS NULL
       OR to_regclass('public.cash_registers') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL
       OR to_regprocedure('private.current_user_bakery_id()') IS NULL THEN
        RAISE EXCEPTION
            'Bakery administration requires the established users, bakeries, cash registers, and authorization helpers';
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION private.prevent_deactivating_bakery_with_open_cash_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF OLD.active IS TRUE AND NEW.active IS FALSE THEN
        IF current_setting('transaction_isolation') <> 'read committed' THEN
            RAISE EXCEPTION 'Bakery deactivation requires READ COMMITTED isolation'
                USING ERRCODE = '0A000';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.cash_registers AS cash_register
            WHERE cash_register.bakery_id = OLD.id
              AND cash_register.status = 'open'
        ) THEN
            RAISE EXCEPTION 'A bakery cannot be deactivated while a cash register is open'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION private.prevent_deactivating_bakery_with_open_cash_register()
    OWNER TO postgres;

REVOKE ALL ON FUNCTION private.prevent_deactivating_bakery_with_open_cash_register()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_bakery_deactivation_with_open_cash_register
    ON public.bakeries;

CREATE TRIGGER prevent_bakery_deactivation_with_open_cash_register
    BEFORE UPDATE OF active ON public.bakeries
    FOR EACH ROW
    EXECUTE FUNCTION private.prevent_deactivating_bakery_with_open_cash_register();

DO $migration$
DECLARE
    v_policy record;
BEGIN
    FOR v_policy IN
        SELECT policy.schemaname, policy.tablename, policy.policyname
        FROM pg_catalog.pg_policies AS policy
        WHERE policy.schemaname = 'public'
          AND policy.tablename IN ('users', 'bakeries')
          AND policy.cmd IN ('SELECT', 'ALL', 'INSERT', 'UPDATE', 'DELETE')
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

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bakeries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users, public.bakeries
    FROM anon;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.users
    FROM authenticated;

REVOKE DELETE ON TABLE public.bakeries
    FROM authenticated;

GRANT SELECT ON TABLE public.users
    TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.bakeries
    TO authenticated;

CREATE POLICY users_select_self_or_owner
    ON public.users
    FOR SELECT
    TO authenticated
    USING (
        id = (SELECT auth.uid())
        OR (SELECT private.is_owner())
    );

CREATE POLICY bakeries_select_owner_or_own_active_cashier_bakery
    ON public.bakeries
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (
            active = true
            AND (SELECT private.is_cashier())
            AND id = (SELECT private.current_user_bakery_id())
        )
    );

CREATE POLICY bakeries_insert_owner
    ON public.bakeries
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT private.is_owner()));

CREATE POLICY bakeries_update_owner
    ON public.bakeries
    FOR UPDATE
    TO authenticated
    USING ((SELECT private.is_owner()))
    WITH CHECK ((SELECT private.is_owner()));
