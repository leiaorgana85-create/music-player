const CACHE_PREFIX = 'music-shell-';
const CACHE = 'music-shell-v85';
const SHELL = ['./', './index.html', './styles.css?v=20', './app-player.js?v=1', './audio-storage-player.js?v=1', './metadata.js?v=1', './player-ui.js?v=10', './playlist-enhancements.js?v=7', './now-playing-fullscreen-v3.js', './manifest.json?v=2', './reset.html'];
const ALIASES = {
  'app-recovery.js': './app-player.js?v=1',
  'audio-storage-recovery.js': './audio-storage-player.js?v=1',
  'app-player.js': './app-player.js?v=1',
  'audio-storage-player.js': './audio-storage-player.js?v=1',
  'playback-prefetch.js': './playback-prefetch.js',
  'player-ui.js': './player-ui.js?v=10',
  'playlist-enhancements.js': './playlist-enhancements.js?v=7',
  'media-session-controls.js': './media-session-controls.js?v=5',
  'media-session-controls-v6.js': './media-session-controls-v6.js',
  'now-playing-fullscreen-v3.js': './now-playing-fullscreen-v3.js',
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
  if (req.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // No private Drive responses or sibling applications are cached here.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
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
