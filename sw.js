const CACHE_PREFIX = 'music-shell-';
const CACHE = 'music-shell-v77';
const OFFLINE_HTML = './index.html?v=45';
const APP_JS = './app-recovery.js?v=1';
const AUDIO_STORAGE_JS = './audio-storage-recovery.js?v=4';
const PREFETCH_JS = './playback-prefetch.js?v=3';
const META_JS = './metadata.js?v=1';
const PLAYER_UI_JS = './player-ui.js?v=9';
const PLAYLIST_JS = './playlist-enhancements.js?v=7';
const MEDIA_CONTROLS_JS = './media-session-controls.js?v=5';
const MEDIA_CONTROLS_V6_JS = './media-session-controls-v6.js';
const NOW_PLAYING_V3_JS = './now-playing-fullscreen-v3.js';
const STYLES = './styles.css?v=20';
const MANIFEST = './manifest.json?v=2';
const SHELL = [OFFLINE_HTML, STYLES, APP_JS, AUDIO_STORAGE_JS, PREFETCH_JS, META_JS, PLAYER_UI_JS, PLAYLIST_JS, MEDIA_CONTROLS_JS, MEDIA_CONTROLS_V6_JS, NOW_PLAYING_V3_JS, MANIFEST];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function criticalFallback(pathname) {
  if (pathname.endsWith('/app-recovery.js')) return APP_JS;
  if (pathname.endsWith('/audio-storage-recovery.js')) return AUDIO_STORAGE_JS;
  if (pathname.endsWith('/playback-prefetch.js')) return PREFETCH_JS;
  if (pathname.endsWith('/player-ui.js')) return PLAYER_UI_JS;
  if (pathname.endsWith('/playlist-enhancements.js')) return PLAYLIST_JS;
  if (pathname.endsWith('/media-session-controls-v6.js')) return MEDIA_CONTROLS_V6_JS;
  if (pathname.endsWith('/media-session-controls.js')) return MEDIA_CONTROLS_JS;
  if (pathname.endsWith('/now-playing-fullscreen-v3.js')) return NOW_PLAYING_V3_JS;
  return null;
}

async function injectMediaControls(response) {
  if (!response) return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  const text = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  let html = text;
  if (!html.includes('media-session-controls-v6.js')) {
    html = html.replace('</body>', '  <script src="./media-session-controls-v6.js" defer></script>\n</body>');
  }
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await injectMediaControls(await fetch(req));
      } catch {
        return injectMediaControls(await caches.match(OFFLINE_HTML));
      }
    })());
    return;
  }

  const fallback = criticalFallback(url.pathname);
  if (fallback) {
    event.respondWith((async () => {
      const exact = await caches.match(req);
      if (exact) return exact;
      const shellFallback = await caches.match(fallback);
      if (shellFallback) return shellFallback;
      try {
        const response = await fetch(req);
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy));
        return response;
      } catch {
        return caches.match(fallback);
      }
    })());
    return;
  }

  event.respondWith(fetch(req).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(req, copy));
    return response;
  }).catch(async () => {
    if (url.pathname.endsWith('/manifest.json')) return caches.match(MANIFEST);
    if (url.pathname.endsWith('/metadata.js')) return caches.match(META_JS);
    if (url.pathname.endsWith('/styles.css')) return caches.match(STYLES);
    return caches.match(req);
  }));
});
