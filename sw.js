/* eslint-env serviceworker */
/**
 * SmileWeb service worker.
 *
 * Strategy summary
 *   app shell      → pre-cached on install, then stale-while-revalidate
 *   joke data      → stale-while-revalidate (instant after the first visit)
 *   face model     → cache-first, forever (it never changes for a given URL)
 *   navigations    → network-first with an offline fallback to the shell
 *
 * The version string is bumped whenever the shell changes; old caches are
 * deleted on activate.
 */
const VERSION = 'smileweb-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const VENDOR_CACHE = `${VERSION}-vendor`;

/** Everything needed to render the app offline. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/camera.js',
  './js/celebration.js',
  './js/constants.js',
  './js/face-model.js',
  './js/jokes.js',
  './js/smile-engine.js',
  './js/stats.js',
  './js/storage.js',
  './js/theme.js',
  './js/ui.js',
  './js/util.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/manifest.webmanifest',
  './data/manifest.json',
];

/** Hosts whose responses are safe to cache aggressively. */
const VENDOR_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'unpkg.com',
  'storage.googleapis.com',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll rejects the whole install if one entry fails, so add individually.
      await Promise.all(
        SHELL_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('smileweb-') && !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.disable();
      }
      await self.clients.claim();
    })(),
  );
});

/** Cache-first: perfect for versioned, immutable assets. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

/** Stale-while-revalidate: serve instantly, refresh in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return hit ?? (await network) ?? Response.error();
}

/** Network-first with a cached fallback — used for HTML navigations. */
async function networkFirst(request, cacheName, fallbackUrl = './index.html') {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    const fallback = await cache.match(fallbackUrl);
    return fallback ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept cross-origin requests we do not know about.
  if (url.origin !== self.location.origin && !VENDOR_HOSTS.has(url.hostname)) return;
  if (VENDOR_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (url.pathname.includes('/data/')) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

/** Let the page ask for an immediate update after a deploy. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
