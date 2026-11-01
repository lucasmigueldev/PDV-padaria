import assert from 'node:assert/strict'
import test from 'node:test'

import { registerAppServiceWorker } from '../src/services/serviceWorkerRegistration.ts'

test('registers the development worker only in development mode', async () => {
    const calls: Array<{ scriptURL: string; options?: RegistrationOptions }> = []
    const registration = {} as ServiceWorkerRegistration
    const serviceWorker = {
        register: async (scriptURL: string, options?: RegistrationOptions) => {
            calls.push({ scriptURL, options })
            return registration
        },
    }

    assert.equal(
        await registerAppServiceWorker({ DEV: true, PROD: false }, serviceWorker),
        registration,
    )
    assert.deepEqual(calls, [{
        scriptURL: '/sw-dev.js',
        options: { scope: '/', updateViaCache: 'none' },
    }])

    assert.equal(registerAppServiceWorker({ DEV: false, PROD: false }, serviceWorker), null)
    assert.equal(calls.length, 1)
})

test('switches the same root-scope registration between production and development workers', async () => {
    const registrations: Array<{ scriptURL: string; options?: RegistrationOptions }> = []
    const serviceWorker = {
        register: async (scriptURL: string, options?: RegistrationOptions) => {
            registrations.push({ scriptURL, options })
            return {} as ServiceWorkerRegistration
        },
    }

    await registerAppServiceWorker({ DEV: false, PROD: true }, serviceWorker)
    await registerAppServiceWorker({ DEV: true, PROD: false }, serviceWorker)

    assert.deepEqual(registrations, [
        { scriptURL: '/sw.js', options: undefined },
        { scriptURL: '/sw-dev.js', options: { scope: '/', updateViaCache: 'none' } },
    ])
})
