const CACHE = 'music-shell-v36';
const OFFLINE_HTML = './index.html?v=24';
const APP_JS = './app.js?v=17';
const META_JS = './metadata.js?v=1';
const PLAYER_UI_JS = './player-ui.js?v=6';
const PLAYLIST_JS = './playlist-enhancements.js?v=4';
const STYLES = './styles.css?v=18';
const SHELL = [OFFLINE_HTML, STYLES, APP_JS, META_JS, PLAYER_UI_JS, PLAYLIST_JS, './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
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
  // the newest UI enhancement scripts from the active shell.
  if (url.pathname.endsWith('/player-ui.js')) {
    event.respondWith(caches.match(PLAYER_UI_JS));
    return;
  }
  if (url.pathname.endsWith('/playlist-enhancements.js')) {
    event.respondWith(caches.match(PLAYLIST_JS));
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