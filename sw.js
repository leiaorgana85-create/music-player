const CACHE = 'music-shell-v28';
const OFFLINE_HTML = './index.html?v=23';
const APP_JS = './app.js?v=16';
const META_JS = './metadata.js?v=1';
const PLAYER_UI_JS = './player-ui.js?v=3';
const STYLES = './styles.css?v=18';
const SHELL = [OFFLINE_HTML, STYLES, APP_JS, META_JS, PLAYER_UI_JS, './manifest.json'];

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

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_HTML))
    );
    return;
  }

  // The page may still reference an older query-string version. Always serve
  // the newest player UI script from the active shell so iOS cannot retain
  // the old emoji transport controls.
  if (url.pathname.endsWith('/player-ui.js')) {
    event.respondWith(caches.match(PLAYER_UI_JS));
    return;
  }

  event.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(req, copy));
      return res;
    }).catch(async () => {
      if (url.pathname.endsWith('/app.js')) return caches.match(APP_JS);
      if (url.pathname.endsWith('/metadata.js')) return caches.match(META_JS);
      if (url.pathname.endsWith('/styles.css')) return caches.match(STYLES);
      return caches.match(req);
    })
  );
});