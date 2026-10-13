const CACHE = 'music-shell-v34';
const OFFLINE_HTML = './index.html?v=23';
const APP_JS = './app.js?v=16';
const DB_RESILIENCE_JS = './db-resilience.js?v=1';
const META_JS = './metadata.js?v=1';
const PLAYER_UI_JS = './player-ui.js?v=6';
const PLAYLIST_JS = './playlist-enhancements.js?v=3';
const STYLES = './styles.css?v=18';
const SHELL = [OFFLINE_HTML, STYLES, APP_JS, DB_RESILIENCE_JS, META_JS, PLAYER_UI_JS, PLAYLIST_JS, './manifest.json'];

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

  // Always run the IndexedDB recovery guard before the app code. This keeps
  // the existing app source untouched while allowing iOS/WebKit stale DB
  // connections to recover with a one-time page reload.
  if (url.pathname.endsWith('/app.js')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const [guardResponse, appResponse] = await Promise.all([
        cache.match(DB_RESILIENCE_JS),
        cache.match(APP_JS)
      ]);
      if (!guardResponse || !appResponse) return fetch(req);
      const [guardCode, appCode] = await Promise.all([
        guardResponse.text(),
        appResponse.text()
      ]);
      return new Response(`${guardCode}\n${appCode}`, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    })());
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
      if (url.pathname.endsWith('/metadata.js')) return caches.match(META_JS);
      if (url.pathname.endsWith('/styles.css')) return caches.match(STYLES);
      return caches.match(req);
    })
  );
});