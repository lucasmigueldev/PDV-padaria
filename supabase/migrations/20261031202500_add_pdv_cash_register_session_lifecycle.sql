DO $migration$
BEGIN
    IF to_regclass('public.cash_registers') IS NULL
       OR to_regclass('public.pdv_offline_episodes') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL
       OR to_regprocedure('private.current_user_bakery_ids()') IS NULL THEN
        RAISE EXCEPTION
            'PDV session lifecycle requires cash registers, offline episodes, and cashier authorization helpers';
    END IF;
END;
$migration$;

CREATE TABLE public.pdv_cash_register_session_endings (
    cash_register_id uuid PRIMARY KEY
        REFERENCES public.cash_registers(id) ON DELETE CASCADE,
    bakery_id uuid NOT NULL REFERENCES public.bakeries(id) ON DELETE CASCADE,
    operator_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    ended_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    reason text NOT NULL CHECK (reason IN ('pagehide', 'logout'))
);

ALTER TABLE public.pdv_cash_register_session_endings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pdv_cash_register_session_endings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pdv_cash_register_session_endings TO authenticated;

CREATE POLICY pdv_cash_register_session_endings_select_owner
    ON public.pdv_cash_register_session_endings
    FOR SELECT
    TO authenticated
    USING ((SELECT private.is_owner()));

ALTER TABLE public.pdv_offline_episodes
    DROP CONSTRAINT pdv_offline_episodes_status_check,
    DROP CONSTRAINT pdv_offline_episodes_end_state_check;

ALTER TABLE public.pdv_offline_episodes
    ADD CONSTRAINT pdv_offline_episodes_status_check
        CHECK (status IN ('open', 'reconnected', 'cash_register_closed', 'session_ended')),
    ADD CONSTRAINT pdv_offline_episodes_end_state_check
        CHECK (
            (status = 'open' AND ended_at IS NULL AND duration_seconds IS NULL)
            OR (
                status IN ('reconnected', 'cash_register_closed', 'session_ended')
                AND ended_at IS NOT NULL
                AND duration_seconds IS NOT NULL
                AND duration_seconds >= 0
            )
        );

CREATE FUNCTION public.end_pdv_cash_register_session(
    p_cash_register_id uuid,
    p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_register record;
    v_now timestamptz;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_cashier()) THEN
        RAISE EXCEPTION 'Only the authenticated cashier may end their PDV session'
            USING ERRCODE = '42501';
    END IF;

    IF p_reason NOT IN ('pagehide', 'logout') THEN
        RAISE EXCEPTION 'Invalid PDV session ending reason'
            USING ERRCODE = '22023';
    END IF;

    SELECT cash_register.id, cash_register.bakery_id, cash_register.opened_by
    INTO v_register
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = p_cash_register_id
      AND cash_register.opened_by = (SELECT auth.uid())
      AND cash_register.status = 'open'
      AND cash_register.bakery_id = ANY (
          SELECT unnest(private.current_user_bakery_ids())
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    v_now := pg_catalog.clock_timestamp();

    INSERT INTO public.pdv_cash_register_session_endings (
        cash_register_id, bakery_id, operator_user_id, ended_at, reason
    )
    VALUES (
        v_register.id, v_register.bakery_id, v_register.opened_by, v_now, p_reason
    )
    ON CONFLICT (cash_register_id) DO UPDATE
    SET bakery_id = EXCLUDED.bakery_id,
        operator_user_id = EXCLUDED.operator_user_id,
        ended_at = EXCLUDED.ended_at,
        reason = EXCLUDED.reason;

    UPDATE public.pdv_offline_episodes AS episode
    SET status = 'session_ended',
        ended_at = v_now,
        duration_seconds = GREATEST(
            0,
            pg_catalog.floor(
                pg_catalog.date_part('epoch', v_now - episode.estimated_started_at)
            )::bigint
        )
    WHERE episode.cash_register_id = v_register.id
      AND episode.status = 'open';

    RETURN true;
END;
$function$;

ALTER FUNCTION public.end_pdv_cash_register_session(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.end_pdv_cash_register_session(uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_pdv_cash_register_session(uuid, text)
    TO authenticated;

CREATE FUNCTION public.resume_pdv_cash_register_session(p_cash_register_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_register record;
    v_reason text;
    v_ended_at timestamptz;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT (SELECT private.is_cashier()) THEN
        RAISE EXCEPTION 'Only the authenticated cashier may resume their PDV session'
            USING ERRCODE = '42501';
    END IF;

    SELECT cash_register.id, cash_register.bakery_id, cash_register.opened_by
    INTO v_register
    FROM public.cash_registers AS cash_register
    WHERE cash_register.id = p_cash_register_id
      AND cash_register.opened_by = (SELECT auth.uid())
      AND cash_register.status = 'open'
      AND cash_register.bakery_id = ANY (
          SELECT unnest(private.current_user_bakery_ids())
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    DELETE FROM public.pdv_cash_register_session_endings AS ending
    WHERE ending.cash_register_id = v_register.id
      AND ending.bakery_id = v_register.bakery_id
      AND ending.operator_user_id = v_register.opened_by
    RETURNING ending.reason, ending.ended_at INTO v_reason, v_ended_at;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    IF v_reason = 'pagehide' THEN
        UPDATE public.pdv_offline_episodes AS episode
        SET status = 'open',
            ended_at = NULL,
            duration_seconds = NULL
        WHERE episode.cash_register_id = v_register.id
          AND episode.status = 'session_ended'
          AND episode.ended_at = v_ended_at;
    END IF;

    RETURN true;
END;
$function$;

ALTER FUNCTION public.resume_pdv_cash_register_session(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resume_pdv_cash_register_session(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_pdv_cash_register_session(uuid)
    TO authenticated;

CREATE FUNCTION private.prevent_episode_for_ended_pdv_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.pdv_cash_register_session_endings AS ending
        WHERE ending.cash_register_id = NEW.cash_register_id
          AND ending.bakery_id = NEW.bakery_id
          AND ending.operator_user_id = NEW.operator_user_id
    ) THEN
        RETURN NULL;
    END IF;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION private.prevent_episode_for_ended_pdv_session() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.prevent_episode_for_ended_pdv_session()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER pdv_offline_episodes_skip_ended_session
    BEFORE INSERT ON public.pdv_offline_episodes
    FOR EACH ROW
    EXECUTE FUNCTION private.prevent_episode_for_ended_pdv_session();
