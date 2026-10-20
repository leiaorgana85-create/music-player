(() => {
  'use strict';

  const audio = document.getElementById('audio');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

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

    // Remove seek-style actions so iOS can render true track navigation controls
    // instead of +/-10-second buttons.
    try { navigator.mediaSession.setActionHandler('seekbackward', null); } catch {}
    try { navigator.mediaSession.setActionHandler('seekforward', null); } catch {}
    try { navigator.mediaSession.setActionHandler('seekto', null); } catch {}

    try { navigator.mediaSession.setActionHandler('play', () => audio.play()); } catch {}
    try { navigator.mediaSession.setActionHandler('pause', () => audio.pause()); } catch {}
    try { navigator.mediaSession.setActionHandler('previoustrack', previousTrack); } catch {}
    try { navigator.mediaSession.setActionHandler('nexttrack', nextTrack); } catch {}
  }

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
