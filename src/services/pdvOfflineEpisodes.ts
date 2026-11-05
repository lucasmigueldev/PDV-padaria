import { getSupabaseClient } from '../lib/supabaseClient'
import {
    associateOfflineEpisodeSales,
    getPdvOfflineEpisodeSaoPauloDateBounds,
    isCompletedPdvOfflineEpisode,
    type OfflineEpisodeSale,
    type OfflineEpisodeSaleItem,
    type PdvOfflineEpisodeStatus,
} from './pdvOfflineEpisodePresentation'

export interface PdvOfflineEpisode {
    id: string
    bakeryId: string
    bakeryName: string
    operatorUserId: string
    operatorName: string
    cashRegisterId: string
    lastContactAt: string
    estimatedStartedAt: string
    detectedAt: string
    endedAt: string | null
    durationSeconds: number | null
    status: PdvOfflineEpisodeStatus
    offlineSales: OfflineEpisodeSale[] | null
}

export interface PdvOfflineEpisodeFilters {
    date?: string
    bakeryId?: string
}

export interface PdvOfflineEpisodeRegister {
    cashRegisterId: string
}

const EPISODE_FIELDS = [
    'id',
    'bakery_id',
    'bakery_name_snapshot',
    'operator_user_id',
    'operator_name_snapshot',
    'cash_register_id',
    'last_contact_at',
    'estimated_started_at',
    'detected_at',
    'ended_at',
    'duration_seconds',
    'status',
].join(', ')

const PAGE_SIZE = 500
const FILTER_CHUNK_SIZE = 100

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRequiredString(record: Record<string, unknown>, field: string): string {
    const value = record[field]
    if (typeof value !== 'string' || value === '') {
        throw new Error('O Supabase retornou um episódio de caixa fora do ar inválido.')
    }
    return value
}

function mapEpisode(value: unknown): PdvOfflineEpisode {
    if (!isRecord(value)) {
        throw new Error('O Supabase retornou um episódio de caixa fora do ar inválido.')
    }
    const record = value

    const status = record.status
    if (status !== 'open'
        && status !== 'reconnected'
        && status !== 'cash_register_closed'
        && status !== 'session_ended') {
        throw new Error('O Supabase retornou um status de episódio desconhecido.')
    }

    const endedAt = record.ended_at
    if (endedAt !== null && typeof endedAt !== 'string') {
        throw new Error('O Supabase retornou um horário de encerramento inválido.')
    }

    const durationValue = record.duration_seconds
    const durationSeconds = durationValue === null
        ? null
        : typeof durationValue === 'number' || typeof durationValue === 'string'
            ? Number(durationValue)
            : Number.NaN
    if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds < 0)) {
        throw new Error('O Supabase retornou uma duração de episódio inválida.')
    }

    return {
        id: getRequiredString(record, 'id'),
        bakeryId: getRequiredString(record, 'bakery_id'),
        bakeryName: getRequiredString(record, 'bakery_name_snapshot'),
        operatorUserId: getRequiredString(record, 'operator_user_id'),
        operatorName: getRequiredString(record, 'operator_name_snapshot'),
        cashRegisterId: getRequiredString(record, 'cash_register_id'),
        lastContactAt: getRequiredString(record, 'last_contact_at'),
        estimatedStartedAt: getRequiredString(record, 'estimated_started_at'),
        detectedAt: getRequiredString(record, 'detected_at'),
        endedAt,
        durationSeconds,
        status,
        offlineSales: null,
    }
}

function mapOfflineSale(value: unknown, includeItems = false): OfflineEpisodeSale {
    if (!isRecord(value)) {
        throw new Error('O Supabase retornou uma venda offline inválida.')
    }

    const total = typeof value.total === 'number' || typeof value.total === 'string'
        ? Number(value.total)
        : Number.NaN
    if (!Number.isFinite(total) || total < 0) {
        throw new Error('O Supabase retornou um valor de venda offline inválido.')
    }

    const occurredAt = getRequiredString(value, 'occurred_at')
    if (!Number.isFinite(Date.parse(occurredAt))) {
        throw new Error('O Supabase retornou um horário de venda offline inválido.')
    }

    const rawItems = value.sale_items
    if (includeItems && !Array.isArray(rawItems)) {
        throw new Error('O Supabase retornou uma venda offline sem os produtos registrados.')
    }
    const items: OfflineEpisodeSaleItem[] = (Array.isArray(rawItems) ? rawItems : []).map((item) => {
        if (!isRecord(item)
            || typeof item.name !== 'string'
            || !Number.isSafeInteger(item.quantity)
            || Number(item.quantity) <= 0) {
            throw new Error('O Supabase retornou um produto de venda offline inválido.')
        }
        return {
            name: item.name,
            quantity: Number(item.quantity),
        }
    })

    return {
        id: getRequiredString(value, 'id'),
        bakeryId: getRequiredString(value, 'bakery_id'),
        operatorUserId: getRequiredString(value, 'cashier_user_id'),
        cashRegisterId: getRequiredString(value, 'cash_register_id'),
        offlineSessionId: typeof value.offline_session_id === 'string'
            ? value.offline_session_id
            : null,
        occurredAt,
        total,
        items,
    }
}

