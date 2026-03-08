// ============ VibeSwap Service Worker — Light Node Cache Layer ============
// Caches mesh state and mind data for offline resilience.
// Part of P-046: Vercel Frontend as Mind Network Light Node.

const CACHE_NAME = 'vibeswap-v1';
const JARVIS_API = 'https://jarvis-vibeswap.fly.dev';

// Cache mesh and mind data, serve stale when offline
const CACHEABLE_PATHS = ['/web/mesh', '/web/mind', '/web/health'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept JARVIS API calls for cacheable paths
  if (url.origin === JARVIS_API && CACHEABLE_PATHS.some(p => url.pathname === p)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache fresh response
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Offline — serve cached with stale indicator
          return caches.match(event.request).then(cached => {
            if (cached) return cached;
            return new Response(JSON.stringify({ status: 'offline', cached: true }), {
              headers: { 'Content-Type': 'application/json' },
            });
          });
        })
    );
  }
});
