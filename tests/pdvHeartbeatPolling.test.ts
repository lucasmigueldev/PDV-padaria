import assert from 'node:assert/strict'
import test from 'node:test'

import {
    PDV_HEARTBEAT_POLL_INTERVAL_MS,
    startPdvHeartbeatPolling,
} from '../src/services/pdvHeartbeatPolling.ts'

type Listener = () => void

test('automatically polls every 30 seconds while visible without a page reload', () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const windowListeners = new Map<string, Listener>()
    const documentListeners = new Map<string, Listener>()
    let intervalCallback: (() => void) | undefined
    let visibilityState = 'visible'
    let polls = 0
    let clearedIntervalId: number | null = null

    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            setInterval(callback: () => void, delay: number) {
                assert.equal(delay, PDV_HEARTBEAT_POLL_INTERVAL_MS)
                intervalCallback = callback
                return 12
            },
            clearInterval(id: number) {
                clearedIntervalId = id
            },
            addEventListener(type: string, listener: Listener) {
                windowListeners.set(type, listener)
            },
            removeEventListener(type: string) {
                windowListeners.delete(type)
            },
        },
    })
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            get visibilityState() {
                return visibilityState
            },
            addEventListener(type: string, listener: Listener) {
                documentListeners.set(type, listener)
            },
            removeEventListener(type: string) {
                documentListeners.delete(type)
            },
        },
    })

    try {
        const stopPolling = startPdvHeartbeatPolling(() => {
            polls++
        })

        intervalCallback?.()
        assert.equal(polls, 1)

        visibilityState = 'hidden'
        intervalCallback?.()
        assert.equal(polls, 1)

        visibilityState = 'visible'
        documentListeners.get('visibilitychange')?.()
        assert.equal(polls, 2)

        windowListeners.get('online')?.()
        assert.equal(polls, 3)

        stopPolling()
        assert.equal(clearedIntervalId, 12)
        assert.equal(windowListeners.has('online'), false)
        assert.equal(documentListeners.has('visibilitychange'), false)
    } finally {
        if (originalWindow) {
            Object.defineProperty(globalThis, 'window', originalWindow)
        } else {
            Reflect.deleteProperty(globalThis, 'window')
        }
        if (originalDocument) {
            Object.defineProperty(globalThis, 'document', originalDocument)
        } else {
            Reflect.deleteProperty(globalThis, 'document')
        }
    }
})
