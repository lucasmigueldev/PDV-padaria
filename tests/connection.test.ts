import assert from 'node:assert/strict'
import test from 'node:test'
import { isNetworkError } from '../src/services/connection.ts'

type Listener = () => void

test('network classification recognizes fetch failures without classifying arbitrary TypeErrors', () => {
    assert.equal(isNetworkError(new TypeError('Failed to fetch')), true)
    assert.equal(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.')), true)
    assert.equal(isNetworkError(new TypeError('Invalid response data')), false)
    assert.equal(isNetworkError({ code: '42501', message: 'permission denied' }), false)
})

test('a pending connectivity ping cannot overwrite a later offline event', async () => {
    let resolvePing: ((response: { ok: boolean; status: number }) => void) | undefined
    const listeners = new Map<string, Listener>()
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { onLine: true },
    })
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: () => new Promise((resolve) => {
            resolvePing = resolve
        }),
    })
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            addEventListener(type: string, listener: Listener) {
                listeners.set(type, listener)
            },
            removeEventListener(type: string) {
                listeners.delete(type)
            },
            setInterval() {
                return 1
            },
            clearInterval() {},
            setTimeout() {
                return 1
            },
            clearTimeout() {},
        },
    })

    const connection = await import('../src/services/connection.ts?stale-ping-test')
    const stopMonitor = connection.startConnectionMonitor()
    listeners.get('offline')?.()
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { onLine: false },
    })
    resolvePing?.({ ok: true, status: 200 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(connection.getConnectionState().status, 'offline')
    stopMonitor()
})
