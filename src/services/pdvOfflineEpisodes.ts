import { getSupabaseClient } from '../lib/supabaseClient'
import {
    getPdvOfflineEpisodeSaoPauloDateBounds,
    isCompletedPdvOfflineEpisode,
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
    }
}

export async function getPdvOfflineEpisodes(
    filters: PdvOfflineEpisodeFilters = {},
): Promise<PdvOfflineEpisode[]> {
    const client = getSupabaseClient()
    const results: PdvOfflineEpisode[] = []
    const dateBounds = filters.date
        ? getPdvOfflineEpisodeSaoPauloDateBounds(filters.date)
        : null
    if (filters.date && !dateBounds) {
        throw new Error('A data selecionada para filtrar o histórico é inválida.')
    }

    for (let offset = 0; ; offset += PAGE_SIZE) {
        let query = client
            .from('pdv_offline_episodes')
            .select(EPISODE_FIELDS)
            .in('status', ['reconnected', 'cash_register_closed'])
            .order('estimated_started_at', { ascending: false })
            .order('id', { ascending: false })

        if (filters.bakeryId) {
            query = query.eq('bakery_id', filters.bakeryId)
        }
        if (dateBounds) {
            query = query
                .lt('estimated_started_at', dateBounds.end)
                .gte('ended_at', dateBounds.start)
        }

        const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)
        if (error) {
            console.error('Não foi possível carregar o histórico de caixas fora do ar.', error)
            throw new Error('Não foi possível carregar o histórico de caixas fora do ar. Atualize a tela e tente novamente.')
        }

        const records: unknown[] = data ?? []
        results.push(...records.map(mapEpisode).filter((episode) =>
            isCompletedPdvOfflineEpisode(episode.status),
        ))
        if (records.length < PAGE_SIZE) return results
    }
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
