const CACHE = 'music-shell-v35';
const OFFLINE_HTML = './index.html?v=23';
const APP_JS = './app.js?v=16';
const META_JS = './metadata.js?v=1';
const PLAYER_UI_JS = './player-ui.js?v=6';
const PLAYLIST_JS = './playlist-enhancements.js?v=3';
const STYLES = './styles.css?v=18';
const SHELL = [OFFLINE_HTML, STYLES, APP_JS, META_JS, PLAYER_UI_JS, PLAYLIST_JS, './manifest.json'];

const DB_HELPERS_OLD = `  function tx(store, mode = 'readonly') {
    return db.transaction(store, mode).objectStore(store);
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetAll(store) { return reqP(tx(store).getAll()); }
  async function dbGet(store, key) { return reqP(tx(store).get(key)); }
  async function dbPut(store, value) { return reqP(tx(store, 'readwrite').put(value)); }
  async function dbDelete(store, key) { return reqP(tx(store, 'readwrite').delete(key)); }`;

const DB_HELPERS_NEW = `  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function isRecoverableDbError(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || '');
    return (
      name === 'InvalidStateError' && /connection is (closing|closed)|database connection is (closing|closed)/i.test(message)
    ) || (
      name === 'UnknownError' && /indexed database server|connection to indexed database server lost/i.test(message)
    );
  }

  async function reopenDb() {
    try { db?.close(); } catch {}
    db = null;
    await new Promise(resolve => setTimeout(resolve, 0));
    db = await openDb();
    return db;
  }

  async function dbRequest(store, mode, makeRequest) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!db) db = await openDb();
        const objectStore = db.transaction(store, mode).objectStore(store);
        return await reqP(makeRequest(objectStore));
      } catch (error) {
        if (attempt === 0 && isRecoverableDbError(error)) {
          await reopenDb();
          continue;
        }
        throw error;
      }
    }
  }

  async function dbGetAll(store) { return dbRequest(store, 'readonly', objectStore => objectStore.getAll()); }
  async function dbGet(store, key) { return dbRequest(store, 'readonly', objectStore => objectStore.get(key)); }
  async function dbPut(store, value) { return dbRequest(store, 'readwrite', objectStore => objectStore.put(value)); }
  async function dbDelete(store, key) { return dbRequest(store, 'readwrite', objectStore => objectStore.delete(key)); }`;

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

  // iOS/WebKit can close an IndexedDB connection while a Home Screen app is
  // suspended. Patch only the four DB helper functions so a failed operation
  // reopens music-pwa-db v1 and retries once in place. No storage is cleared.
  if (url.pathname.endsWith('/app.js')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const appResponse = await cache.match(APP_JS);
      if (!appResponse) return fetch(req);
      const appCode = await appResponse.text();
      if (!appCode.includes(DB_HELPERS_OLD)) {
        console.error('MUSIC DB reconnect patch did not match app.js; serving original source.');
        return new Response(appCode, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        });
      }
      const patchedCode = appCode.replace(DB_HELPERS_OLD, DB_HELPERS_NEW);
      return new Response(patchedCode, {
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