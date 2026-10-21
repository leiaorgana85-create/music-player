const CACHE_PREFIX = 'music-shell-';
const CACHE = 'music-shell-v80';
const OFFLINE_HTML = './index.html?v=46';
const APP_JS = './app-recovery.js?v=1';
const AUDIO_STORAGE_JS = './audio-storage-recovery.js?v=4';
const OFFLINE_MEDIA_JS = './offline-media-url.js?v=1';
const PREFETCH_JS = './playback-prefetch.js?v=3';
const META_JS = './metadata.js?v=1';
const PLAYER_UI_JS = './player-ui.js?v=9';
const PLAYLIST_JS = './playlist-enhancements.js?v=7';
const MEDIA_CONTROLS_JS = './media-session-controls.js?v=5';
const MEDIA_CONTROLS_V6_JS = './media-session-controls-v6.js?v=3';
const NOW_PLAYING_V3_JS = './now-playing-fullscreen-v3.js';
const STYLES = './styles.css?v=20';
const MANIFEST = './manifest.json?v=2';
const SHELL = [OFFLINE_HTML, STYLES, APP_JS, AUDIO_STORAGE_JS, OFFLINE_MEDIA_JS, PREFETCH_JS, META_JS, PLAYER_UI_JS, PLAYLIST_JS, MEDIA_CONTROLS_JS, MEDIA_CONTROLS_V6_JS, NOW_PLAYING_V3_JS, MANIFEST];

const AUDIO_DB_NAME = 'music-pwa-audio-db';
const AUDIO_STORE = 'audio';
const AUDIO_ENDPOINT = '/music-player/__lexi_audio__';

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
  if (pathname.endsWith('/offline-media-url.js')) return OFFLINE_MEDIA_JS;
  if (pathname.endsWith('/playback-prefetch.js')) return PREFETCH_JS;
  if (pathname.endsWith('/player-ui.js')) return PLAYER_UI_JS;
  if (pathname.endsWith('/playlist-enhancements.js')) return PLAYLIST_JS;
  if (pathname.endsWith('/media-session-controls-v6.js')) return MEDIA_CONTROLS_V6_JS;
  if (pathname.endsWith('/media-session-controls.js')) return MEDIA_CONTROLS_JS;
  if (pathname.endsWith('/now-playing-fullscreen-v3.js')) return NOW_PLAYING_V3_JS;
  return null;
}

async function injectRuntime(response) {
  if (!response) return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  const text = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  let html = text;
  if (!html.includes('offline-media-url.js')) {
    html = html.replace(
      '<script src="playback-prefetch.js?v=3"></script>',
      '  <script src="./offline-media-url.js?v=1"></script>\n  <script src="playback-prefetch.js?v=3"></script>'
    );
  }
  if (!html.includes('media-session-controls-v6.js')) {
    html = html.replace('</body>', '  <script src="./media-session-controls-v6.js?v=3" defer></script>\n</body>');
  }
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

function openAudioDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUDIO_DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open audio database.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Audio database request failed.'));
  });
}

function valueToBlob(value) {
  if (value instanceof Blob) return value;
  if (value?.__musicBytes instanceof ArrayBuffer) {
    return new Blob([value.__musicBytes], { type: value.type || 'application/octet-stream' });
  }
  if (value instanceof ArrayBuffer) return new Blob([value], { type: 'application/octet-stream' });
  if (ArrayBuffer.isView(value)) {
    return new Blob([
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
    ], { type: 'application/octet-stream' });
  }
  return null;
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return { invalid: true };
  let start = match[1] === '' ? null : Number(match[1]);
  let end = match[2] === '' ? null : Number(match[2]);

  if (start == null) {
    const suffix = end;
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    if (!Number.isFinite(start) || start < 0 || start >= size) return { invalid: true };
    if (end == null || !Number.isFinite(end) || end >= size) end = size - 1;
    if (end < start) return { invalid: true };
  }
  return { start, end };
}

async function offlineAudioResponse(request, url) {
  const id = String(url.searchParams.get('id') || '');
  if (!id) return new Response('Missing audio id', { status: 400 });

  const db = await openAudioDb();
  try {
    const tx = db.transaction(AUDIO_STORE, 'readonly');
    const row = await requestResult(tx.objectStore(AUDIO_STORE).get(id));
    const blob = valueToBlob(row?.blob);
    if (!blob || blob.size <= 0) return new Response('Audio not found', { status: 404 });

    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Type': blob.type || 'application/octet-stream'
    });
    const range = parseRange(request.headers.get('range'), blob.size);
    if (range?.invalid) {
      headers.set('Content-Range', `bytes */${blob.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      const body = blob.slice(range.start, range.end + 1, blob.type || 'application/octet-stream');
      headers.set('Content-Length', String(body.size));
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${blob.size}`);
      return new Response(body, { status: 206, headers });
    }

    headers.set('Content-Length', String(blob.size));
    return new Response(blob, { status: 200, headers });
  } finally {
    try { db.close(); } catch {}
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === AUDIO_ENDPOINT) {
    event.respondWith(offlineAudioResponse(req, url).catch(error => {
      console.error('Offline audio response failed', error);
      return new Response('Offline audio unavailable', { status: 500 });
    }));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await injectRuntime(await fetch(req));
      } catch {
        return injectRuntime(await caches.match(OFFLINE_HTML));
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
