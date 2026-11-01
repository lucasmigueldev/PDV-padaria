import type {
    PdvCashRegisterSessionEnding,
    PdvHeartbeat,
    PdvOpenCashRegister,
} from '../hooks/usePdvHeartbeats'

export interface PossibleOfflineRegister {
    cashRegisterId: string
    bakeryId: string
    operatorUserId: string
    lastSeenAt: string
    elapsedMs: number
}

export interface OpenRegisterWithoutHeartbeat {
    bakeryId: string
    operatorUserId: string
}

export type OpenRegisterMonitoringReason =
    | 'no_matching_heartbeat'
    | 'invalid_heartbeat_timestamp'
    | 'heartbeat_timestamp_in_future'
    | 'recent_heartbeat'
    | 'stale_heartbeat'

export interface OpenRegisterMonitoringDecision {
    reason: OpenRegisterMonitoringReason
    heartbeat: PdvHeartbeat | null
    elapsedMs: number | null
}

export function getOpenRegisterMonitoringDecision(
    register: PdvOpenCashRegister,
    heartbeats: readonly PdvHeartbeat[],
    now: number,
    staleAfterMs: number,
): OpenRegisterMonitoringDecision {
    const heartbeat = heartbeats.find((item) =>
        item.userId === register.operatorUserId && item.bakeryId === register.bakeryId,
    )
    if (!heartbeat) {
        return { reason: 'no_matching_heartbeat', heartbeat: null, elapsedMs: null }
    }

    const lastSeenAt = Date.parse(heartbeat.lastSeenAt)
    if (!Number.isFinite(lastSeenAt)) {
        return { reason: 'invalid_heartbeat_timestamp', heartbeat, elapsedMs: null }
    }

    const elapsedMs = now - lastSeenAt
    if (elapsedMs < 0) {
        return { reason: 'heartbeat_timestamp_in_future', heartbeat, elapsedMs }
    }
    if (elapsedMs <= staleAfterMs) {
        return { reason: 'recent_heartbeat', heartbeat, elapsedMs }
    }

    return { reason: 'stale_heartbeat', heartbeat, elapsedMs }
}

export function getPossibleOfflineRegisters(
    openRegisters: readonly PdvOpenCashRegister[],
    heartbeats: readonly PdvHeartbeat[],
    now: number,
    staleAfterMs: number,
    endedSessions: readonly PdvCashRegisterSessionEnding[] = [],
): PossibleOfflineRegister[] {
    return openRegisters.flatMap((register) => {
        if (endedSessions.some((session) =>
            session.cashRegisterId === register.id
            && session.bakeryId === register.bakeryId
            && session.operatorUserId === register.operatorUserId,
        )) return []

        const decision = getOpenRegisterMonitoringDecision(register, heartbeats, now, staleAfterMs)
        if (decision.reason !== 'stale_heartbeat' || !decision.heartbeat || decision.elapsedMs === null) {
            return []
        }

        return [{
            cashRegisterId: register.id,
            bakeryId: register.bakeryId,
            operatorUserId: register.operatorUserId,
            lastSeenAt: decision.heartbeat.lastSeenAt,
            elapsedMs: decision.elapsedMs,
        }]
    })
}

export function getOpenRegistersWithoutHeartbeat(
    openRegisters: readonly PdvOpenCashRegister[],
    heartbeats: readonly PdvHeartbeat[],
    endedSessions: readonly PdvCashRegisterSessionEnding[] = [],
): OpenRegisterWithoutHeartbeat[] {
    return openRegisters
        .filter((register) => !endedSessions.some((session) =>
            session.cashRegisterId === register.id
            && session.bakeryId === register.bakeryId
            && session.operatorUserId === register.operatorUserId,
        ))
        .filter((register) => !heartbeats.some((heartbeat) =>
            heartbeat.userId === register.operatorUserId && heartbeat.bakeryId === register.bakeryId,
        ))
        .map(({ id, bakeryId, operatorUserId }) => ({
            cashRegisterId: id,
            bakeryId,
            operatorUserId,
        }))
}
