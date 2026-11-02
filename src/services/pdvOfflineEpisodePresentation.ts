export type PdvOfflineEpisodeStatus = 'open' | 'reconnected' | 'cash_register_closed' | 'session_ended'

export function isCompletedPdvOfflineEpisode(status: PdvOfflineEpisodeStatus): boolean {
    return status === 'reconnected' || status === 'cash_register_closed'
}

export interface PdvOfflineEpisodeTiming {
    estimatedStartedAt: string
    endedAt: string | null
    durationSeconds: number | null
}

export interface OfflineEpisodeSale {
    id: string
    bakeryId: string
    operatorUserId: string
    cashRegisterId: string
    offlineSessionId: string | null
    occurredAt: string
    total: number
    items: OfflineEpisodeSaleItem[]
}

export interface OfflineEpisodeSaleItem {
    name: string
    quantity: number
}

export interface OfflineEpisodeSaleEpisode extends PdvOfflineEpisodeTiming {
    id: string
    bakeryId: string
    operatorUserId: string
    cashRegisterId: string
}

type OfflineSessionKey = string

function getOfflineSessionKey(sale: OfflineEpisodeSale): OfflineSessionKey {
    return JSON.stringify([
        sale.bakeryId,
        sale.operatorUserId,
        sale.cashRegisterId,
        sale.offlineSessionId,
    ])
}

function isWithinEpisode(sale: OfflineEpisodeSale, episode: OfflineEpisodeSaleEpisode): boolean {
    const occurredAt = Date.parse(sale.occurredAt)
    const startedAt = Date.parse(episode.estimatedStartedAt)
    const endedAt = episode.endedAt === null ? Number.NaN : Date.parse(episode.endedAt)
    return Number.isFinite(occurredAt)
        && Number.isFinite(startedAt)
        && Number.isFinite(endedAt)
        && occurredAt >= startedAt
        && occurredAt <= endedAt
}

export function associateOfflineEpisodeSales(
    episodes: readonly OfflineEpisodeSaleEpisode[],
    sales: readonly OfflineEpisodeSale[],
    closedCashRegisterIds: ReadonlySet<string>,
): Map<string, OfflineEpisodeSale[] | null> {
    const result = new Map<string, OfflineEpisodeSale[] | null>(
        episodes.map((episode) => [episode.id, null]),
    )
    const sessionSales = new Map<OfflineSessionKey, OfflineEpisodeSale[]>()

    for (const sale of sales) {
        if (!sale.offlineSessionId) continue
        const key = getOfflineSessionKey(sale)
        const group = sessionSales.get(key) ?? []
        if (!group.some((existing) => existing.id === sale.id)) {
            group.push(sale)
        }
        sessionSales.set(key, group)
    }

    for (const episode of episodes) {
        if (episode.endedAt === null || !closedCashRegisterIds.has(episode.cashRegisterId)) {
            continue
        }
        const unidentifiedSales = sales.some((sale) =>
            sale.offlineSessionId === null
            && sale.bakeryId === episode.bakeryId
            && sale.operatorUserId === episode.operatorUserId
            && sale.cashRegisterId === episode.cashRegisterId
            && isWithinEpisode(sale, episode),
        )
        if (unidentifiedSales) continue

        const relevantGroups = [...sessionSales.values()].filter((group) =>
            group[0].bakeryId === episode.bakeryId
            && group[0].operatorUserId === episode.operatorUserId
            && group[0].cashRegisterId === episode.cashRegisterId
            && group.some((sale) => isWithinEpisode(sale, episode)),
        )
        if (relevantGroups.length === 0) continue

        const associatedGroups = relevantGroups.filter((group) => {
            if (!group.every((sale) => isWithinEpisode(sale, episode))) {
                return false
            }
            const matchingEpisodes = episodes.filter((candidate) =>
                candidate.bakeryId === episode.bakeryId
                && candidate.operatorUserId === episode.operatorUserId
                && candidate.cashRegisterId === episode.cashRegisterId
                && group.every((sale) => isWithinEpisode(sale, candidate)),
            )
            return matchingEpisodes.length === 1 && matchingEpisodes[0].id === episode.id
        })

        if (associatedGroups.length !== relevantGroups.length) continue
        const associatedSales = associatedGroups
            .flat()
            .sort((first, second) => Date.parse(first.occurredAt) - Date.parse(second.occurredAt))
        if (associatedSales.length > 0) {
            result.set(episode.id, associatedSales)
        }
    }

    return result
}

export function getPdvOfflineEpisodeDurationSeconds(
    episode: PdvOfflineEpisodeTiming,
    nowMs: number,
): number | null {
    if (episode.durationSeconds !== null) {
        return Math.max(0, Math.floor(episode.durationSeconds))
    }

    const startedAt = Date.parse(episode.estimatedStartedAt)
    if (!Number.isFinite(startedAt)) return null

    const endedAt = episode.endedAt === null ? nowMs : Date.parse(episode.endedAt)
    if (!Number.isFinite(endedAt)) return null

    return Math.max(0, Math.floor((endedAt - startedAt) / 1000))
}

export function getPdvOfflineEpisodeStatusLabel(status: PdvOfflineEpisodeStatus): string {
    switch (status) {
        case 'open':
            return 'Em andamento'
        case 'reconnected':
            return 'Comunicação retomada'
        case 'cash_register_closed':
            return 'Caixa fechado'
        case 'session_ended':
            return 'Sessão encerrada'
    }
}

function getLocalDateParts(date: string): [number, number, number] | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

    const [year, month, day] = date.split('-').map(Number)
    const validated = new Date(Date.UTC(year, month - 1, day))
    if (validated.getUTCFullYear() !== year
        || validated.getUTCMonth() + 1 !== month
        || validated.getUTCDate() !== day) {
        return null
    }

    return [year, month, day]
}

function getZonedDateTime(
    year: number,
    month: number,
    day: number,
    timeZone: string,
): string {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    })
    const targetAsUtc = Date.UTC(year, month - 1, day)
    let candidate = targetAsUtc

    for (let attempt = 0; attempt < 4; attempt++) {
        const parts = formatter.formatToParts(new Date(candidate))
        const values = new Map(parts.map((part) => [part.type, Number(part.value)]))
        const representedAsUtc = Date.UTC(
            values.get('year') ?? 0,
            (values.get('month') ?? 1) - 1,
            values.get('day') ?? 1,
            values.get('hour') ?? 0,
            values.get('minute') ?? 0,
            values.get('second') ?? 0,
        )
        const adjusted = targetAsUtc - (representedAsUtc - candidate)
        if (adjusted === candidate) break
        candidate = adjusted
    }

    return new Date(candidate).toISOString()
}

export function getPdvOfflineEpisodeSaoPauloDateBounds(date: string): {
    start: string
    end: string
} | null {
    const dateParts = getLocalDateParts(date)
    if (!dateParts) return null
    const [year, month, day] = dateParts
    const nextDate = new Date(Date.UTC(year, month - 1, day + 1))

    return {
        start: getZonedDateTime(year, month, day, 'America/Sao_Paulo'),
        end: getZonedDateTime(
            nextDate.getUTCFullYear(),
            nextDate.getUTCMonth() + 1,
            nextDate.getUTCDate(),
            'America/Sao_Paulo',
        ),
    }
}
