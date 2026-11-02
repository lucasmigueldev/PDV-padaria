import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
    associateOfflineEpisodeSales,
    getPdvOfflineEpisodeDurationSeconds,
    getPdvOfflineEpisodeSaoPauloDateBounds,
    getPdvOfflineEpisodeStatusLabel,
    isCompletedPdvOfflineEpisode,
    type OfflineEpisodeSale,
    type OfflineEpisodeSaleEpisode,
} from '../src/services/pdvOfflineEpisodePresentation.ts'

const migration = readFileSync(
    new URL('../supabase/migrations/20261020110000_create_pdv_offline_episodes.sql', import.meta.url),
    'utf8',
)
const lifecycleMigration = readFileSync(
    new URL('../supabase/migrations/20261031202500_add_pdv_cash_register_session_lifecycle.sql', import.meta.url),
    'utf8',
)
const offlineSalesMigration = readFileSync(
    new URL('../supabase/migrations/20261102174500_add_offline_sale_session_id.sql', import.meta.url),
    'utf8',
)
const salesReadPolicies = readFileSync(
    new URL('../supabase/migrations/20261015130000_allow_cashiers_read_own_bakery_sales.sql', import.meta.url),
    'utf8',
)
const operationalReadPolicies = readFileSync(
    new URL('../supabase/migrations/20261010110000_authorize_operational_reads.sql', import.meta.url),
    'utf8',
)
const operations = readFileSync(
    new URL('../src/services/operations.ts', import.meta.url),
    'utf8',
)
const heartbeatHook = readFileSync(
    new URL('../src/hooks/usePdvHeartbeats.ts', import.meta.url),
    'utf8',
)
const heartbeatService = readFileSync(
    new URL('../src/services/pdvHeartbeat.ts', import.meta.url),
    'utf8',
)
const episodeService = readFileSync(
    new URL('../src/services/pdvOfflineEpisodes.ts', import.meta.url),
    'utf8',
)
const offlinePage = readFileSync(
    new URL('../src/pages/RelatorioOffline/RelatorioOffline.tsx', import.meta.url),
    'utf8',
)
const offlinePageStyles = readFileSync(
    new URL('../src/pages/RelatorioOffline/RelatorioOffline.css', import.meta.url),
    'utf8',
)

test('uses recorded duration for closed episodes and derives elapsed time for open ones', () => {
    assert.equal(
        getPdvOfflineEpisodeDurationSeconds({
            estimatedStartedAt: '2026-10-31T12:00:00.000Z',
            endedAt: '2026-10-31T12:05:00.000Z',
            durationSeconds: 301,
        }, Date.parse('2026-10-31T12:10:00.000Z')),
        301,
    )
    assert.equal(
        getPdvOfflineEpisodeDurationSeconds({
            estimatedStartedAt: '2026-10-31T12:00:00.000Z',
            endedAt: null,
            durationSeconds: null,
        }, Date.parse('2026-10-31T12:05:00.999Z')),
        300,
    )
})

test('keeps elapsed time non-negative and reports invalid timestamps explicitly', () => {
    assert.equal(
        getPdvOfflineEpisodeDurationSeconds({
            estimatedStartedAt: '2026-10-31T12:05:00.000Z',
            endedAt: null,
            durationSeconds: null,
        }, Date.parse('2026-10-31T12:00:00.000Z')),
        0,
    )
    assert.equal(
        getPdvOfflineEpisodeDurationSeconds({
            estimatedStartedAt: 'invalid',
            endedAt: null,
            durationSeconds: null,
        }, Date.now()),
        null,
    )
})

test('labels persisted episode states', () => {
    assert.equal(getPdvOfflineEpisodeStatusLabel('open'), 'Em andamento')
    assert.equal(getPdvOfflineEpisodeStatusLabel('reconnected'), 'Comunicação retomada')
    assert.equal(getPdvOfflineEpisodeStatusLabel('cash_register_closed'), 'Caixa fechado')
})

test('only reconnection and confirmed cash-register closure count as completed history', () => {
    assert.equal(isCompletedPdvOfflineEpisode('reconnected'), true)
    assert.equal(isCompletedPdvOfflineEpisode('cash_register_closed'), true)
    assert.equal(isCompletedPdvOfflineEpisode('open'), false)
    assert.equal(isCompletedPdvOfflineEpisode('session_ended'), false)
})

