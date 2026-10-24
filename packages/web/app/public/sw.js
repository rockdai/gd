// Service Worker for PWA offline support
const CACHE_NAME = 'gd-whitelist-v4';
const STATIC_ASSETS = [
  '/',
  '/public/index.html',
  '/public/manifest.json',
  '/public/icons/favicon-32.png',
  '/public/icons/apple-touch-icon.png',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(
      STATIC_ASSETS.map(path => new Request(path, { cache: 'reload' }))
    ))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('gd-whitelist-') && k !== CACHE_NAME).map(k => caches.delete(k)))
    )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only cache the public shell and its explicit assets. Authenticated APIs,
  // OpenAPI writes and the external public-IP endpoint always use the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin || !STATIC_ASSETS.includes(url.pathname)) return;

  // Show the cached shell immediately while FC wakes up. Revalidate on every
  // visit so a deployment is picked up on the next visit without clearing data.
  // Configuration still comes from the uncached auth bootstrap endpoint.
  const cachePromise = caches.open(CACHE_NAME);
  const cached = cachePromise.then(cache => cache.match(url.pathname)).catch(() => undefined);
  const fresh = fetch(request, { cache: 'no-store' });
  event.waitUntil(
    fresh.then(async response => {
      // Never replace the working offline shell with an error or a redirect.
      if (response.ok && !response.redirected && response.type !== 'opaque') {
        const copy = response.clone();
        const cache = await cachePromise;
        await cache.put(url.pathname, copy);
      }
    }).catch(() => {})
  );

  event.respondWith(
    cached.then(response => response || fresh)
  );
});
