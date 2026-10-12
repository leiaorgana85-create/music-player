(() => {
  'use strict';

  const playerMain = document.querySelector('.player-main');
  const audio = document.getElementById('audio');
  const nowTitle = document.getElementById('nowTitle');
  if (!playerMain || !audio || !nowTitle) return;

  const artworkWrap = document.createElement('div');
  artworkWrap.id = 'nowArtworkWrap';
  artworkWrap.className = 'now-artwork-wrap no-art';
  artworkWrap.setAttribute('aria-hidden', 'true');

  const artwork = document.createElement('img');
  artwork.id = 'nowArtwork';
  artwork.className = 'now-artwork';
  artwork.alt = '';

  const placeholder = document.createElement('span');
  placeholder.className = 'now-artwork-placeholder';
  placeholder.textContent = '♪';

  artworkWrap.append(artwork, placeholder);
  playerMain.insertBefore(artworkWrap, playerMain.firstChild);

  function syncArtwork() {
    let src = '';
    try {
      src = navigator.mediaSession?.metadata?.artwork?.[0]?.src || '';
    } catch {}

    if (!src) {
      artwork.removeAttribute('src');
      artworkWrap.classList.add('no-art');
      return;
    }

    if (artwork.src !== src) artwork.src = src;
    artworkWrap.classList.remove('no-art');
  }

  artwork.addEventListener('error', () => {
    artwork.removeAttribute('src');
    artworkWrap.classList.add('no-art');
  });

  audio.addEventListener('play', syncArtwork);
  audio.addEventListener('loadedmetadata', syncArtwork);
  audio.addEventListener('durationchange', syncArtwork);

  const observer = new MutationObserver(() => requestAnimationFrame(syncArtwork));
  observer.observe(nowTitle, { childList: true, characterData: true, subtree: true });
})();