test('builds America/Sao_Paulo day bounds independently of browser timezone', () => {
    const bounds = getPdvOfflineEpisodeSaoPauloDateBounds('2026-10-31')
    assert.ok(bounds)
    assert.equal(bounds.start, '2026-10-31T03:00:00.000Z')
    assert.equal(bounds.end, '2026-11-01T03:00:00.000Z')
    assert.equal(getPdvOfflineEpisodeSaoPauloDateBounds('not-a-date'), null)
    assert.equal(getPdvOfflineEpisodeSaoPauloDateBounds('2026-02-31'), null)
})

test('associates offline sales only to one matching closed occurrence', () => {
    const episode: OfflineEpisodeSaleEpisode = {
        id: 'episode-1',
        bakeryId: 'bakery-1',
        operatorUserId: 'operator-1',
        cashRegisterId: 'register-1',
        estimatedStartedAt: '2026-10-31T12:00:00.000Z',
        endedAt: '2026-10-31T12:10:00.000Z',
        durationSeconds: 600,
    }
    const sale: OfflineEpisodeSale = {
        id: 'sale-1',
        bakeryId: episode.bakeryId,
        operatorUserId: episode.operatorUserId,
        cashRegisterId: episode.cashRegisterId,
        offlineSessionId: '0d152d90-26dc-4ad0-a99a-397fbcdff5cd',
        occurredAt: '2026-10-31T12:05:00.000Z',
        total: 14.5,
        items: [{ name: 'Pão francês', quantity: 2 }],
    }

    const pending = associateOfflineEpisodeSales([episode], [sale], new Set())
    assert.equal(pending.get(episode.id), null)

    const closed = associateOfflineEpisodeSales([episode], [sale], new Set([episode.cashRegisterId]))
    assert.deepEqual(closed.get(episode.id), [sale])

    const noSales = associateOfflineEpisodeSales(
        [episode],
        [],
        new Set([episode.cashRegisterId]),
    )
    assert.equal(noSales.get(episode.id), null)
})

test('leaves session sales unconfirmed when timestamps or occurrence candidates are ambiguous', () => {
    const episode: OfflineEpisodeSaleEpisode = {
        id: 'episode-1',
        bakeryId: 'bakery-1',
        operatorUserId: 'operator-1',
        cashRegisterId: 'register-1',
        estimatedStartedAt: '2026-10-31T12:00:00.000Z',
        endedAt: '2026-10-31T12:10:00.000Z',
        durationSeconds: 600,
    }
    const sale: OfflineEpisodeSale = {
        id: 'sale-1',
        bakeryId: episode.bakeryId,
        operatorUserId: episode.operatorUserId,
        cashRegisterId: episode.cashRegisterId,
        offlineSessionId: '0d152d90-26dc-4ad0-a99a-397fbcdff5cd',
        occurredAt: '2026-10-31T12:05:00.000Z',
        total: 14.5,
        items: [{ name: 'Pão francês', quantity: 2 }],
    }
    const overlappingEpisode = {
        ...episode,
        id: 'episode-2',
        estimatedStartedAt: '2026-10-31T12:04:00.000Z',
        endedAt: '2026-10-31T12:12:00.000Z',
    }
    const closedRegisters = new Set([episode.cashRegisterId])

    const ambiguous = associateOfflineEpisodeSales(
        [episode, overlappingEpisode],
        [sale],
        closedRegisters,
    )
    assert.equal(ambiguous.get(episode.id), null)
    assert.equal(ambiguous.get(overlappingEpisode.id), null)

    const outsideWindow = associateOfflineEpisodeSales(
        [episode],
        [{ ...sale, occurredAt: '2026-10-31T11:59:59.000Z' }],
        closedRegisters,
    )
    assert.equal(outsideWindow.get(episode.id), null)

    const splitSession = associateOfflineEpisodeSales(
        [episode],
        [
            sale,
            { ...sale, id: 'sale-2', occurredAt: '2026-10-31T12:11:00.000Z' },
        ],
        closedRegisters,
    )
    assert.equal(splitSession.get(episode.id), null)

    const unidentifiedSale = associateOfflineEpisodeSales(
        [episode],
        [
            sale,
            { ...sale, id: 'unidentified-sale', offlineSessionId: null },
        ],
        closedRegisters,
    )
    assert.equal(unidentifiedSale.get(episode.id), null)
})

