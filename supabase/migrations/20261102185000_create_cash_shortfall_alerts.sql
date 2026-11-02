DO $migration$
BEGIN
    IF to_regclass('public.cash_closures') IS NULL
       OR to_regclass('public.bakeries') IS NULL
       OR to_regclass('public.users') IS NULL
       OR to_regclass('public.user_bakeries') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.current_user_bakery_ids()') IS NULL THEN
        RAISE EXCEPTION
            'Cash shortfall alerts require established closure tables and owner bakery authorization helpers';
    END IF;
END;
$migration$;

CREATE TABLE public.cash_shortfall_alert_acknowledgements (
    closure_id uuid NOT NULL REFERENCES public.cash_closures(id) ON DELETE CASCADE,
    confirmed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    confirmed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    PRIMARY KEY (closure_id, confirmed_by)
);

ALTER TABLE public.cash_shortfall_alert_acknowledgements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cash_shortfall_alert_acknowledgements
    FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_pending_cash_shortfall_alerts()
RETURNS TABLE (
    closure_id uuid,
    bakery_id uuid,
    bakery_name text,
    operator_name text,
    closed_at timestamptz,
    expected_amount numeric,
    counted_amount numeric,
    shortage_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an owner may view cash shortfall alerts'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        closure.id,
        closure.bakery_id,
        bakery.name,
        operator.name,
        closure.closed_at,
        closure.expected_amount,
        closure.counted_amount,
        -closure.difference_amount
    FROM public.cash_closures AS closure
    JOIN public.bakeries AS bakery
      ON bakery.id = closure.bakery_id
    LEFT JOIN public.users AS operator
      ON operator.id = closure.closed_by
    WHERE closure.difference_amount < 0
      AND closure.bakery_id = ANY (
          coalesce(private.current_user_bakery_ids(), ARRAY[]::uuid[])
      )
      AND NOT EXISTS (
          SELECT 1
          FROM public.cash_shortfall_alert_acknowledgements AS acknowledgement
          WHERE acknowledgement.closure_id = closure.id
            AND acknowledgement.confirmed_by = (SELECT auth.uid())
      )
    ORDER BY closure.closed_at ASC, closure.id ASC;
END;
$function$;

ALTER FUNCTION public.get_pending_cash_shortfall_alerts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_pending_cash_shortfall_alerts()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_cash_shortfall_alerts()
    TO authenticated;

CREATE FUNCTION public.acknowledge_cash_shortfall_alert(p_closure_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an owner may acknowledge cash shortfall alerts'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.cash_shortfall_alert_acknowledgements (
        closure_id,
        confirmed_by
    )
    SELECT
        closure.id,
        (SELECT auth.uid())
    FROM public.cash_closures AS closure
    WHERE closure.id = p_closure_id
      AND closure.difference_amount < 0
      AND closure.bakery_id = ANY (
          coalesce(private.current_user_bakery_ids(), ARRAY[]::uuid[])
      )
    ON CONFLICT (closure_id, confirmed_by) DO NOTHING;

    IF NOT FOUND THEN
        IF EXISTS (
            SELECT 1
            FROM public.cash_shortfall_alert_acknowledgements AS acknowledgement
            WHERE acknowledgement.closure_id = p_closure_id
              AND acknowledgement.confirmed_by = (SELECT auth.uid())
        ) THEN
            RETURN true;
        END IF;

        RAISE EXCEPTION 'Cash shortfall alert was not found or is not accessible'
            USING ERRCODE = '42501';
    END IF;

    RETURN true;
END;
$function$;

ALTER FUNCTION public.acknowledge_cash_shortfall_alert(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acknowledge_cash_shortfall_alert(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_cash_shortfall_alert(uuid)
    TO authenticated;
