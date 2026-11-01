import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

import type { AuthenticatedUser } from './auth'
import { getCachedProducts, getRememberedOpenCashRegister } from './offlinePdvCache.ts'
import { isNetworkError, reportNetworkFailure } from './connection.ts'

const OFFLINE_PROFILE_CACHE_PREFIX = 'pdv_offline_authenticated_profile_v1_'

type OfflineSession = Pick<Session, 'access_token' | 'expires_at'> & {
    user: Pick<Session['user'], 'id'>
}

type CachedAuthenticatedUser = {
    version: 1
    user: AuthenticatedUser
    sessionId: string
    expiresAt: number
}

function getSessionIdentity(session: OfflineSession): { userId: string; sessionId: string; expiresAt: number } | null {
    const expiresAt = session.expires_at
    if (!session.user?.id || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
        return null
    }

    const expiresAtMs = expiresAt * 1000
    if (expiresAtMs <= Date.now()) {
        return null
    }

    try {
        const payload = session.access_token.split('.')[1]
        if (!payload) return null

        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
        const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as Record<string, unknown>
        if (typeof decoded.session_id !== 'string' || !decoded.session_id) {
            return null
        }

        return {
            userId: session.user.id,
            sessionId: decoded.session_id,
            expiresAt: expiresAtMs,
        }
    } catch {
        return null
    }
}

function isCachedCashier(value: unknown): value is AuthenticatedUser {
    if (typeof value !== 'object' || value === null) return false

    const user = value as Record<string, unknown>
    return typeof user.id === 'string'
        && user.id.length > 0
        && typeof user.name === 'string'
        && typeof user.email === 'string'
        && user.role === 'cashier'
        && Array.isArray(user.bakeryIds)
        && user.bakeryIds.every((id: unknown) => typeof id === 'string')
        && typeof user.activeBakeryId === 'string'
        && user.bakeryIds.includes(user.activeBakeryId)
        && (user.createdAt === undefined || typeof user.createdAt === 'string')
}

export function cacheOfflineAuthenticatedUser(user: AuthenticatedUser, session: OfflineSession): boolean {
    const identity = getSessionIdentity(session)
    if (!identity
        || user.role !== 'cashier'
        || user.id !== identity.userId
        || !user.activeBakeryId
        || !user.bakeryIds.includes(user.activeBakeryId)) {
        return false
    }

    const cached: CachedAuthenticatedUser = {
        version: 1,
        user,
        sessionId: identity.sessionId,
        expiresAt: identity.expiresAt,
    }

    try {
        window.localStorage.setItem(
            `${OFFLINE_PROFILE_CACHE_PREFIX}${identity.sessionId}`,
            JSON.stringify(cached),
        )
        return true
    } catch (error) {
        console.warn('Não foi possível persistir o perfil local do operador.', error)
        return false
    }
}

function getCachedAuthenticatedUser(session: OfflineSession): AuthenticatedUser | null {
    const identity = getSessionIdentity(session)
    if (!identity) return null

    try {
        const raw = window.localStorage.getItem(
            `${OFFLINE_PROFILE_CACHE_PREFIX}${identity.sessionId}`,
        )
        if (!raw) return null

        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null) return null

        const cached = parsed as Partial<CachedAuthenticatedUser>
        if (cached.version !== 1
            || cached.sessionId !== identity.sessionId
            || typeof cached.expiresAt !== 'number'
            || !Number.isFinite(cached.expiresAt)
            || !isCachedCashier(cached.user)
            || cached.user.id !== identity.userId) {
            return null
        }

        return cached.user
    } catch (error) {
        console.warn('Não foi possível recuperar o perfil local do operador.', error)
        return null
    }
}

export function shouldResetOfflineCashRegisterSession(
    event: AuthChangeEvent,
    session: Session | null,
): boolean {
    if (event === 'SIGNED_OUT') return true
    if (event !== 'SIGNED_IN') return false

    // Supabase also emits SIGNED_IN while restoring a persisted session at boot.
    // Keep the tab-scoped register confirmation only for a previously cached session.
    return !session || getCachedAuthenticatedUser(session) === null
}

export function getOfflineAuthenticatedUser(session: OfflineSession): AuthenticatedUser | null {
    const user = getCachedAuthenticatedUser(session)
    if (!user) return null

    const bakeryId = user.activeBakeryId
    if (!bakeryId
        || !getRememberedOpenCashRegister(bakeryId, user.id)
        || getCachedProducts(bakeryId) === null) {
        return null
    }

    return user
}

export function restoreOfflineAuthenticatedUser(
    session: OfflineSession,
    profileError: unknown,
): AuthenticatedUser | null {
    if (!isNetworkError(profileError)) return null

    reportNetworkFailure()
    return getOfflineAuthenticatedUser(session)
}
