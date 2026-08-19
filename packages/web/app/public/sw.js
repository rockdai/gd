// Service Worker for PWA offline support
const CACHE_NAME = 'gd-whitelist-v2';
const STATIC_ASSETS = [
  '/',
  '/public/index.html',
  '/public/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // For API requests, always go to network
  if (request.url.includes('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // HTML shell: network first, cache fallback. Cache-first here would pin the
  // installed PWA to a stale page until the user clears site data — config like
  // the IP endpoint is baked into the HTML response, so it must be refreshable.
  if (request.mode === 'navigate' || new URL(request.url).pathname === '/public/index.html') {
    event.respondWith(
      fetch(request)
        .then(resp => {
          // Only cache good responses: a transient 4xx/5xx must not overwrite
          // the last working offline shell.
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return resp;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other static assets: cache first, then network
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});
