import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

interface MockResponse {
    ok: boolean
    status: number
    type: string
    body: string
    headers: { get(name: string): string }
    clone(): MockResponse
}

function response(body: string, contentType = 'application/javascript'): MockResponse {
    const value: MockResponse = {
        ok: true,
        status: 200,
        type: 'basic',
        body,
        headers: { get: (name) => name === 'content-type' ? contentType : '' },
        clone: () => value,
    }
    return value
}

test('uses network-first caching, timestamp-safe Vite module keys, and an offline SPA shell', async () => {
    const serviceWorker = await readFile(new URL('../dev/sw-dev.js', import.meta.url), 'utf8')
    const listeners = new Map<string, (event: Record<string, unknown>) => void>()
    const entries = new Map<string, MockResponse>()
    const deletedCaches: string[] = []
    const networkBodies = new Map<string, string>()
    const fetches: string[] = []
    let offline = false
    entries.set(
        'https://localhost:5173/src/previously-loaded.ts',
        response('previously loaded'),
    )

    const cache = {
        put: async (key: string, value: MockResponse) => { entries.set(key, value) },
        match: async (key: string) => entries.get(key),
    }
    const caches = {
        open: async () => cache,
        delete: async (key: string) => {
            deletedCaches.push(key)
            if (key === 'pdv360-vite-dev-v1') entries.clear()
            return true
        },
        keys: async () => ['pdv360-vite-dev-v0', 'pdv360-vite-dev-v1', 'padaria-pdv-v3'],
    }
    const self = {
        location: { origin: 'https://localhost:5173' },
        clients: { claim: async () => undefined },
        skipWaiting: async () => undefined,
        addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
            listeners.set(type, listener)
        },
    }
    const fetch = async (input: string | { url: string }) => {
        const url = typeof input === 'string' ? input : input.url
        fetches.push(url)
        if (offline) throw new TypeError('Failed to fetch')
        return response(networkBodies.get(url) || `fresh:${url}`,
            url.endsWith('/pdv') || url.endsWith('/index.html')
                ? 'text/html'
                : 'application/javascript')
    }

    runInNewContext(serviceWorker, { self, caches, fetch, URL, Promise, Set, Map, RegExp })

    let activatePromise: Promise<void> | undefined
    listeners.get('activate')?.({
        waitUntil(promise: Promise<void>) { activatePromise = promise },
    })
    await activatePromise
    assert.deepEqual(deletedCaches, ['pdv360-vite-dev-v0'])
    assert.ok(!deletedCaches.includes('padaria-pdv-v3'))

    const request = (url: string, mode = 'cors') => ({
        method: 'GET',
        mode,
        url: `https://localhost:5173${url}`,
    })
    let moduleResponse: MockResponse | Promise<MockResponse> | undefined
    listeners.get('fetch')?.({
        request: request('/src/pages/PDV.tsx?import'),
        respondWith(value: Promise<MockResponse>) { moduleResponse = value },
    })
    assert.equal((await moduleResponse)?.body, 'fresh:https://localhost:5173/src/pages/PDV.tsx?import')
    assert.ok(entries.has('https://localhost:5173/src/previously-loaded.ts'))

    offline = false
    networkBodies.set(
        'https://localhost:5173/src/pages/PDV.tsx?import',
        'current-version',
    )
    let updatedModuleResponse: MockResponse | Promise<MockResponse> | undefined
    listeners.get('fetch')?.({
        request: request('/src/pages/PDV.tsx?import'),
        respondWith(value: Promise<MockResponse>) { updatedModuleResponse = value },
    })
    assert.equal((await updatedModuleResponse)?.body, 'current-version')

    offline = true
    let timestampedResponse: MockResponse | Promise<MockResponse> | undefined
    listeners.get('fetch')?.({
        request: request('/src/pages/PDV.tsx?import&t=123456'),
        respondWith(value: Promise<MockResponse>) { timestampedResponse = value },
    })
    assert.equal((await timestampedResponse)?.body, 'current-version')

    offline = false
    let navigationResponse: MockResponse | Promise<MockResponse> | undefined
    listeners.get('fetch')?.({
        request: request('/pdv', 'navigate'),
        respondWith(value: Promise<MockResponse>) { navigationResponse = value },
    })
    assert.equal((await navigationResponse)?.body, 'fresh:https://localhost:5173/pdv')

    offline = true
    let offlineNavigation: MockResponse | Promise<MockResponse> | undefined
    listeners.get('fetch')?.({
        request: request('/pdv?reload=1', 'navigate'),
        respondWith(value: Promise<MockResponse>) { offlineNavigation = value },
    })
    assert.equal((await offlineNavigation)?.body, 'fresh:https://localhost:5173/pdv')
    assert.ok(!serviceWorker.includes('/.vite/manifest.json'))
})

test('does not intercept API requests and warms only Vite resources already loaded by the page', async () => {
    const serviceWorker = await readFile(new URL('../dev/sw-dev.js', import.meta.url), 'utf8')
    const listeners = new Map<string, (event: Record<string, unknown>) => void>()
    const entries = new Map<string, MockResponse>()
    const fetched: string[] = []
    const cache = {
        put: async (key: string, value: MockResponse) => { entries.set(key, value) },
        match: async (key: string) => entries.get(key),
    }
    const caches = {
        open: async () => cache,
        delete: async () => true,
        keys: async () => [],
    }
    const self = {
        location: { origin: 'https://localhost:5173' },
        clients: { claim: async () => undefined },
        skipWaiting: async () => undefined,
        addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
            listeners.set(type, listener)
        },
    }
    const fetch = async (input: string) => {
        fetched.push(input)
        return response(`cached:${input}`,
            input.endsWith('/pdv') ? 'text/html' : 'application/javascript')
    }

    runInNewContext(serviceWorker, { self, caches, fetch, URL, Promise, Set, Map, RegExp })

    let apiWasIntercepted = false
    listeners.get('fetch')?.({
        request: { method: 'GET', mode: 'cors', url: 'https://localhost:5173/rest/v1/sales' },
        respondWith() { apiWasIntercepted = true },
    })
    listeners.get('fetch')?.({
        request: { method: 'GET', mode: 'cors', url: 'https://project.supabase.co/rest/v1/sales' },
        respondWith() { apiWasIntercepted = true },
    })
    assert.equal(apiWasIntercepted, false)

    let warmPromise: Promise<void> | undefined
    listeners.get('message')?.({
        data: {
            type: 'PDV360_DEV_WARM_RESOURCES',
            resourceUrls: [
                'https://localhost:5173/@vite/client',
                'https://localhost:5173/@react-refresh',
                'https://localhost:5173/src/pages/PDV.tsx?import',
                'https://localhost:5173/rest/v1/sales',
                'https://project.supabase.co/rest/v1/sales',
            ],
        },
        source: { url: 'https://localhost:5173/pdv' },
        waitUntil(promise: Promise<void>) { warmPromise = promise },
    })
    await warmPromise

    assert.ok(fetched.includes('https://localhost:5173/@vite/client'))
    assert.ok(fetched.includes('https://localhost:5173/@react-refresh'))
    assert.ok(fetched.includes('https://localhost:5173/pdv'))
    assert.ok(fetched.includes('https://localhost:5173/src/pages/PDV.tsx?import'))
    assert.ok(!fetched.some((url) => url.includes('/rest/v1/')))
    assert.ok(entries.has('https://localhost:5173/src/pages/PDV.tsx?import='))
})
