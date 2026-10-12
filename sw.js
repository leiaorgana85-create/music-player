const CACHE = 'music-shell-v10';
const SHELL = [
  './', './index.html', './styles.css', './app.js?v=7', './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const cacheKey = req.mode === 'navigate' ? './index.html' : req;

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(cacheKey);

      if (cached) {
        // Return the local shell immediately, then refresh it quietly in the background.
        event.waitUntil(
          fetch(req).then(res => {
            if (res.ok) return cache.put(cacheKey, res.clone());
          }).catch(() => {})
        );
        return cached;
      }

      // First-load fallback when this resource has not been cached yet.
      try {
        const res = await fetch(req);
        if (res.ok) await cache.put(cacheKey, res.clone());
        return res;
      } catch {
        if (req.mode === 'navigate') {
          const offline = await cache.match('./index.html');
          if (offline) return offline;
        }
        throw new Error('Network unavailable and resource is not cached.');
      }
    })
  );
});