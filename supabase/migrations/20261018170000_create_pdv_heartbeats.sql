-- Migration: cria a tabela public.pdv_heartbeats
-- O PDV do operador faz upsert a cada 30s (onConflict: user_id) e o Dashboard
-- do proprietário consulta para sinalizar unidades offline. Sem a tabela
-- toda leitura falha com PGRST205:
--   "Could not find the table 'public.pdv_heartbeats' in the schema cache"

DO $migration$
BEGIN
    IF to_regprocedure('private.is_owner()') IS NULL
       OR to_regprocedure('private.is_cashier()') IS NULL
       OR to_regprocedure('private.current_user_bakery_ids()') IS NULL THEN
        RAISE EXCEPTION 'pdv_heartbeats requires the authorization helpers (apply 20261018000000 first)';
    END IF;
END;
$migration$;

-- 1. Tabela: uma linha por operador (o upsert usa onConflict: user_id)
CREATE TABLE IF NOT EXISTS public.pdv_heartbeats (
    user_id       uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    bakery_id     uuid NOT NULL REFERENCES public.bakeries(id) ON DELETE CASCADE,
    status        text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'syncing')),
    pending_sales integer NOT NULL DEFAULT 0 CHECK (pending_sales >= 0),
    last_seen_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pdv_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pdv_heartbeats FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pdv_heartbeats TO authenticated;

-- 2. Leitura: o proprietário acompanha todos os PDVs no Dashboard
DROP POLICY IF EXISTS pdv_heartbeats_select_owner ON public.pdv_heartbeats;
CREATE POLICY pdv_heartbeats_select_owner
    ON public.pdv_heartbeats
    FOR SELECT
    TO authenticated
    USING ((SELECT private.is_owner()));

-- 3. Escrita: o operador mantém apenas a própria linha, em unidade sua
DROP POLICY IF EXISTS pdv_heartbeats_insert_cashier_own ON public.pdv_heartbeats;
CREATE POLICY pdv_heartbeats_insert_cashier_own
    ON public.pdv_heartbeats
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT private.is_cashier())
        AND user_id = (SELECT auth.uid())
        AND bakery_id = ANY (SELECT unnest(private.current_user_bakery_ids()))
    );

-- O upsert (ON CONFLICT DO UPDATE) exige permissão de UPDATE na linha alvo
DROP POLICY IF EXISTS pdv_heartbeats_update_cashier_own ON public.pdv_heartbeats;
CREATE POLICY pdv_heartbeats_update_cashier_own
    ON public.pdv_heartbeats
    FOR UPDATE
    TO authenticated
    USING (
        (SELECT private.is_cashier())
        AND user_id = (SELECT auth.uid())
    )
    WITH CHECK (
        (SELECT private.is_cashier())
        AND user_id = (SELECT auth.uid())
        AND bakery_id = ANY (SELECT unnest(private.current_user_bakery_ids()))
    );