test('polling fetches the real register ID without changing the existing heartbeat flow', () => {
    assert.match(heartbeatHook, /select\('id, bakery_id, opened_by, opened_at'\)/)
    assert.match(heartbeatHook, /\.eq\('status', 'open'\)/)
    assert.match(heartbeatHook, /PDV_OFFLINE_THRESHOLD_MS = 75_000/)
    assert.match(heartbeatHook, /startPdvHeartbeatPolling/)
    assert.match(heartbeatService, /\.from\('pdv_heartbeats'\)\.upsert/)
    assert.doesNotMatch(heartbeatService, /record_pdv_cash_register_heartbeat/)
    assert.match(heartbeatHook, /\.from\('cash_registers'\)[\s\S]+?select\('id, bakery_id, opened_by, opened_at'\)/)
})

test('migration only creates episode storage and leaves legacy heartbeats and cron untouched', () => {
    assert.match(migration, /CREATE TABLE public\.pdv_offline_episodes/)
    assert.doesNotMatch(migration, /ALTER TABLE public\.pdv_heartbeats/i)
    assert.doesNotMatch(migration, /DROP POLICY[\s\S]+?pdv_heartbeats/i)
    assert.doesNotMatch(migration, /pdv_cash_register_heartbeats|cron\.|cron_schedule/i)
    assert.doesNotMatch(migration, /server_seen_at/)
})

test('episode table prevents duplicate open episodes and restricts writes to owner RPCs', () => {
    assert.match(
        migration,
        /CREATE UNIQUE INDEX pdv_offline_episodes_one_open_per_register_uidx[\s\S]+?WHERE status = 'open'/,
    )
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
    assert.match(
        migration,
        /REVOKE ALL ON TABLE public\.pdv_offline_episodes FROM PUBLIC, anon, authenticated/,
    )
    assert.match(migration, /GRANT SELECT ON TABLE public\.pdv_offline_episodes TO authenticated/)
    assert.match(migration, /USING \(\(SELECT private\.is_owner\(\)\)\)/)
    assert.match(migration, /SECURITY DEFINER\s+SET search_path TO ''/)
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.record_pdv_offline_episode\(uuid\)/)
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.finish_pdv_offline_episode\(uuid\)/)
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_pdv_offline_episode\(uuid\)\s+TO authenticated/)
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.finish_pdv_offline_episode\(uuid\)\s+TO authenticated/)
})

test('episode creation validates the open register and matching stale heartbeat on the server', () => {
    assert.match(
        migration,
        /cash_register\.id = p_cash_register_id[\s\S]+?cash_register\.status = 'open'[\s\S]+?FOR UPDATE/,
    )
    assert.match(
        migration,
        /heartbeat\.user_id = v_register\.operator_user_id[\s\S]+?heartbeat\.bakery_id = v_register\.bakery_id[\s\S]+?heartbeat\.last_seen_at <= v_now - interval '75 seconds'[\s\S]+?FOR UPDATE/,
    )
    assert.match(migration, /ON CONFLICT \(cash_register_id\) WHERE status = 'open' DO NOTHING/)
    assert.match(migration, /GREATEST\([\s\S]+?v_register\.opened_at/)
})

test('episode completion confirms reconnection for the same register or an actual close', () => {
    assert.match(
        migration,
        /cash_register\.id = p_cash_register_id[\s\S]+?FOR UPDATE/,
    )
    assert.match(
        migration,
        /episode\.cash_register_id = p_cash_register_id[\s\S]+?episode\.status = 'open'[\s\S]+?FOR UPDATE/,
    )
    assert.match(migration, /v_register\.status = 'closed'/)
    assert.match(
        migration,
        /heartbeat\.user_id = v_episode\.operator_user_id[\s\S]+?heartbeat\.bakery_id = v_episode\.bakery_id[\s\S]+?heartbeat\.last_seen_at > v_now - interval '75 seconds'[\s\S]+?FOR UPDATE/,
    )
    assert.match(migration, /v_status := 'reconnected'/)
    assert.match(migration, /v_status := 'cash_register_closed'/)
    assert.match(migration, /WHERE episode\.id = v_episode\.id\s+AND episode\.status = 'open'/)
})

test('episode synchronization runs only after a successful existing monitor poll', () => {
    assert.match(offlinePage, /if \(!isOwner \|\| lastUpdatedAt === null \|\| monitoringError\) return/)
    assert.match(offlinePage, /syncPdvOfflineEpisodes\(/)
    assert.match(offlinePage, /lastUpdatedAt,[\s\S]+?PDV_OFFLINE_THRESHOLD_MS/)
    assert.match(offlinePage, /reconnectedCashRegisterIds/)
    assert.doesNotMatch(offlinePage, /setInterval\([^)]*syncPdvOfflineEpisodes/)
    assert.match(offlinePage, /As ocorrências só são identificadas enquanto esta página administrativa está aberta/)
})

test('periodic monitor polls keep history visible while refreshing only changed episodes', () => {
    assert.match(offlinePage, /const historyQueryKey = `\$\{historyDateFilter\}\|\$\{historyBakeryFilter\}`/)
    assert.doesNotMatch(offlinePage, /const historyQueryKey[\s\S]{0,150}lastUpdatedAt/)
    assert.match(
        offlinePage,
        /\}, \[historyBakeryFilter, historyDateFilter, historyQueryKey, historyRefreshRevision, isOwner\]\)/,
    )
    assert.match(offlinePage, /const isLoadingHistory = isOwner && visibleHistoryResult === null/)
    assert.match(offlinePage, /if \(changed\) setHistoryRefreshRevision/)
    assert.match(offlinePage, /\}, \[isOwner\]\)/)
    assert.match(offlinePage, /expandedOfflineSales/)
})

