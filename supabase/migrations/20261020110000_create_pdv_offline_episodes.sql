DO $migration$
BEGIN
    IF to_regclass('public.cash_registers') IS NULL
       OR to_regclass('public.pdv_heartbeats') IS NULL
       OR to_regclass('public.users') IS NULL
       OR to_regclass('public.bakeries') IS NULL
       OR to_regprocedure('private.is_owner()') IS NULL THEN
        RAISE EXCEPTION
            'PDV offline episodes require cash registers, heartbeats, users, bakeries, and private.is_owner()';
    END IF;
END;
$migration$;

CREATE TABLE public.pdv_offline_episodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cash_register_id uuid NOT NULL REFERENCES public.cash_registers(id) ON DELETE RESTRICT,
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id) ON DELETE RESTRICT,
    operator_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    bakery_name_snapshot text NOT NULL,
    operator_name_snapshot text NOT NULL,
    last_contact_at timestamptz NOT NULL,
    estimated_started_at timestamptz NOT NULL,
    detected_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    ended_at timestamptz,
    duration_seconds bigint,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT pdv_offline_episodes_status_check
        CHECK (status IN ('open', 'reconnected', 'cash_register_closed')),
    CONSTRAINT pdv_offline_episodes_end_state_check
        CHECK (
            (status = 'open' AND ended_at IS NULL AND duration_seconds IS NULL)
            OR (
                status IN ('reconnected', 'cash_register_closed')
                AND ended_at IS NOT NULL
                AND duration_seconds IS NOT NULL
                AND duration_seconds >= 0
            )
        ),
    CONSTRAINT pdv_offline_episodes_time_order_check
        CHECK (
            last_contact_at <= estimated_started_at
            AND estimated_started_at <= detected_at
            AND (ended_at IS NULL OR detected_at <= ended_at)
        )
);

CREATE UNIQUE INDEX pdv_offline_episodes_one_open_per_register_uidx
    ON public.pdv_offline_episodes (cash_register_id)
    WHERE status = 'open';

CREATE INDEX pdv_offline_episodes_history_idx
    ON public.pdv_offline_episodes (bakery_id, estimated_started_at DESC);

ALTER TABLE public.pdv_offline_episodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pdv_offline_episodes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pdv_offline_episodes TO authenticated;

CREATE POLICY pdv_offline_episodes_select_owner
    ON public.pdv_offline_episodes
    FOR SELECT
    TO authenticated
    USING ((SELECT private.is_owner()));

CREATE FUNCTION public.record_pdv_offline_episode(p_cash_register_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_now timestamptz;
    v_register record;
    v_heartbeat record;
    v_episode_id uuid;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an owner may record offline episodes'
            USING ERRCODE = '42501';
    END IF;

    SELECT
        cash_register.id,
        cash_register.bakery_id,
        cash_register.opened_by AS operator_user_id,
        cash_register.opened_at
    INTO v_register
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = p_cash_register_id
      AND cash_register.status = 'open'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    v_now := pg_catalog.clock_timestamp();

    SELECT heartbeat.last_seen_at
    INTO v_heartbeat
    FROM public.pdv_heartbeats AS heartbeat
    WHERE heartbeat.user_id = v_register.operator_user_id
      AND heartbeat.bakery_id = v_register.bakery_id
      AND heartbeat.last_seen_at <= v_now - interval '75 seconds'
      AND heartbeat.last_seen_at <= v_now
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.pdv_offline_episodes (
        cash_register_id,
        bakery_id,
        operator_user_id,
        bakery_name_snapshot,
        operator_name_snapshot,
        last_contact_at,
        estimated_started_at,
        detected_at
    )
    SELECT
        v_register.id,
        v_register.bakery_id,
        v_register.operator_user_id,
        bakery.name,
        operator.name,
        v_heartbeat.last_seen_at,
        GREATEST(
            v_register.opened_at,
            v_heartbeat.last_seen_at + interval '75 seconds'
        ),
        v_now
    FROM public.bakeries AS bakery
    JOIN public.users AS operator
      ON operator.id = v_register.operator_user_id
    WHERE bakery.id = v_register.bakery_id
    ON CONFLICT (cash_register_id) WHERE status = 'open' DO NOTHING
    RETURNING id INTO v_episode_id;

    IF v_episode_id IS NULL THEN
        SELECT episode.id
        INTO v_episode_id
        FROM public.pdv_offline_episodes AS episode
        WHERE episode.cash_register_id = v_register.id
          AND episode.status = 'open';
    END IF;

    RETURN v_episode_id;
END;
$function$;

ALTER FUNCTION public.record_pdv_offline_episode(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_pdv_offline_episode(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pdv_offline_episode(uuid)
    TO authenticated;

CREATE FUNCTION public.finish_pdv_offline_episode(p_cash_register_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_now timestamptz;
    v_register record;
    v_episode record;
    v_last_seen_at timestamptz;
    v_status text;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_owner()) THEN
        RAISE EXCEPTION 'Only an owner may finish offline episodes'
            USING ERRCODE = '42501';
    END IF;

    SELECT
        cash_register.bakery_id,
        cash_register.opened_by AS operator_user_id,
        cash_register.status
    INTO v_register
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = p_cash_register_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    SELECT
        episode.id,
        episode.bakery_id,
        episode.operator_user_id,
        episode.estimated_started_at
    INTO v_episode
    FROM public.pdv_offline_episodes AS episode
    WHERE episode.cash_register_id = p_cash_register_id
      AND episode.status = 'open'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    v_now := pg_catalog.clock_timestamp();

    IF v_episode.bakery_id IS DISTINCT FROM v_register.bakery_id
       OR v_episode.operator_user_id IS DISTINCT FROM v_register.operator_user_id THEN
        RETURN false;
    END IF;

    IF v_register.status = 'closed' THEN
        v_status := 'cash_register_closed';
    ELSIF v_register.status = 'open' THEN
        SELECT heartbeat.last_seen_at
        INTO v_last_seen_at
        FROM public.pdv_heartbeats AS heartbeat
        WHERE heartbeat.user_id = v_episode.operator_user_id
          AND heartbeat.bakery_id = v_episode.bakery_id
          AND heartbeat.last_seen_at > v_now - interval '75 seconds'
          AND heartbeat.last_seen_at <= v_now
        FOR UPDATE;

        IF NOT FOUND
           OR v_last_seen_at <= v_episode.estimated_started_at THEN
            RETURN false;
        END IF;

        v_status := 'reconnected';
    ELSE
        RETURN false;
    END IF;

    UPDATE public.pdv_offline_episodes AS episode
    SET status = v_status,
        ended_at = v_now,
        duration_seconds = GREATEST(
            0,
            pg_catalog.floor(
                pg_catalog.date_part('epoch', v_now - episode.estimated_started_at)
            )::bigint
        )
    WHERE episode.id = v_episode.id
      AND episode.status = 'open';

    RETURN FOUND;
END;
$function$;

ALTER FUNCTION public.finish_pdv_offline_episode(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finish_pdv_offline_episode(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_pdv_offline_episode(uuid)
    TO authenticated;
