import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthenticatedUser } from '../src/services/auth.ts'
import {
    cacheOfflineAuthenticatedUser,
    getOfflineAuthenticatedUser,
    restoreOfflineAuthenticatedUser,
    shouldResetOfflineCashRegisterSession,
} from '../src/services/offlineAuthSession.ts'
import { getConnectionState, reportNetworkSuccess } from '../src/services/connection.ts'

const PROFILE_CACHE_KEY = 'pdv_offline_authenticated_profile_v1_session-network-error'

function installStorage(tabId: string) {
    const localValues = new Map<string, string>()
    const sessionValues = new Map<string, string>([['pdv_offline_auth_session_v1', tabId]])
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            localStorage: {
                getItem(key: string) {
                    return localValues.get(key) ?? null
                },
                setItem(key: string, value: string) {
                    localValues.set(key, value)
                },
            },
            sessionStorage: {
                getItem(key: string) {
                    return sessionValues.get(key) ?? null
                },
                setItem(key: string, value: string) {
                    sessionValues.set(key, value)
                },
                removeItem(key: string) {
                    sessionValues.delete(key)
                },
                key(index: number) {
                    return [...sessionValues.keys()][index] ?? null
                },
                get length() {
                    return sessionValues.size
                },
            },
            addEventListener() {},
        },
    })
    return { localValues, sessionValues }
}

function createSession(userId: string, sessionId: string, expiresAt = Math.floor(Date.now() / 1000) + 3600) {
    const payload = Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')
    return {
        access_token: `header.${payload}.signature`,
        expires_at: expiresAt,
        user: { id: userId },
    }
}

function createUser(userId: string, bakeryId: string): AuthenticatedUser {
    return {
        id: userId,
        name: 'Operador',
        email: 'operador@example.test',
        role: 'cashier',
        bakeryIds: [bakeryId],
        activeBakeryId: bakeryId,
    }
}

function seedOfflineCashAndCatalog(
    localValues: Map<string, string>,
    sessionValues: Map<string, string>,
    userId: string,
    bakeryId: string,
    registerId: string,
    includeCatalog = true,
) {
    const tabId = sessionValues.get('pdv_offline_auth_session_v1')
    assert.ok(tabId)
    const register = {
        id: registerId,
        bakeryId,
        openedAt: new Date().toISOString(),
        initialAmount: 100,
        operatorName: 'Operador',
    }
    sessionValues.set(
        `pdv_offline_confirmed_cash_register_v1_${bakeryId}_${userId}`,
        JSON.stringify({
            version: 1,
            bakeryId,
            userId,
            sessionId: tabId,
            confirmedAt: Date.now(),
            register,
        }),
    )
    if (includeCatalog) {
        localValues.set(
            `pdv_offline_products_v1_${bakeryId}`,
            JSON.stringify({
                version: 1,
                bakeryId,
                cachedAt: Date.now(),
                products: [{
                    id: `product-${bakeryId}`,
                    bakeryId,
                    name: 'Pão',
                    barcode: '789',
                    price: 2,
                    stock: 5,
                }],
                appliedSaleIds: [],
            }),
        )
    }
}

test('restores a prior cashier session offline only with its valid register and cached catalog', () => {
    const userId = 'cashier-offline-reload'
    const bakeryId = 'bakery-offline-reload'
    const session = createSession(userId, 'session-offline-reload')
    const { localValues, sessionValues } = installStorage('tab-offline-reload')
    seedOfflineCashAndCatalog(localValues, sessionValues, userId, bakeryId, 'register-offline-reload')

    const profile = createUser(userId, bakeryId)
    assert.equal(cacheOfflineAuthenticatedUser(profile, session), true)

    const restored = restoreOfflineAuthenticatedUser(session, new TypeError('Failed to fetch'))

    assert.deepEqual(restored, profile)
    assert.equal(getConnectionState().status, 'offline')
})

test('preserves the same offline session and cash confirmation across consecutive reloads', () => {
    const userId = 'cashier-repeated-reload'
    const bakeryId = 'bakery-repeated-reload'
    const session = createSession(userId, 'session-repeated-reload')
    const { localValues, sessionValues } = installStorage('tab-repeated-reload')
    seedOfflineCashAndCatalog(localValues, sessionValues, userId, bakeryId, 'register-repeated-reload')

    const profile = createUser(userId, bakeryId)
    assert.equal(cacheOfflineAuthenticatedUser(profile, session), true)

    for (let reload = 0; reload < 5; reload += 1) {
        assert.equal(shouldResetOfflineCashRegisterSession('SIGNED_IN', session), false)
        assert.deepEqual(
            restoreOfflineAuthenticatedUser(session, new TypeError('Failed to fetch')),
            profile,
        )
        assert.ok(sessionValues.has(`pdv_offline_confirmed_cash_register_v1_${bakeryId}_${userId}`))
        assert.ok(sessionValues.has('pdv_offline_auth_session_v1'))
    }

    assert.equal(
        shouldResetOfflineCashRegisterSession('SIGNED_IN', createSession(userId, 'new-auth-session')),
        true,
    )
    assert.equal(shouldResetOfflineCashRegisterSession('SIGNED_OUT', null), true)
})

test('does not restore when session identity, expiry, register, or catalog is invalid or absent', () => {
    const userId = 'cashier-invalid-session'
    const bakeryId = 'bakery-invalid-session'
    const session = createSession(userId, 'session-valid')
    const { localValues, sessionValues } = installStorage('tab-invalid-session')
    const profile = createUser(userId, bakeryId)

    assert.equal(cacheOfflineAuthenticatedUser(profile, session), true)
    assert.equal(getOfflineAuthenticatedUser(createSession(userId, 'different-session')), null)
    assert.equal(getOfflineAuthenticatedUser(createSession(userId, 'session-valid', Math.floor(Date.now() / 1000) - 1)), null)
    assert.equal(getOfflineAuthenticatedUser(session), null)

    seedOfflineCashAndCatalog(localValues, sessionValues, userId, bakeryId, 'register-invalid-session', false)
    assert.equal(getOfflineAuthenticatedUser(session), null)

    seedOfflineCashAndCatalog(localValues, sessionValues, userId, bakeryId, 'register-invalid-session')
    assert.deepEqual(getOfflineAuthenticatedUser(session), profile)
})

test('does not use the offline profile for non-network errors or for a user without a prior profile cache', () => {
    const userId = 'cashier-network-error'
    const bakeryId = 'bakery-network-error'
    const session = createSession(userId, 'session-network-error')
    const { localValues, sessionValues } = installStorage('tab-network-error')
    seedOfflineCashAndCatalog(localValues, sessionValues, userId, bakeryId, 'register-network-error')
    const profile = createUser(userId, bakeryId)
    assert.equal(cacheOfflineAuthenticatedUser(profile, session), true)

    reportNetworkSuccess()
    assert.equal(restoreOfflineAuthenticatedUser(session, new Error('permission denied')), null)
    assert.equal(getConnectionState().status, 'online')
    assert.equal(restoreOfflineAuthenticatedUser(createSession('new-user', 'new-session'), new TypeError('Failed to fetch')), null)
    assert.equal(localValues.has(PROFILE_CACHE_KEY), true)
})

test('never caches an owner as an offline cashier session', () => {
    installStorage('tab-owner')
    const owner: AuthenticatedUser = {
        id: 'owner-user',
        name: 'Proprietário',
        email: 'owner@example.test',
        role: 'owner',
        bakeryIds: [],
        activeBakeryId: null,
    }

    assert.equal(cacheOfflineAuthenticatedUser(owner, createSession(owner.id, 'owner-session')), false)
})
