// Vite exposes this worker at /sw-dev.js only in its development server.
const CACHE_NAME = 'pdv360-vite-dev-v1';
const CACHE_PREFIX = 'pdv360-vite-dev-';
const SHELL_URL = new URL('/index.html', self.location.origin).href;
const STATIC_PATHS = new Set([
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons.svg',
  '/pwa-192x192.svg',
  '/pwa-512x512.svg'
]);

function isExcludedApiPath(pathname) {
  return /^\/(?:api|auth|functions|graphql|rest|rpc|storage)(?:\/|$)/i.test(pathname);
}

function isCacheableResource(input) {
  const url = new URL(typeof input === 'string' ? input : input.url, self.location.origin);
  if (url.origin !== self.location.origin || isExcludedApiPath(url.pathname)) {
    return false;
  }

  return STATIC_PATHS.has(url.pathname)
    || url.pathname === '/@vite/client'
    || url.pathname === '/@react-refresh'
    || url.pathname.startsWith('/@id/')
    || url.pathname.startsWith('/@fs/')
    || url.pathname.startsWith('/node_modules/')
    || url.pathname.startsWith('/src/')
    || url.pathname.startsWith('/assets/')
    || /\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?|ttf|otf)$/i.test(url.pathname);
}

function cacheKey(input) {
  const url = new URL(typeof input === 'string' ? input : input.url, self.location.origin);
  url.searchParams.delete('t');
  url.searchParams.sort();
  return url.href;
}

async function storeResponse(key, response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(key, response.clone());
  } catch (error) {
    console.warn('Não foi possível atualizar o cache offline de desenvolvimento.', error);
  }
}

async function fetchAndCache(request, isNavigation = false) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const contentType = response.headers?.get('content-type') || '';
      if (!isNavigation || contentType.includes('text/html')) {
        await storeResponse(isNavigation ? SHELL_URL : cacheKey(request), response);
      }
    }
    return response;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const fallback = isNavigation
      ? await cache.match(SHELL_URL)
      : await cache.match(cacheKey(request));

    if (fallback) return fallback;
    throw error;
  }
}

async function warmResources(source, resourceUrls) {
  let probe;
  try {
    probe = await fetch(new URL('/@vite/client', self.location.origin).href, {
      cache: 'no-store'
    });
  } catch (error) {
    console.debug('Cache de desenvolvimento mantido: servidor Vite indisponível.', error);
    return;
  }

  if (!probe.ok || probe.type !== 'basic') return;
  await storeResponse(cacheKey(new URL('/@vite/client', self.location.origin).href), probe);

  const urls = new Set();
  for (const resourceUrl of resourceUrls) {
    if (typeof resourceUrl === 'string' && isCacheableResource(resourceUrl)) {
      urls.add(new URL(resourceUrl).href);
    }
  }

  if (source && source.url && new URL(source.url).origin === self.location.origin) {
    try {
      const pageResponse = await fetch(source.url, {
        cache: 'no-store',
        headers: { Accept: 'text/html' }
      });
      if (pageResponse.ok && pageResponse.type === 'basic'
        && (pageResponse.headers?.get('content-type') || '').includes('text/html')) {
        await storeResponse(SHELL_URL, pageResponse);
      }
    } catch (error) {
      console.warn('Não foi possível preparar o shell offline do PDV.', error);
    }
  }

  await Promise.all([...urls].map(async (url) => {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok && response.type === 'basic') {
        await storeResponse(cacheKey(url), response);
      }
    } catch (error) {
      console.warn('Não foi possível preparar um recurso do PDV para uso offline.', {
        url,
        error
      });
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'PDV360_DEV_WARM_RESOURCES') return;
  const resourceUrls = Array.isArray(event.data.resourceUrls) ? event.data.resourceUrls : [];
  event.waitUntil(warmResources(event.source, resourceUrls));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isExcludedApiPath(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetchAndCache(request, true));
    return;
  }

  if (!isCacheableResource(request)) return;
  event.respondWith(fetchAndCache(request));
});
