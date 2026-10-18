-- public.app_settings is used by the frontend to persist app-wide preferences
-- (establishment name, PIX key per bakery), but the table was never created.
-- Without it every REST read/write fails with PGRST205 and the PDV shows
-- "Chave PIX não configurada".

DO $migration$
BEGIN
    IF to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL THEN
        RAISE EXCEPTION 'app_settings requires the established authorization helpers';
    END IF;
END;
$migration$;

CREATE TABLE IF NOT EXISTS public.app_settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.app_settings_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $touch$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$touch$;

DROP TRIGGER IF EXISTS app_settings_touch_updated_at ON public.app_settings;
CREATE TRIGGER app_settings_touch_updated_at
    BEFORE UPDATE ON public.app_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.app_settings_touch_updated_at();

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_settings FROM anon;

GRANT SELECT ON TABLE public.app_settings TO authenticated;

DROP POLICY IF EXISTS app_settings_select_owner_or_cashier ON public.app_settings;
CREATE POLICY app_settings_select_owner_or_cashier
    ON public.app_settings
    FOR SELECT
    TO authenticated
    USING (
        (SELECT private.is_owner())
        OR (SELECT private.is_cashier())
    );

DROP POLICY IF EXISTS app_settings_write_owner ON public.app_settings;
CREATE POLICY app_settings_write_owner
    ON public.app_settings
    FOR ALL
    TO authenticated
    USING ((SELECT private.is_owner()))
    WITH CHECK ((SELECT private.is_owner()));