test('history queries and renders completed episodes only while preserving date filters', () => {
    assert.match(episodeService, /\.in\('status', \['open', 'reconnected', 'cash_register_closed', 'session_ended'\]\)/)
    assert.match(episodeService, /Date\.parse\(episode\.endedAt\) >= Date\.parse\(dateBounds\.start\)/)
    assert.doesNotMatch(episodeService, /ended_at\.is\.null/)
    assert.match(episodeService, /isCompletedPdvOfflineEpisode\(episode\.status\)/)
    assert.doesNotMatch(offlinePage, /Em andamento; sem evidência/)
    assert.match(offlinePage, /historyDateFilter/)
    assert.match(offlinePage, /historyBakeryFilter/)
    assert.match(offlinePage, /Nenhuma ocorrência encerrada encontrada para estes filtros/)
})

test('history cards show occurrence details and emphasize communication duration', () => {
    assert.match(offlinePage, /offline-history-identity/)
    assert.match(offlinePage, /offline-history-operator/)
    assert.match(offlinePage, /formatOccurrenceDate\(episode\.estimatedStartedAt\)/)
    assert.match(offlinePage, /Comunicação interrompida/)
    assert.match(offlinePage, /Início estimado ·/)
    assert.match(offlinePage, /Comunicação restabelecida/)
    assert.match(offlinePage, /Duração da ocorrência/)
    assert.doesNotMatch(
        offlinePage,
        /Último heartbeat registrado|Vendas offline sincronizadas/,
    )
    assert.doesNotMatch(offlinePage, /<span>\{historyError\}<\/span>|<span>\{episodeSyncError\}<\/span>/)
    assert.match(offlinePage, /As ocorrências só são identificadas enquanto esta página administrativa está aberta/)
    assert.match(offlinePageStyles, /\.offline-history-timeline-events/)
    assert.match(offlinePageStyles, /\.offline-history-event:not\(:last-child\)::after/)
    assert.match(offlinePageStyles, /\.offline-history-duration strong[\s\S]+?font-size: 20px/)
    assert.match(offlinePageStyles, /@media \(max-width: 767px\)[\s\S]+?\.offline-history-timeline/)
    assert.match(offlinePage, /Vendas realizadas offline/)
    assert.match(offlinePage, /Quantidade de vendas/)
    assert.match(offlinePage, /Valor total/)
    assert.match(offlinePage, /Ver vendas/)
    assert.match(offlinePage, /Ocultar vendas/)
    assert.match(offlinePage, /Dados de vendas ainda não confirmados/)
    assert.match(episodeService, /sale_items\(name, quantity\)/)
    assert.match(offlinePage, /offlineSales\.map\(\(sale, index\)/)
    assert.match(offlinePage, /<strong>Venda \{index \+ 1\}<\/strong>/)
    assert.match(offlinePage, /sale\.items\.map/)
    assert.match(offlinePage, /offlineSalesCurrency\.format\(sale\.total\)/)
    assert.doesNotMatch(offlinePage, /<span>Venda \{sale\.id\}<\/span>/)
    assert.match(offlinePageStyles, /\.offline-history-sale-items/)
})

test('history paginates all filtered records locally in groups of ten and resets on filter changes', () => {
    assert.match(episodeService, /const PAGE_SIZE = 500/)
    assert.match(episodeService, /for \(let offset = 0; ; offset \+= PAGE_SIZE\)/)
    assert.match(episodeService, /if \(records\.length < PAGE_SIZE\) break/)
    assert.match(episodeService, /\.order\('estimated_started_at', \{ ascending: false \}\)/)
    assert.match(offlinePage, /const HISTORY_PAGE_SIZE = 10/)
    assert.match(offlinePage, /useState\(1\)/)
    assert.match(offlinePage, /historyEpisodes\.slice\([\s\S]+?HISTORY_PAGE_SIZE/)
    assert.match(offlinePage, /setHistoryDateFilter\(event\.target\.value\)[\s\S]+?setHistoryPage\(1\)/)
    assert.match(offlinePage, /setHistoryBakeryFilter\(event\.target\.value\)[\s\S]+?setHistoryPage\(1\)/)
    assert.match(offlinePage, /Página \{currentHistoryPage\} de \{historyTotalPages\}/)
    assert.match(offlinePage, /disabled=\{currentHistoryPage === 1\}/)
    assert.match(offlinePage, /disabled=\{currentHistoryPage === historyTotalPages\}/)
    assert.match(offlinePage, /paginatedHistoryEpisodes\.map/)
    assert.match(offlinePageStyles, /\.offline-history-pagination/)
})

test('current monitor describes communication status without internal terms', () => {
    assert.match(offlinePage, /Caixas sem comunicação recente/)
    assert.match(offlinePage, /não\s+permite confirmar se o navegador foi fechado ou se a conexão foi interrompida/)
    assert.match(offlinePage, /Sem comunicação recente/)
    assert.doesNotMatch(offlinePage, /Possivelmente offline/)
    assert.doesNotMatch(offlinePage, /Consultando estado dos caixas no Supabase|heartbeat recente/)
})

test('sync service reconciles only matching register IDs and surfaces RPC failures', () => {
    assert.match(episodeService, /cash_register_id/)
    assert.match(episodeService, /client\.rpc\('record_pdv_offline_episode'/)
    assert.match(episodeService, /client\.rpc\('finish_pdv_offline_episode'/)
    assert.match(episodeService, /openRegisterIds\.has\(cashRegisterId\) && !reconnectedIds\.has\(cashRegisterId\)/)
    assert.match(episodeService, /if \(error\)[\s\S]+?throw new Error/)
})

test('the history keeps bakery and date filters and scopes sales to episode registers', () => {
    assert.match(episodeService, /\.eq\('bakery_id', filters\.bakeryId\)/)
    assert.match(episodeService, /getPdvOfflineEpisodeSaoPauloDateBounds/)
    assert.match(episodeService, /\.eq\('bakery_id', bakeryId\)/)
    assert.match(episodeService, /\.in\('cash_register_id', registerChunk\)/)
    assert.match(episodeService, /\.not\('offline_session_id', 'is', null\)/)
    assert.match(episodeService, /\.is\('offline_session_id', null\)/)
    assert.match(episodeService, /\.or\(timeRanges\.join\(','\)\)/)
    assert.match(offlinePage, /offline-history-date/)
    assert.match(offlinePage, /offline-history-bakery/)
    assert.match(offlinePage, /HISTORY_PAGE_SIZE = 10/)
})

test('offline sale migration preserves the existing secure idempotent RPC and sales read policies', () => {
    assert.match(offlineSalesMigration, /ALTER TABLE public\.sales[\s\S]+ADD COLUMN IF NOT EXISTS offline_session_id uuid/)
    assert.match(offlineSalesMigration, /DROP FUNCTION public\.create_sale_with_items\([\s\S]+?timestamptz\s+\);/)
    assert.match(offlineSalesMigration, /CREATE OR REPLACE FUNCTION public\.create_sale_with_items\([\s\S]+?p_offline_session_id uuid DEFAULT NULL/)
    assert.match(offlineSalesMigration, /SECURITY DEFINER\s+SET search_path TO ''/)
    assert.match(offlineSalesMigration, /IF p_offline_session_id IS NOT NULL THEN[\s\S]+?jsonb_build_object\('offline_session_id', p_offline_session_id\)/)
    assert.match(offlineSalesMigration, /offline_session_id,[\s\S]+?p_offline_session_id,[\s\S]+?v_occurred_at/)
    assert.match(offlineSalesMigration, /REVOKE ALL ON FUNCTION public\.create_sale_with_items\([\s\S]+?FROM PUBLIC, anon, authenticated/)
    assert.match(offlineSalesMigration, /GRANT EXECUTE ON FUNCTION public\.create_sale_with_items\([\s\S]+?TO authenticated/)
    assert.match(offlineSalesMigration, /IF v_user_id IS NULL OR NOT \(SELECT private\.is_cashier\(\)\)/)
    assert.match(offlineSalesMigration, /cash_register\.status = 'open'/)
    assert.match(offlineSalesMigration, /UPDATE public\.product_stock/)
    assert.doesNotMatch(offlineSalesMigration, /CREATE TABLE|CREATE FUNCTION public\./)
    assert.match(operations, /p_offline_session_id: input\.offlineSessionId \?\? null/)
    assert.match(operations, /offlineSessionId: sale\.offlineSessionId \?\? null/)
    assert.match(salesReadPolicies, /CREATE POLICY sales_select_owner_or_cashier_own_bakery/)
    assert.match(salesReadPolicies, /bakery_id = \(SELECT private\.current_user_bakery_id\(\)\)/)
    assert.match(operationalReadPolicies, /GRANT SELECT ON TABLE public\.cash_registers,[\s\S]+?public\.sales/)
    assert.match(operationalReadPolicies, /CREATE POLICY cash_registers_select_by_role_and_bakery/)
    assert.match(episodeService, /client[\s\S]+?\.from\('sales'\)[\s\S]+?\.eq\('bakery_id', bakeryId\)/)
    assert.match(episodeService, /\.from\('cash_registers'\)[\s\S]+?\.select\('id, status'\)/)
})

test('normal logout is sent through the authenticated session RPC before auth sign-out', () => {
    assert.match(lifecycleMigration, /CREATE FUNCTION public\.end_pdv_cash_register_session/)
    assert.match(lifecycleMigration, /auth\.uid\(\)[\s\S]+?private\.is_cashier\(\)/)
    assert.match(lifecycleMigration, /cash_register\.opened_by = \(SELECT auth\.uid\(\)\)/)
    assert.match(lifecycleMigration, /cash_register\.bakery_id = ANY/)
    assert.match(lifecycleMigration, /reason IN \('pagehide', 'logout'\)/)
    assert.match(lifecycleMigration, /status = 'session_ended'/)
    assert.match(lifecycleMigration, /CREATE TRIGGER pdv_offline_episodes_skip_ended_session/)
    assert.match(lifecycleMigration, /CREATE FUNCTION public\.resume_pdv_cash_register_session/)
    assert.match(lifecycleMigration, /v_reason = 'pagehide'/)

    const auth = readFileSync(new URL('../src/services/auth.ts', import.meta.url), 'utf8')
    assert.match(auth, /endPdvCashRegisterSession\(registerId, 'logout'\)/)
    assert.match(auth, /client\.auth\.signOut\(\)/)
})

test('pagehide is a best-effort lifecycle hint and normal restoration resumes the same register', () => {
    const heartbeat = readFileSync(new URL('../src/services/pdvHeartbeat.ts', import.meta.url), 'utf8')
    assert.match(heartbeat, /window\.addEventListener\('pagehide'/)
    assert.match(heartbeat, /event\.persisted/)
    assert.match(heartbeat, /endPdvCashRegisterSessionOnPageHide/)
    assert.match(heartbeat, /resumePdvCashRegisterSession\(cashRegister\.id\)/)
    assert.doesNotMatch(heartbeat, /beforeunload|unload/)
    assert.match(lifecycleMigration, /UPDATE public\.pdv_offline_episodes AS episode[\s\S]+?SET status = 'open'/)
})
