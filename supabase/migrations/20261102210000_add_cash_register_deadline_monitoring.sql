DO $migration$
BEGIN
    IF to_regclass('public.bakeries') IS NULL
       OR to_regclass('public.cash_registers') IS NULL
       OR to_regclass('public.users') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.current_user_bakery_ids()') IS NULL THEN
        RAISE EXCEPTION
            'Cash register deadline monitoring requires bakeries, cash registers, users, and owner authorization helpers';
    END IF;
END;
$migration$;

ALTER TABLE public.bakeries
    ADD COLUMN IF NOT EXISTS cash_register_monitoring_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cash_register_deadline_hour smallint;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_metadata
        WHERE constraint_metadata.conrelid = 'public.bakeries'::regclass
          AND constraint_metadata.conname = 'bakeries_cash_register_deadline_check'
    ) THEN
        ALTER TABLE public.bakeries
            ADD CONSTRAINT bakeries_cash_register_deadline_check
            CHECK (
                (cash_register_deadline_hour IS NULL
                    OR cash_register_deadline_hour BETWEEN 0 AND 23)
                AND (
                    cash_register_monitoring_enabled IS FALSE
                    OR cash_register_deadline_hour IS NOT NULL
                )
            );
    END IF;
END;
$migration$;

CREATE FUNCTION public.get_overdue_cash_register_alerts()
RETURNS TABLE (
    cash_register_id uuid,
    bakery_id uuid,
    bakery_name text,
    operator_name text,
    opened_at timestamptz,
    deadline_at timestamptz,
    overdue_seconds bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid;
    v_now timestamptz;
BEGIN
    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NULL OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an owner may view overdue cash register alerts'
            USING ERRCODE = '42501';
    END IF;

    v_now := pg_catalog.clock_timestamp();

    RETURN QUERY
    WITH register_deadlines AS (
        SELECT
            cash_register.id,
            cash_register.bakery_id,
            bakery.name AS bakery_name,
            operator.name AS operator_name,
            cash_register.opened_at,
            (
                CASE
                    WHEN local_deadline.deadline_local <= local_deadline.opened_local
                        THEN local_deadline.deadline_local + interval '1 day'
                    ELSE local_deadline.deadline_local
                END
            ) AT TIME ZONE 'America/Sao_Paulo' AS deadline_at
        FROM public.cash_registers AS cash_register
        JOIN public.bakeries AS bakery
          ON bakery.id = cash_register.bakery_id
        JOIN public.users AS operator
          ON operator.id = cash_register.opened_by
        CROSS JOIN LATERAL (
            SELECT
                cash_register.opened_at AT TIME ZONE 'America/Sao_Paulo' AS opened_local,
                (cash_register.opened_at AT TIME ZONE 'America/Sao_Paulo')::date
                    + pg_catalog.make_interval(
                        hours => bakery.cash_register_deadline_hour::integer
                    ) AS deadline_local
        ) AS local_deadline
        WHERE cash_register.status = 'open'
          AND bakery.cash_register_monitoring_enabled IS TRUE
          AND bakery.cash_register_deadline_hour IS NOT NULL
          AND cash_register.bakery_id = ANY (
              coalesce(private.current_user_bakery_ids(), ARRAY[]::uuid[])
          )
    )
    SELECT
        register_deadlines.id,
        register_deadlines.bakery_id,
        register_deadlines.bakery_name,
        register_deadlines.operator_name,
        register_deadlines.opened_at,
        register_deadlines.deadline_at,
        pg_catalog.floor(
            pg_catalog.date_part('epoch', v_now - register_deadlines.deadline_at)
        )::bigint
    FROM register_deadlines
    WHERE register_deadlines.deadline_at <= v_now
    ORDER BY register_deadlines.deadline_at ASC, register_deadlines.id ASC;
END;
$function$;

ALTER FUNCTION public.get_overdue_cash_register_alerts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_overdue_cash_register_alerts()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_overdue_cash_register_alerts()
    TO authenticated;
