-- Migration: suporte a múltiplas unidades por usuário
-- Cria tabela de junção user_bakeries (many-to-many entre users e bakeries)
-- Migra dados existentes de users.bakery_id para user_bakeries
-- Adiciona função private.current_user_bakery_ids() (retorna array de UUIDs)
-- Atualiza private.is_cashier() e políticas RLS para usar múltiplos IDs

-- 1. Tabela de junção user_bakeries (se ainda não existir)
CREATE TABLE IF NOT EXISTS public.user_bakeries (
    user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    bakery_id  uuid NOT NULL REFERENCES public.bakeries(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, bakery_id)
);

ALTER TABLE public.user_bakeries ENABLE ROW LEVEL SECURITY;

-- 2. Migrar dados existentes: users.bakery_id -> user_bakeries (apenas cashiers com bakery_id preenchido)
INSERT INTO public.user_bakeries (user_id, bakery_id)
SELECT id, bakery_id
FROM public.users
WHERE bakery_id IS NOT NULL
  ON CONFLICT (user_id, bakery_id) DO NOTHING;

-- 4. Atualizar função private.is_cashier() para usar user_bakeries
CREATE OR REPLACE FUNCTION private.is_cashier()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.users AS u
        JOIN public.user_bakeries AS ub ON ub.user_id = u.id
        JOIN public.bakeries AS b ON b.id = ub.bakery_id
        WHERE u.id = (SELECT auth.uid())
          AND u.role = 'cashier'
          AND u.active IS TRUE
          AND b.active = TRUE
    );
$function$;

ALTER FUNCTION private.is_cashier() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.is_cashier() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_cashier() TO authenticated;

-- 5. Nova função: retorna array de bakery_ids acessíveis pelo usuário autenticado
-- Para owners, retorna todos os bakery_ids ativos
-- Para cashiers, retorna os bakery_ids de suas atribuições ativas
CREATE OR REPLACE FUNCTION private.current_user_bakery_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT CASE
        WHEN (SELECT private.is_owner()) THEN
            (SELECT array_agg(id) FROM public.bakeries WHERE active = TRUE)
        ELSE
            (SELECT array_agg(ub.bakery_id)
             FROM public.user_bakeries AS ub
             JOIN public.users AS u ON u.id = ub.user_id
             JOIN public.bakeries AS b ON b.id = ub.bakery_id
             WHERE u.id = (SELECT auth.uid())
               AND u.active IS TRUE
               AND b.active = TRUE)
    END;
$function$;

ALTER FUNCTION private.current_user_bakery_ids() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.current_user_bakery_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.current_user_bakery_ids() TO authenticated;

-- 6. Manter a função antiga current_user_bakery_id() para retrocompatibilidade
-- (retorna o primeiro ID do array, ou null se vazio)
CREATE OR REPLACE FUNCTION private.current_user_bakery_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
    SELECT (private.current_user_bakery_ids())[1];
$function$;

ALTER FUNCTION private.current_user_bakery_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.current_user_bakery_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.current_user_bakery_id() TO authenticated;

-- 7. Política RLS para user_bakeries
CREATE POLICY user_bakeries_select_owner_or_self
    ON public.user_bakeries
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR user_id = (SELECT auth.uid())
    );

-- 8. Atualizar políticas RLS que usam current_user_bakery_id() para usar current_user_bakery_ids()

-- products
DROP POLICY IF EXISTS products_select_by_role ON public.products;
DROP POLICY IF EXISTS products_insert_cashier_own_bakery ON public.products;
DROP POLICY IF EXISTS products_update_cashier_own_bakery ON public.products;
DROP POLICY IF EXISTS products_delete_cashier_own_bakery ON public.products;

CREATE POLICY products_select_by_role
    ON public.products
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (
            (SELECT private.is_cashier())
            AND bakery_id = ANY(SELECT private.current_user_bakery_ids())
        )
    );

CREATE POLICY products_insert_cashier_own_bakery
    ON public.products
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT private.is_cashier())
        AND bakery_id = ANY(SELECT private.current_user_bakery_ids())
    );

CREATE POLICY products_update_cashier_own_bakery
    ON public.products
    FOR UPDATE
    TO authenticated
    USING (
        (SELECT private.is_cashier())
        AND bakery_id = ANY(SELECT private.current_user_bakery_ids())
    )
    WITH CHECK (
        (SELECT private.is_cashier())
        AND bakery_id = ANY(SELECT private.current_user_bakery_ids())
    );

CREATE POLICY products_delete_cashier_own_bakery
    ON public.products
    FOR DELETE
    TO authenticated
    USING (
        (SELECT private.is_cashier())
        AND bakery_id = ANY(SELECT private.current_user_bakery_ids())
    );

-- cash_registers
DROP POLICY IF EXISTS cash_registers_select_by_role_and_bakery ON public.cash_registers;

CREATE POLICY cash_registers_select_by_role_and_bakery
    ON public.cash_registers
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (
            (SELECT private.is_cashier())
            AND bakery_id = ANY(SELECT private.current_user_bakery_ids())
        )
    );

-- product_stock
DROP POLICY IF EXISTS product_stock_select_by_role_and_bakery ON public.product_stock;

CREATE POLICY product_stock_select_by_role_and_bakery
    ON public.product_stock
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (
            (SELECT private.is_cashier())
            AND bakery_id = ANY(SELECT private.current_user_bakery_ids())
        )
    );

-- bakeries (atualizar política que usa current_user_bakery_id())
DROP POLICY IF EXISTS bakeries_select_owner_or_own_active_cashier_bakery ON public.bakeries;

CREATE POLICY bakeries_select_owner_or_own_active_cashier_bakery
    ON public.bakeries
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (
            active = true
            AND (SELECT private.is_cashier())
            AND id = ANY(SELECT private.current_user_bakery_ids())
        )
    );