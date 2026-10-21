(() => {
  'use strict';

  if (window.__lexiIosAudioSessionRecovery) return;
  window.__lexiIosAudioSessionRecovery = true;

  const session = navigator.audioSession;
  const audio = document.getElementById('audio');
  const nextBtn = document.getElementById('nextBtn');
  const prevBtn = document.getElementById('prevBtn');
  if (!session || !audio) return;

  function forcePlaybackCategory() {
    try { session.type = 'playback'; } catch {}
  }

  function recoverPlaybackCategory() {
    return new Promise(resolve => {
      try { session.type = 'ambient'; } catch {}
      setTimeout(() => {
        try { session.type = 'playback'; } catch {}
        resolve();
      }, 0);
    });
  }

  // WebKit can leave the GPU-side audio session using a stale ambient category
  // after a media-session transition. In that state HTMLMediaElement playback
  // continues and currentTime advances, but an iPhone on silent mode emits no
  // sound. Cycling to a genuinely different category and back forces WebKit to
  // republish the playback category.
  forcePlaybackCategory();

  const priorPlay = audio.play.bind(audio);
  audio.play = async (...args) => {
    await recoverPlaybackCategory();
    return priorPlay(...args);
  };

  // Start recovery before the app's ended handler begins loading the next song.
  audio.addEventListener('ended', () => { recoverPlaybackCategory(); }, true);
  nextBtn?.addEventListener('click', () => { recoverPlaybackCategory(); }, true);
  prevBtn?.addEventListener('click', () => { recoverPlaybackCategory(); }, true);

  window.addEventListener('pageshow', forcePlaybackCategory);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) recoverPlaybackCategory();
  });
})();
