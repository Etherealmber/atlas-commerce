/* Atlas Commerce — offline shell, API cache, background sync
 * v6: never cache HTML as an API response (fixes persistent "HTML instead of JSON")
 */
const CACHE_SHELL = 'atlas-shell-v7';
const CACHE_API = 'atlas-api-v7';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/logo.svg', '/logo-mark.svg'];
const OUTBOX_TAG = 'atlas-outbox-sync';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![CACHE_SHELL, CACHE_API].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isApiGet(url) {
  return (
    url.origin === self.location.origin &&
    url.pathname.startsWith('/api/') &&
    !url.pathname.includes('/auth/')
  );
}

function isJsonResponse(res) {
  if (!res || !res.ok) return false;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  return ct.includes('application/json');
}

/** Safe cache put — always clone before consuming body */
async function putCache(cacheName, request, response) {
  if (!response || !response.ok) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch {
    /* opaque / no-store / already used — ignore */
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // ── API GETs: network-first, only cache real JSON, never HTML ──
  if (isApiGet(url)) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Critical: do NOT cache SPA HTML that was wrongly returned for /api/*
          if (isJsonResponse(res)) {
            await putCache(CACHE_API, req, res);
            return res;
          }
          // HTML or other non-JSON with 200 → treat as Worker routing failure
          const text = await res.clone().text().catch(() => '');
          if (/<!DOCTYPE|<html/i.test(text)) {
            return new Response(
              JSON.stringify({
                success: false,
                error:
                  "L'API a renvoyé une page HTML au lieu de JSON (route Worker manquante ou timeout). Rechargez après déploiement.",
                code: 'API_RETURNED_HTML',
              }),
              { status: 502, headers: { 'Content-Type': 'application/json' } }
            );
          }
          // Non-JSON but not HTML — pass through without caching
          return res;
        } catch {
          // Offline: only return a previously cached *JSON* response
          const hit = await caches.match(req);
          if (hit && isJsonResponse(hit)) return hit;
          return new Response(
            JSON.stringify({ success: false, error: 'Hors ligne', offline: true, code: 'OFFLINE' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        }
      })()
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Static assets: cache-first, revalidate in background
  if (url.pathname.startsWith('/assets/') || /\.(js|css|svg|png|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        const netPromise = fetch(req)
          .then(async (res) => {
            if (res.ok) await putCache(CACHE_SHELL, req, res);
            return res;
          })
          .catch(() => null);
        if (hit) {
          netPromise.catch(() => {});
          return hit;
        }
        const net = await netPromise;
        return net || new Response('', { status: 504 });
      })()
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            await putCache(CACHE_SHELL, '/', res);
            return res;
          }
          const hit = (await caches.match('/')) || (await caches.match('/index.html'));
          return hit || res;
        } catch {
          return (
            (await caches.match('/')) ||
            (await caches.match('/index.html')) ||
            new Response('Offline', { status: 503 })
          );
        }
      })()
    );
  }
});

async function notifyClientsFlush() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    try {
      client.postMessage({ type: 'FLUSH_OUTBOX' });
    } catch {
      /* */
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === OUTBOX_TAG || event.tag === 'atlas-outbox-sync') {
    event.waitUntil(notifyClientsFlush());
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'REQUEST_SYNC') {
    event.waitUntil(notifyClientsFlush());
  }
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
