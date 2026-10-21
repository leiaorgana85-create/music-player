(() => {
  'use strict';

  // Compatibility entry point for older cached HTML. The active media-control
  // implementation is v6; do not install a second generation of handlers or
  // the retired v2 full-screen Now Playing module here.
  if (window.__lexiMediaControlsV6 || document.querySelector('script[data-media-session-controls-v6="1"]')) return;

  const script = document.createElement('script');
  script.src = './media-session-controls-v6.js';
  script.async = false;
  script.dataset.mediaSessionControlsV6 = '1';
  document.head.appendChild(script);
})();
