importScripts('./offline-audio.js?v=1');
const CACHE_PREFIX = 'music-shell-';
const CACHE = 'music-shell-v91';
const SHELL = ['./audio-deck.js?v=1', './offline-audio.js?v=1', './playback-diagnostics.js?v=3', './', './index.html', './styles.css?v=20', './app-player.js?v=7', './audio-storage-player.js?v=1', './metadata.js?v=1', './player-settings.js?v=2', './playlist-enhancements.js?v=7', './now-playing-fullscreen-v3.js?v=2', './manifest.json?v=2', './reset.html'];
const ALIASES = {
  'audio-deck.js': './audio-deck.js?v=1',
  'playback-diagnostics.js': './playback-diagnostics.js?v=3',
  'app-recovery.js': './app-player.js?v=7',
  'audio-storage-recovery.js': './audio-storage-player.js?v=1',
  'app-player.js': './app-player.js?v=7',
  'audio-storage-player.js': './audio-storage-player.js?v=1',
  'playback-prefetch.js': './playback-prefetch.js',
  'player-settings.js': './player-settings.js?v=2',
  'player-ui.js': './player-settings.js?v=2',
  'playlist-enhancements.js': './playlist-enhancements.js?v=7',
  'media-session-controls.js': './media-session-controls.js?v=5',
  'media-session-controls-v6.js': './media-session-controls-v6.js',
  'now-playing-fullscreen-v3.js': './now-playing-fullscreen-v3.js?v=2',
  'metadata.js': './metadata.js?v=1',
  'styles.css': './styles.css?v=20',
  'manifest.json': './manifest.json?v=2'
};
const COMPAT = ['./playback-prefetch.js', './media-session-controls.js?v=5', './media-session-controls-v6.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...SHELL, ...COMPAT])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const mediaPrefix = scope.pathname + '__offline_audio/';
  if (url.pathname.startsWith(mediaPrefix)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    let id;try { id = decodeURIComponent(url.pathname.slice(mediaPrefix.length)); } catch (_) { event.respondWith(new Response(null,{status:400})); return; }
    event.respondWith(self.LexiOfflineAudio.handle(req,id));
    return;
  }
  if (req.method !== 'GET') return;
  // No private Drive responses or sibling applications are cached here.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // The installed player must boot without waiting for airport Wi-Fi,
    // captive portals, or a disconnected network. New worker installation
    // refreshes the shell and keeps versioned scripts paired with aliases.
    if (req.mode === 'navigate') {
      const saved = await cache.match('./index.html');
      if (saved) return saved;
    }
    const name = url.pathname.slice(scope.pathname.length);
    const alias = ALIASES[name];
    if (alias) {
      const current = await cache.match(alias);
      if (current) return current;
      const response = await fetch(new URL(alias, scope).href);
      if (response.ok) event.waitUntil(cache.put(alias, response.clone()).catch(() => {}));
      return response;
    }
    try {
      const response = await fetch(req);
      if (response.ok) event.waitUntil(cache.put(req, response.clone()).catch(() => {}));
      if (response.ok || req.mode !== 'navigate') return response;
    } catch {}
    const exact = await cache.match(req);
    if (exact) return exact;
    if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  })());
});
