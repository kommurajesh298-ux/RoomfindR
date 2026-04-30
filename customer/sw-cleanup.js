// sw-cleanup.js
// This script is imported by the service worker to clear specific caches on activation

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName === 'supabase-cache') {
                        return caches.delete(cacheName);
                    }
                    return undefined;
                })
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});
