const CACHE_NAME = 'padaria-pdv-v3';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/pwa-192x192.svg',
  '/pwa-512x512.svg'
];

async function getBuiltAssets() {
  const response = await fetch('/.vite/manifest.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not load Vite asset manifest (${response.status}).`);
  }

  const manifest = await response.json();
  const assets = Object.values(manifest).flatMap((entry) => [
    entry.file,
    ...(entry.css || []),
    ...(entry.assets || [])
  ]);
  return [...new Set(assets.filter(Boolean).map((asset) => `/${asset.replace(/^\/+/, '')}`))];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll([...STATIC_ASSETS, ...await getBuiltAssets()]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key.startsWith('padaria-pdv-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/rest/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const response = await fetch(request);
          if (response.ok && response.type === 'basic') {
            await cache.put('/index.html', response.clone());
          }
          return response;
        } catch (error) {
          const fallback = await cache.match('/index.html', { ignoreSearch: true, ignoreVary: true })
            || await cache.match('/', { ignoreSearch: true, ignoreVary: true });
          if (fallback) return fallback;

          console.error('Navegação offline sem shell em cache.', error);
          return new Response('Aplicação indisponível offline. Conecte-se e recarregue para preparar o cache.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        }
      })()
    );
    return;
  }

  if (!url.pathname.startsWith('/assets/') && !STATIC_ASSETS.includes(url.pathname)) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      if (cachedResponse) return cachedResponse;

      const networkResponse = await fetch(request);
      if (networkResponse.status === 200 && networkResponse.type === 'basic') {
        await cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
  );
});
