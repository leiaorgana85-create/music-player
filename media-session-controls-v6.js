// Compatibility entry for cached HTML. Media Session handlers are owned by app-player.js.
(() => { if (document.querySelector('script[src*="now-playing-fullscreen-v3.js"]')) return; const s = document.createElement('script'); s.src = './now-playing-fullscreen-v3.js'; document.head.appendChild(s); })();
