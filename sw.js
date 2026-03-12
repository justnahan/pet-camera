const CACHE_NAME = 'petcam-v8';

self.addEventListener('install', event => {
    // Skip waiting so new SW activates immediately
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    // Delete ALL old caches
    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
        ).then(() => self.clients.claim())
    );
});

// NETWORK FIRST — always try network, only use cache if offline
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Cache the latest response
                if (response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request)) // Offline fallback
    );
});
