const CACHE_NAME = 'petcam-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './camera.html',
    './viewer.html',
    './css/style.css',
    './js/camera.js',
    './js/viewer.js',
    './manifest.json',
    'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
    'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700&display=swap'
];

// Install event - cache assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Cache opened');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    const cacheAllowlist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheAllowlist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
    // For WebRTC & signaling (PeerJS), we explicitly rely on network, so we shouldn't heavily cache API calls.
    // However, for static files, Network First or Stale-While-Revalidate works well.
    // To keep it simple, we do Stale-While-Revalidate for cached assets
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    // Ignore fetch errors (e.g., offline)
                });
                return cachedResponse || fetchPromise;
            })
    );
});
