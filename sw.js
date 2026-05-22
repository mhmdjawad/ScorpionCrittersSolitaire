/* Minimal service worker.
 * This worker does not cache assets; it just activates immediately so old
 * registrations can be replaced cleanly.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Intentionally pass through to the network.
});
