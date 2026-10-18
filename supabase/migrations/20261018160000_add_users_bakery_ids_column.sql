-- Migration: adiciona a coluna users.bakery_ids (unidades do usuário)
-- O frontend lê users.bakery_ids ao carregar o perfil (login/startup); sem
-- esta coluna toda leitura falha com 42703:
--   "column users.bakery_ids does not exist"
-- A coluna é a fonte de leitura/escrita da aplicação; um trigger mantém a
-- tabela de junção user_bakeries (usada pelas políticas RLS) em sincronia.

-- 1. Coluna (idempotente)
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS bakery_ids uuid[];

-- 2. Backfill pela unidade primária legada
UPDATE public.users
SET bakery_ids = ARRAY[bakery_id]
WHERE bakery_ids IS NULL
  AND bakery_id IS NOT NULL;

-- 3. Backfill pela junção user_bakeries quando ela já existe (a migration
--    de múltiplas unidades é a fonte mais completa nesse caso)
DO $migration$
BEGIN
    IF to_regclass('public.user_bakeries') IS NOT NULL THEN
        UPDATE public.users AS u
        SET bakery_ids = sub.bakery_ids
        FROM (
            SELECT user_id,
                   array_agg(bakery_id ORDER BY created_at, bakery_id) AS bakery_ids
            FROM public.user_bakeries
            GROUP BY user_id
        ) AS sub
        WHERE u.id = sub.user_id
          AND u.bakery_ids IS DISTINCT FROM sub.bakery_ids;
    END IF;
END;
$migration$;

-- 3b. Reparo de edições feitas só no legado (RPC update_operator_profile / INSERT
--     da edge admin-users não gravavam bakery_ids): quando a unidade primária
--     legada está fora do array, a última edição do dono é a fonte da verdade.
--     Não afeta multi-unidade legítimo (legado = primeira posição ∈ array).
UPDATE public.users
SET bakery_ids = ARRAY[bakery_id]
WHERE role = 'cashier'
  AND bakery_id IS NOT NULL
  AND NOT (bakery_id = ANY (coalesce(bakery_ids, ARRAY[]::uuid[])));

-- 4. Sincronização users.(bakery_ids|bakery_id) -> user_bakeries
-- A coluna bakery_ids é a fonte de leitura/escrita da aplicação e a junção
-- user_bakeries alimenta as políticas RLS (is_cashier, current_user_bakery_ids).
-- Escritas legadas mudam apenas users.bakery_id (RPC update_operator_profile e
-- INSERT da edge function admin-users), por isso o trigger cobre INSERT OR
-- UPDATE de qualquer coluna e propaga o legado quando necessário — sem isso,
-- is_cashier() vira false e todo acesso RLS do operador cai com 42501.
-- Dividido em dois triggers: a normalização roda BEFORE (pode alterar NEW) e a
-- junção roda AFTER (a linha em users precisa existir para a FK de user_bakeries).

-- 4a. Normalização das colunas de unidade (BEFORE INSERT OR UPDATE)
CREATE OR REPLACE FUNCTION private.normalize_user_bakery_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $normalize$
BEGIN
    -- Atualização que não tocou nenhuma coluna de unidade: nada a normalizar.
    IF TG_OP = 'UPDATE'
       AND NEW.bakery_id IS NOT DISTINCT FROM OLD.bakery_id
       AND NEW.bakery_ids IS NOT DISTINCT FROM OLD.bakery_ids THEN
        RETURN NEW;
    END IF;

    -- Escritas legadas: quando só o bakery_id é informado (array nulo, ou array
    -- intacto com o legado apontando para fora dele — ex.: update_operator_profile),
    -- o legado passa a ser a fonte da lista de unidades.
    IF NEW.bakery_id IS NOT NULL
       AND (NEW.bakery_ids IS NULL
            OR (TG_OP = 'UPDATE'
                AND NEW.bakery_ids IS NOT DISTINCT FROM OLD.bakery_ids
                AND NOT (NEW.bakery_id = ANY (NEW.bakery_ids)))) THEN
        NEW.bakery_ids := ARRAY[NEW.bakery_id];
    END IF;

    -- Mantém a coluna legada coerente com a primeira unidade do array
    IF NEW.role = 'cashier' AND NEW.bakery_ids IS NOT NULL THEN
        NEW.bakery_id := (NEW.bakery_ids)[1];
    END IF;

    RETURN NEW;
END;
$normalize$;

ALTER FUNCTION private.normalize_user_bakery_columns() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.normalize_user_bakery_columns() FROM PUBLIC, anon, authenticated;

-- 4b. Junção user_bakeries (AFTER INSERT OR UPDATE)
CREATE OR REPLACE FUNCTION private.sync_user_bakeries_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $sync$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.bakery_id IS NOT DISTINCT FROM OLD.bakery_id
       AND NEW.bakery_ids IS NOT DISTINCT FROM OLD.bakery_ids THEN
        RETURN NULL;
    END IF;

    IF to_regclass('public.user_bakeries') IS NOT NULL THEN
        DELETE FROM public.user_bakeries
        WHERE user_id = NEW.id;

        IF NEW.bakery_ids IS NOT NULL THEN
            INSERT INTO public.user_bakeries (user_id, bakery_id)
            SELECT NEW.id, ids.bakery_id
            FROM unnest(NEW.bakery_ids) AS ids(bakery_id)
            WHERE ids.bakery_id IS NOT NULL
            ON CONFLICT (user_id, bakery_id) DO NOTHING;
        END IF;
    END IF;

    RETURN NULL;
END;
$sync$;

ALTER FUNCTION private.sync_user_bakeries_from_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.sync_user_bakeries_from_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_normalize_bakery_columns ON public.users;
DROP TRIGGER IF EXISTS users_sync_user_bakeries ON public.users;
CREATE TRIGGER users_normalize_bakery_columns
    BEFORE INSERT OR UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION private.normalize_user_bakery_columns();
CREATE TRIGGER users_sync_user_bakeries
    AFTER INSERT OR UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION private.sync_user_bakeries_from_user();
