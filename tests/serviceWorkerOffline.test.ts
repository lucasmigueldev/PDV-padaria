import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

test('pre-caches all Vite build assets and serves the cached SPA shell for offline reloads', async () => {
    const serviceWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
    const listeners = new Map<string, (event: Record<string, unknown>) => void>()
    const cachedAssets: string[][] = []
    const deletedCaches: string[] = []
    const cacheNames = ['padaria-pdv-v2', 'unrelated-cache']
    let offline = false
    const shellResponse = { source: 'cached-index' }
    let activeCacheName = ''

    const self = {
        location: { origin: 'https://pdv.example' },
        clients: { claim: async () => undefined },
        skipWaiting: async () => undefined,
        addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
            listeners.set(type, listener)
        },
    }
    const cache = {
        addAll: async (assets: string[]) => {
            cachedAssets.push(assets)
        },
        match: async () => shellResponse,
        put: async () => undefined,
    }
    const caches = {
        open: async (name: string) => {
            activeCacheName = name
            return cache
        },
        match: async () => shellResponse,
        keys: async () => cacheNames,
        delete: async (name: string) => {
            deletedCaches.push(name)
            return true
        },
    }
    const fetch = async (input: string | Request) => {
        if (offline) throw new TypeError('Failed to fetch')
        if (String(input).includes('.vite/manifest.json')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    'src/main.tsx': {
                        file: 'assets/index-abc123.js',
                        css: ['assets/index-def456.css'],
                        assets: ['assets/logo-ghi789.svg'],
                    },
                    'src/chunk.ts': { file: 'assets/chunk-jkl012.js' },
                }),
            }
        }
        return { status: 200, type: 'basic', clone: () => ({}) }
    }

    runInNewContext(serviceWorker, { self, caches, fetch, URL, Promise, Set })

    let installPromise: Promise<void> | undefined
    listeners.get('install')?.({
        waitUntil(promise: Promise<void>) {
            installPromise = promise
        },
    })
    await installPromise
    let activatePromise: Promise<void> | undefined
    listeners.get('activate')?.({
        waitUntil(promise: Promise<void>) {
            activatePromise = promise
        },
    })
    await activatePromise
    assert.deepEqual(deletedCaches, ['padaria-pdv-v2'])

    for (const asset of [
        '/index.html',
        '/assets/index-abc123.js',
        '/assets/index-def456.css',
        '/assets/logo-ghi789.svg',
        '/assets/chunk-jkl012.js',
    ]) {
        assert.ok(cachedAssets[0]?.includes(asset), `expected ${asset} in the install cache`)
    }

    offline = true
    let navigationResponse: unknown
    listeners.get('fetch')?.({
        request: {
            method: 'GET',
            mode: 'navigate',
            url: 'https://pdv.example/pdv',
        },
        respondWith(promise: Promise<unknown>) {
            navigationResponse = promise
        },
    })
    assert.equal(await navigationResponse, shellResponse)
    assert.equal(activeCacheName, 'padaria-pdv-v3')
})