async function getUnmarkedSalesInEpisodes(
    client: ReturnType<typeof getSupabaseClient>,
    episodes: readonly PdvOfflineEpisode[],
): Promise<OfflineEpisodeSale[]> {
    const episodesByRegister = new Map<string, PdvOfflineEpisode[]>()
    for (const episode of episodes) {
        const key = JSON.stringify([
            episode.bakeryId,
            episode.operatorUserId,
            episode.cashRegisterId,
        ])
        const group = episodesByRegister.get(key) ?? []
        group.push(episode)
        episodesByRegister.set(key, group)
    }

    const sales: OfflineEpisodeSale[] = []
    for (const group of episodesByRegister.values()) {
        for (let chunkStart = 0; chunkStart < group.length; chunkStart += 25) {
            const episodeChunk = group.slice(chunkStart, chunkStart + 25)
            const first = episodeChunk[0]
            const timeRanges = episodeChunk.map((episode) =>
                `and(occurred_at.gte.${episode.estimatedStartedAt},occurred_at.lte.${episode.endedAt})`,
            )
            for (let offset = 0; ; offset += PAGE_SIZE) {
                const { data, error } = await client
                    .from('sales')
                    .select('id, bakery_id, cashier_user_id, cash_register_id, occurred_at, total, offline_session_id')
                    .eq('bakery_id', first.bakeryId)
                    .eq('cashier_user_id', first.operatorUserId)
                    .eq('cash_register_id', first.cashRegisterId)
                    .is('offline_session_id', null)
                    .or(timeRanges.join(','))
                    .order('occurred_at', { ascending: true })
                    .order('id', { ascending: true })
                    .range(offset, offset + PAGE_SIZE - 1)

                if (error) {
                    console.error('Não foi possível verificar vendas sem identificação offline no histórico.', error)
                    throw new Error('Não foi possível confirmar os dados de vendas destas ocorrências. Atualize a tela e tente novamente.')
                }

                const records: unknown[] = data ?? []
                sales.push(...records.map((record) => mapOfflineSale(record)))
                if (records.length < PAGE_SIZE) break
            }
        }
    }

    return sales
}

