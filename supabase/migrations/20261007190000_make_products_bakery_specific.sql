-- Pressupõe que products esteja vazia, conforme o estado confirmado do banco.
ALTER TABLE public.products
    ADD COLUMN bakery_id uuid;

ALTER TABLE public.products
    ALTER COLUMN bakery_id SET NOT NULL;

ALTER TABLE public.products
    ADD CONSTRAINT products_bakery_id_fkey
    FOREIGN KEY (bakery_id)
    REFERENCES public.bakeries (id)
    ON DELETE RESTRICT;

-- Necessário para que product_stock possa referenciar (id, bakery_id).
ALTER TABLE public.products
    ADD CONSTRAINT products_id_bakery_id_key
    UNIQUE (id, bakery_id);

-- Remove índices UNIQUE globais de barcode baseados em btrim(barcode).
-- A detecção usa a definição do índice, sem depender dos nomes.
DO $migration$
DECLARE
    v_index record;
BEGIN
    FOR v_index IN
        SELECT
            index_namespace.nspname AS schema_name,
            index_class.relname AS index_name
        FROM pg_index AS index_metadata
        JOIN pg_class AS table_class
            ON table_class.oid = index_metadata.indrelid
        JOIN pg_class AS index_class
            ON index_class.oid = index_metadata.indexrelid
        JOIN pg_namespace AS index_namespace
            ON index_namespace.oid = index_class.relnamespace
        WHERE table_class.oid = 'public.products'::regclass
          AND index_metadata.indisunique
          AND index_metadata.indnkeyatts = 1
          AND regexp_replace(
                pg_get_indexdef(index_metadata.indexrelid),
                '[[:space:]"]',
                '',
                'g'
              ) ILIKE '%btrim(barcode)%'
    LOOP
        EXECUTE format(
            'DROP INDEX %I.%I',
            v_index.schema_name,
            v_index.index_name
        );
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM pg_index AS index_metadata
        JOIN pg_class AS table_class
            ON table_class.oid = index_metadata.indrelid
        WHERE table_class.oid = 'public.products'::regclass
          AND index_metadata.indisunique
          AND index_metadata.indnkeyatts = 1
          AND regexp_replace(
                pg_get_indexdef(index_metadata.indexrelid),
                '[[:space:]"]',
                '',
                'g'
              ) ILIKE '%btrim(barcode)%'
    ) THEN
        RAISE EXCEPTION
            'Ainda existe índice UNIQUE global de products baseado em btrim(barcode)';
    END IF;
END;
$migration$;

-- O barcode, após trim, precisa ser único dentro de cada bakery.
CREATE UNIQUE INDEX products_bakery_id_barcode_trim_uidx
    ON public.products (bakery_id, btrim(barcode));

-- Remove somente a FK antiga que ligava product_stock.product_id
-- a products.id sem incluir bakery_id.
DO $migration$
DECLARE
    v_constraint record;
BEGIN
    FOR v_constraint IN
        SELECT constraint_metadata.conname
        FROM pg_constraint AS constraint_metadata
        WHERE constraint_metadata.conrelid = 'public.product_stock'::regclass
          AND constraint_metadata.confrelid = 'public.products'::regclass
          AND constraint_metadata.contype = 'f'
          AND constraint_metadata.conkey = ARRAY[
                (
                    SELECT attribute.attnum
                    FROM pg_attribute AS attribute
                    WHERE attribute.attrelid = 'public.product_stock'::regclass
                      AND attribute.attname = 'product_id'
                      AND NOT attribute.attisdropped
                )
              ]::smallint[]
          AND constraint_metadata.confkey = ARRAY[
                (
                    SELECT attribute.attnum
                    FROM pg_attribute AS attribute
                    WHERE attribute.attrelid = 'public.products'::regclass
                      AND attribute.attname = 'id'
                      AND NOT attribute.attisdropped
                )
              ]::smallint[]
    LOOP
        EXECUTE format(
            'ALTER TABLE public.product_stock DROP CONSTRAINT %I',
            v_constraint.conname
        );
    END LOOP;
END;
$migration$;

-- Preserva a PK atual de product_stock e impõe a correspondência
-- entre o produto e a mesma bakery. O estoque é removido com o produto.
ALTER TABLE public.product_stock
    ADD CONSTRAINT product_stock_product_id_bakery_id_fkey
    FOREIGN KEY (product_id, bakery_id)
    REFERENCES public.products (id, bakery_id)
    ON DELETE CASCADE;

-- Remove as políticas existentes de products para que as novas regras
-- não sejam ampliadas por políticas permissivas anteriores.
DO $migration$
DECLARE
    v_policy record;
BEGIN
    FOR v_policy IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'products'
    LOOP
        EXECUTE format(
            'DROP POLICY %I ON public.products',
            v_policy.policyname
        );
    END LOOP;
END;
$migration$;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.products
    TO authenticated;

CREATE POLICY products_select_by_role
    ON public.products
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (
            (SELECT private.is_cashier())
            AND bakery_id = (SELECT private.current_user_bakery_id())
        )
    );

CREATE POLICY products_insert_cashier_own_bakery
    ON public.products
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT private.is_cashier())
        AND bakery_id = (SELECT private.current_user_bakery_id())
    );

CREATE POLICY products_update_cashier_own_bakery
    ON public.products
    FOR UPDATE
    TO authenticated
    USING (
        (SELECT private.is_cashier())
        AND bakery_id = (SELECT private.current_user_bakery_id())
    )
    WITH CHECK (
        (SELECT private.is_cashier())
        AND bakery_id = (SELECT private.current_user_bakery_id())
    );

CREATE POLICY products_delete_cashier_own_bakery
    ON public.products
    FOR DELETE
    TO authenticated
    USING (
        (SELECT private.is_cashier())
        AND bakery_id = (SELECT private.current_user_bakery_id())
    );
