-- Extends the existing bakery deactivation guard to preserve non-zero stock.
DO $migration$
BEGIN
    IF to_regclass('public.bakeries') IS NULL
       OR to_regclass('public.cash_registers') IS NULL
       OR to_regclass('public.products') IS NULL
       OR to_regclass('public.product_stock') IS NULL
       OR to_regprocedure('private.prevent_deactivating_bakery_with_open_cash_register()') IS NULL
       OR EXISTS (
            SELECT 1
            FROM (
                VALUES
                    ('bakeries', 'id'),
                    ('bakeries', 'active'),
                    ('cash_registers', 'bakery_id'),
                    ('cash_registers', 'status'),
                    ('products', 'id'),
                    ('products', 'bakery_id'),
                    ('product_stock', 'product_id'),
                    ('product_stock', 'bakery_id'),
                    ('product_stock', 'quantity')
            ) AS required_column(table_name, column_name)
            WHERE NOT EXISTS (
                SELECT 1
                FROM information_schema.columns AS existing_column
                WHERE existing_column.table_schema = 'public'
                  AND existing_column.table_name = required_column.table_name
                  AND existing_column.column_name = required_column.column_name
            )
       )
       OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_trigger AS trigger_metadata
            WHERE trigger_metadata.tgrelid = 'public.bakeries'::regclass
              AND trigger_metadata.tgname = 'prevent_bakery_deactivation_with_open_cash_register'
              AND NOT trigger_metadata.tgisinternal
       ) THEN
        RAISE EXCEPTION
            'Bakery deactivation guard requires the established bakery, cash register, product, stock, and trigger objects';
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

        IF EXISTS (
            SELECT 1
            FROM public.product_stock AS stock
            WHERE stock.bakery_id = OLD.id
              AND stock.quantity <> 0
        ) THEN
            RAISE EXCEPTION 'A bakery cannot be deactivated while product stock is non-zero'
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