export async function getPdvOfflineEpisodes(
    filters: PdvOfflineEpisodeFilters = {},
): Promise<PdvOfflineEpisode[]> {
    const client = getSupabaseClient()
    const dateBounds = filters.date
        ? getPdvOfflineEpisodeSaoPauloDateBounds(filters.date)
        : null
    if (filters.date && !dateBounds) {
        throw new Error('A data selecionada para filtrar o histórico é inválida.')
    }

    const episodes: PdvOfflineEpisode[] = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
        // Keep all occurrence candidates in scope before applying the date filter, so a hidden
        // occurrence cannot make a sale appear to match uniquely.
        let query = client
            .from('pdv_offline_episodes')
            .select(EPISODE_FIELDS)
            .in('status', ['open', 'reconnected', 'cash_register_closed', 'session_ended'])
            .order('estimated_started_at', { ascending: false })
            .order('id', { ascending: false })

        if (filters.bakeryId) {
            query = query.eq('bakery_id', filters.bakeryId)
        }
        const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)
        if (error) {
            console.error('Não foi possível carregar o histórico de caixas fora do ar.', error)
            throw new Error('Não foi possível carregar o histórico de caixas fora do ar. Atualize a tela e tente novamente.')
        }

        const records: unknown[] = data ?? []
        episodes.push(...records.map(mapEpisode))
        if (records.length < PAGE_SIZE) break
    }

    if (episodes.length === 0) return episodes

    const registersByBakery = new Map<string, Set<string>>()
    for (const episode of episodes) {
        const registers = registersByBakery.get(episode.bakeryId) ?? new Set<string>()
        registers.add(episode.cashRegisterId)
        registersByBakery.set(episode.bakeryId, registers)
    }

    const sales: OfflineEpisodeSale[] = []
    for (const [bakeryId, registerSet] of registersByBakery) {
        const registerIds = [...registerSet]
        for (let chunkStart = 0; chunkStart < registerIds.length; chunkStart += FILTER_CHUNK_SIZE) {
            const registerChunk = registerIds.slice(chunkStart, chunkStart + FILTER_CHUNK_SIZE)
            for (let offset = 0; ; offset += PAGE_SIZE) {
                const { data, error } = await client
                    .from('sales')
                    .select('id, bakery_id, cashier_user_id, cash_register_id, occurred_at, total, offline_session_id, sale_items(name, quantity)')
                    .eq('bakery_id', bakeryId)
                    .in('cash_register_id', registerChunk)
                    .not('offline_session_id', 'is', null)
                    .order('occurred_at', { ascending: true })
                    .order('id', { ascending: true })
                    .range(offset, offset + PAGE_SIZE - 1)

                if (error) {
                    console.error('Não foi possível carregar as vendas offline do histórico.', error)
                    throw new Error('Não foi possível confirmar as vendas realizadas fora do ar. Atualize a tela e tente novamente.')
                }

                const records: unknown[] = data ?? []
                sales.push(...records.map((record) => mapOfflineSale(record, true)))
                if (records.length < PAGE_SIZE) break
            }
        }
    }

    const registerIds = [...new Set(episodes.map((episode) => episode.cashRegisterId))]
    const closedCashRegisterIds = new Set<string>()
    for (let chunkStart = 0; chunkStart < registerIds.length; chunkStart += FILTER_CHUNK_SIZE) {
        const registerChunk = registerIds.slice(chunkStart, chunkStart + FILTER_CHUNK_SIZE)
        const { data, error } = await client
            .from('cash_registers')
            .select('id, status')
            .in('id', registerChunk)

        if (error) {
            console.error('Não foi possível confirmar o estado dos caixas do histórico offline.', error)
            throw new Error('Não foi possível confirmar se as vendas offline foram sincronizadas. Atualize a tela e tente novamente.')
        }

        for (const register of data ?? []) {
            if (isRecord(register) && typeof register.id === 'string' && register.status === 'closed') {
                closedCashRegisterIds.add(register.id)
            }
        }
    }

    // Closing a register is blocked while any queued sale remains unresolved.
    const tentativeSalesByEpisode = associateOfflineEpisodeSales(episodes, sales, closedCashRegisterIds)
    const episodesWithTentativeSales = episodes.filter((episode) =>
        tentativeSalesByEpisode.get(episode.id) !== null,
    )
    const unmarkedSales = await getUnmarkedSalesInEpisodes(client, episodesWithTentativeSales)
    const salesByEpisode = associateOfflineEpisodeSales(
        episodes,
        [...sales, ...unmarkedSales],
        closedCashRegisterIds,
    )
    const results = episodes
        .filter((episode) => isCompletedPdvOfflineEpisode(episode.status))
        .map((episode) => ({
            ...episode,
            offlineSales: salesByEpisode.get(episode.id) ?? null,
        }))

    if (!dateBounds) return results
    return results.filter((episode) =>
        Date.parse(episode.estimatedStartedAt) < Date.parse(dateBounds.end)
        && episode.endedAt !== null
        && Date.parse(episode.endedAt) >= Date.parse(dateBounds.start),
    )
}

export async function syncPdvOfflineEpisodes(
    offlineRegisters: readonly PdvOfflineEpisodeRegister[],
    openCashRegisterIds: readonly string[],
    reconnectedCashRegisterIds: readonly string[],
    endedCashRegisterIds: readonly string[] = [],
): Promise<boolean> {
    const client = getSupabaseClient()
    const { data: openEpisodes, error: openEpisodesError } = await client
        .from('pdv_offline_episodes')
        .select('cash_register_id')
        .eq('status', 'open')

    if (openEpisodesError) {
        console.error('Não foi possível consultar os episódios abertos de caixas fora do ar.', openEpisodesError)
        throw new Error('Não foi possível sincronizar o histórico de caixas fora do ar.')
    }

    const openEpisodeIds = new Set((openEpisodes ?? [])
        .map((episode: { cash_register_id: unknown }) => episode.cash_register_id)
        .filter((id: unknown): id is string => typeof id === 'string'))
    const openRegisterIds = new Set(openCashRegisterIds)
    const reconnectedIds = new Set(reconnectedCashRegisterIds)
    const endedSessionIds = new Set(endedCashRegisterIds)
    let changed = false

    for (const cashRegisterId of openEpisodeIds) {
        if (endedSessionIds.has(cashRegisterId)) continue
        if (openRegisterIds.has(cashRegisterId) && !reconnectedIds.has(cashRegisterId)) {
            continue
        }

        const { data, error } = await client.rpc('finish_pdv_offline_episode', {
            p_cash_register_id: cashRegisterId,
        })
        if (error) {
            console.error('Não foi possível encerrar um episódio de caixa fora do ar.', error)
            throw new Error('Não foi possível sincronizar o histórico de caixas fora do ar.')
        }
        changed ||= data === true
    }

    for (const register of offlineRegisters) {
        const alreadyOpen = openEpisodeIds.has(register.cashRegisterId)
        const { data, error } = await client.rpc('record_pdv_offline_episode', {
            p_cash_register_id: register.cashRegisterId,
        })
        if (error) {
            console.error('Não foi possível registrar um episódio de caixa fora do ar.', error)
            throw new Error('Não foi possível sincronizar o histórico de caixas fora do ar.')
        }
        changed ||= !alreadyOpen && typeof data === 'string'
    }

    return changed
}
