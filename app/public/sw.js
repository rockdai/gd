// Service Worker for PWA offline support
const CACHE_NAME = 'gd-whitelist-v1';
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

  // For static assets, try cache first, then network
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});
