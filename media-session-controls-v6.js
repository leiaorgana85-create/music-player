(() => {
  'use strict';

  if (window.__lexiMediaControlsV6) return;
  window.__lexiMediaControlsV6 = true;

  const audio = document.getElementById('audio');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

  // iOS/WebKit can keep the audible decoder attached to the previous Blob
  // source even while the new track timeline advances. Release the old media
  // resource before a replacement src is installed, and defer Blob revocation
  // long enough for WebKit to finish detaching the old decoder.
  if (audio && !window.__lexiAudioHandoffGuard) {
    window.__lexiAudioHandoffGuard = true;

    const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function guardedRevokeObjectURL(value) {
      if (typeof value === 'string' && value.startsWith('blob:')) {
        setTimeout(() => {
          try { nativeRevokeObjectURL(value); } catch {}
        }, 1500);
        return;
      }
      return nativeRevokeObjectURL(value);
    };

    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (srcDescriptor?.get && srcDescriptor?.set && srcDescriptor.configurable) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: srcDescriptor.configurable,
        enumerable: srcDescriptor.enumerable,
        get: srcDescriptor.get,
        set(value) {
          if (this === audio) {
            const existing = this.getAttribute('src');
            if (existing && value && existing !== value) {
              try { this.pause(); } catch {}
              try {
                this.removeAttribute('src');
                this.load();
              } catch {}
            }
          }
          return srcDescriptor.set.call(this, value);
        }
      });
    }
  }

  function previousTrack() {
    if (!prevBtn) return;
    try {
      if ((audio.currentTime || 0) > 3) audio.currentTime = 0;
    } catch {}
    prevBtn.click();
  }

  function nextTrack() {
    nextBtn?.click();
  }

  function installTrackControls() {
    if (!('mediaSession' in navigator) || !audio) return;
    try { navigator.mediaSession.setActionHandler('seekbackward', null); } catch {}
    try { navigator.mediaSession.setActionHandler('seekforward', null); } catch {}
    try { navigator.mediaSession.setActionHandler('seekto', null); } catch {}
    try { navigator.mediaSession.setActionHandler('play', () => audio.play()); } catch {}
    try { navigator.mediaSession.setActionHandler('pause', () => audio.pause()); } catch {}
    try { navigator.mediaSession.setActionHandler('previoustrack', previousTrack); } catch {}
    try { navigator.mediaSession.setActionHandler('nexttrack', nextTrack); } catch {}
  }

  function loadFullscreenNowPlaying() {
    if (document.querySelector('script[data-now-playing-fullscreen="3"]')) return;
    const script = document.createElement('script');
    script.src = './now-playing-fullscreen-v3.js';
    script.defer = true;
    script.dataset.nowPlayingFullscreen = '3';
    document.head.appendChild(script);
  }

  loadFullscreenNowPlaying();
  window.addEventListener('load', installTrackControls);
  window.addEventListener('pageshow', installTrackControls);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) installTrackControls();
  });
  audio?.addEventListener('play', installTrackControls);
  audio?.addEventListener('playing', installTrackControls);
  audio?.addEventListener('loadedmetadata', installTrackControls);
  setTimeout(installTrackControls, 0);
  setTimeout(installTrackControls, 500);
  setTimeout(installTrackControls, 1500);
})();
