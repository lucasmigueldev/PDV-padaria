import { subscribeConnection } from './connection'

export type OfflinePeriod = {
    id: string
    startedAt: number
    endedAt: number | null
    durationMs: number | null
}

const STORAGE_KEY = 'pdv_offline_periods_v1'

let periods: OfflinePeriod[] = []
let snapshot: readonly OfflinePeriod[] = Object.freeze([])
let isLoaded = false
const listeners = new Set<() => void>()

let offlineStartedAt: number | null = null

function isOfflinePeriod(value: unknown): value is OfflinePeriod {
    if (typeof value !== 'object' || value === null) {
        return false
    }

    const period = value as Record<string, unknown>
    return typeof period.id === 'string'
        && typeof period.startedAt === 'number'
        && Number.isFinite(period.startedAt)
        && (period.endedAt === null
            || (typeof period.endedAt === 'number' && Number.isFinite(period.endedAt)))
        && (period.durationMs === null
            || (typeof period.durationMs === 'number' && Number.isFinite(period.durationMs)))
}

function createSnapshot(list: OfflinePeriod[]): readonly OfflinePeriod[] {
    return Object.freeze(
        [...list]
            .sort((first, second) => second.startedAt - first.startedAt)
            .map((period) => Object.freeze({ ...period })),
    )
}

function haveSamePeriods(first: OfflinePeriod[], second: OfflinePeriod[]): boolean {
    return first.length === second.length
        && first.every((period, index) => {
            const next = second[index]
            return period.id === next.id
                && period.startedAt === next.startedAt
                && period.endedAt === next.endedAt
                && period.durationMs === next.durationMs
        })
}

function load(): OfflinePeriod[] {
    if (isLoaded) {
        return periods
    }

    isLoaded = true
    if (typeof window === 'undefined') {
        return periods
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw) {
            const storedPeriods: unknown = JSON.parse(raw)
            if (Array.isArray(storedPeriods) && storedPeriods.every(isOfflinePeriod)) {
                periods = storedPeriods
            } else {
                console.error('Os períodos offline armazenados possuem um formato inválido.')
            }
        }
    } catch (error) {
        console.error('Falha ao ler períodos offline.', error)
    }
    snapshot = createSnapshot(periods)
    return periods
}

function setPeriods(nextPeriods: OfflinePeriod[]): void {
    load()
    if (haveSamePeriods(periods, nextPeriods)) {
        return
    }

    periods = nextPeriods
    snapshot = createSnapshot(periods)
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(periods))
    } catch (error) {
        console.error('Falha ao gravar períodos offline.', error)
    }
    for (const listener of listeners) {
        listener()
    }
}

export function getOfflinePeriods(): OfflinePeriod[] {
    return createSnapshot(load()).map((period) => ({ ...period }))
}

export function getOfflinePeriodSnapshot(): readonly OfflinePeriod[] {
    load()
    return snapshot
}

export function getTotalOfflineTimeMs(): number {
    return load().reduce((sum, p) => sum + (p.durationMs ?? 0), 0)
}

export function getOfflineCount(): number {
    return load().length
}

export function clearOfflinePeriods(): void {
    setPeriods([])
}

export function subscribeOfflinePeriods(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

/**
 * Inicia o rastreamento de períodos de conexão offline.
 * Deve ser chamado quando o PDV está ativo para uma unidade.
 * Retorna uma funcao de encerramento (teardown).
 */
export function startOfflinePeriodTracking(): () => void {
    if (typeof window === 'undefined') {
        return () => undefined
    }

    // Se ja estava offline ao iniciar, considera o periodo como iniciado agora
    // (nao sabemos o momento exato da queda anterior).
    if (!navigator.onLine) {
        offlineStartedAt = Date.now()
    }

    function handleStatusChange(): void {
        const now = Date.now()
        if (!navigator.onLine && offlineStartedAt === null) {
            offlineStartedAt = now
        } else if (navigator.onLine && offlineStartedAt !== null) {
            const endedAt = now
            const durationMs = endedAt - offlineStartedAt
            setPeriods([...load(), {
                id: crypto.randomUUID(),
                startedAt: offlineStartedAt,
                endedAt,
                durationMs,
            }])
            offlineStartedAt = null
        }
    }

    const unsubscribe = subscribeConnection(handleStatusChange)

    // Também escuta eventos nativos do navegador como redundância
    window.addEventListener('online', handleStatusChange)
    window.addEventListener('offline', handleStatusChange)

    return () => {
        unsubscribe()
        window.removeEventListener('online', handleStatusChange)
        window.removeEventListener('offline', handleStatusChange)
        // Se encerrar o rastreamento enquanto ainda offline, fecha o período aberto
        if (offlineStartedAt !== null) {
            const endedAt = Date.now()
            setPeriods([...load(), {
                id: crypto.randomUUID(),
                startedAt: offlineStartedAt,
                endedAt,
                durationMs: endedAt - offlineStartedAt,
            }])
            offlineStartedAt = null
        }
    }
}
