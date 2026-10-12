const CACHE = 'music-shell-v8';
const SHELL = [
  './', './index.html', './styles.css', './app.js?v=6', './manifest.json'
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

  // Prefer fresh app code when online, but fall back to the cached shell offline.
  event.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(req.mode === 'navigate' ? './index.html' : req, copy));
      return res;
    }).catch(async () => {
      if (req.mode === 'navigate') return caches.match('./index.html');
      return (await caches.match(req)) || caches.match(url.pathname.endsWith('/app.js') ? './app.js?v=6' : req);
    })
  );
});