const SW_URL = new URL(self.location.href);
const BUILD_VERSION = SW_URL.searchParams.get('build') || 'dev';
const CACHE_PREFIX = 'scorpion-critters-';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_VERSION}`;
const APP_ASSETS = [
  './',
  './index.html',
  `./index.css?v=${BUILD_VERSION}`,
  `./index.js?v=${BUILD_VERSION}`,
  './README.md',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});
