import { getEnv } from '../lib/env'

export type ConnectionStatus = 'online' | 'offline'

export interface ConnectionState {
    status: ConnectionStatus
    lastConfirmedAt: number | null
}

const env = getEnv()

const state: ConnectionState = {
    status: (typeof navigator !== 'undefined' && navigator.onLine) ? 'online' : 'offline',
    lastConfirmedAt: null,
}

const listeners = new Set<() => void>()

export function getConnectionState(): ConnectionState {
    return state
}

function emit(): void {
    for (const listener of listeners) {
        listener()
    }
}

function setState(next: Partial<ConnectionState>): void {
    const updated = { ...state, ...next }
    if (updated.status === state.status && updated.lastConfirmedAt === state.lastConfirmedAt) {
        return
    }
    state.status = updated.status
    state.lastConfirmedAt = updated.lastConfirmedAt
    emit()
}

export function subscribeConnection(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

/** Network failure (fetch aborted / offline / service unreachable) */
export function reportNetworkFailure(): void {
    setState({ status: 'offline' })
}

/** Server confirmed it is alive (heartbeat / RPC / ping) */
export function reportNetworkSuccess(): void {
    setState({ status: 'online', lastConfirmedAt: Date.now() })
}

/**
 * Detects network failures across the codebase.
 * Works for thrown `TypeError` (fetch aborts), plain `Error` messages,
 * `SupabaseError` objects returned by `PostgrestBuilder`, and `Error`
 * objects whose `cause` is a network failure.
 */
export function isNetworkError(error: unknown): boolean {
    if (error instanceof TypeError) {
        return true
    }
    if (error instanceof Error) {
        const message = error.message ?? ''
        if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
            return true
        }
        if (error.cause !== undefined) {
            return isNetworkError(error.cause)
        }
        return false
    }
    if (typeof error === 'object' && error !== null) {
        const candidate = error as Record<string, unknown>
        const message = typeof candidate.message === 'string' ? candidate.message : ''
        if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
            return true
        }
        return false
    }
    return false
}

const pingPath = '/auth/v1/health'
const pingTimeoutMs = 3000
const pingIntervalMs = 30000

let pingTimer: number | null = null

function getSupabaseUrl(): string | null {
    if (typeof window === 'undefined') {
        return null
    }
    const url = env.VITE_SUPABASE_URL?.trim()
    return url || null
}

/** Returns true when a network request reaches the Supabase API (any HTTP response). */
async function pingSupabase(): Promise<boolean> {
    const baseUrl = getSupabaseUrl()
    if (!baseUrl) {
        return false
    }
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), pingTimeoutMs)
    try {
        const response = await fetch(`${baseUrl}${pingPath}`, {
            method: 'GET',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        })
        // Any HTTP response (even 401/404) proves the server is reachable.
        return response.ok || response.status === 401 || response.status === 404
    } catch {
        return false
    } finally {
        window.clearTimeout(timeoutId)
    }
}

function handleOnline(): void {
    void runConnectivityCheck()
}

function handleOffline(): void {
    setState({ status: 'offline' })
}

async function runConnectivityCheck(): Promise<void> {
    const reachable = await pingSupabase()
    if (reachable) {
        reportNetworkSuccess()
    } else {
        reportNetworkFailure()
    }
}

/**
 * Starts the long-lived connectivity monitor.
 * Used at app startup; the returned teardown is kept by the mounting effect.
 */
export function startConnectionMonitor(): () => void {
    if (typeof window === 'undefined') {
        return () => undefined
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    pingTimer = window.setInterval(() => {
        void runConnectivityCheck()
    }, pingIntervalMs)
    void runConnectivityCheck()
    return () => {
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
        if (pingTimer !== null) {
            window.clearInterval(pingTimer)
            pingTimer = null
        }
    }
}
