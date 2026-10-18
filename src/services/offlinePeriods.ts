import { subscribeConnection } from './connection'

export type OfflinePeriod = {
    id: string
    startedAt: number
    endedAt: number | null
    durationMs: number | null
}

const STORAGE_KEY = 'pdv_offline_periods_v1'

let periods: OfflinePeriod[] = []
let snapshot: OfflinePeriod[] = []
const listeners = new Set<() => void>()

let offlineStartedAt: number | null = null

function load(): OfflinePeriod[] {
    if (periods.length > 0) {
        return periods
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        periods = raw ? (JSON.parse(raw) as OfflinePeriod[]) : []
    } catch (error) {
        console.error('Falha ao ler períodos offline.', error)
        periods = []
    }
    snapshot = periods.slice()
    return periods
}

function persist(): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(periods))
    } catch (error) {
        console.error('Falha ao gravar períodos offline.', error)
    }
    snapshot = periods.slice()
    for (const listener of listeners) {
        listener()
    }
}

function sortPeriods(list: OfflinePeriod[]): OfflinePeriod[] {
    return [...list].sort((a, b) => b.startedAt - a.startedAt)
}

export function getOfflinePeriods(): OfflinePeriod[] {
    return sortPeriods(load())
}

export function getOfflinePeriodSnapshot(): OfflinePeriod[] {
    return sortPeriods(snapshot)
}

export function getTotalOfflineTimeMs(): number {
    return load().reduce((sum, p) => sum + (p.durationMs ?? 0), 0)
}

export function getOfflineCount(): number {
    return load().length
}

export function clearOfflinePeriods(): void {
    periods = []
    snapshot = []
    persist()
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
            periods.push({
                id: crypto.randomUUID(),
                startedAt: offlineStartedAt,
                endedAt,
                durationMs,
            })
            offlineStartedAt = null
            persist()
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
            periods.push({
                id: crypto.randomUUID(),
                startedAt: offlineStartedAt,
                endedAt,
                durationMs: endedAt - offlineStartedAt,
            })
            offlineStartedAt = null
            persist()
        }
    }
}
