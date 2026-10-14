-- Store non-operational receipt preferences per authenticated user.
DO $migration$
BEGIN
    IF to_regclass('public.users') IS NULL THEN
        RAISE EXCEPTION
            'User receipt preferences require the established public.users table';
    END IF;
END;
$migration$;

CREATE TABLE public.user_preferences (
    user_id uuid PRIMARY KEY
        REFERENCES public.users (id) ON DELETE CASCADE,
    receipt_print_mode text NOT NULL DEFAULT 'automatic',
    CONSTRAINT user_preferences_receipt_print_mode_check
        CHECK (receipt_print_mode IN ('automatic', 'manual', 'disabled'))
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_preferences
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.user_preferences
    TO authenticated;

CREATE POLICY user_preferences_select_own
    ON public.user_preferences
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

CREATE POLICY user_preferences_insert_own
    ON public.user_preferences
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_preferences_update_own
    ON public.user_preferences
    FOR UPDATE
    TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));
