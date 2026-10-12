(() => {
  'use strict';

  const playerMain = document.querySelector('.player-main');
  const audio = document.getElementById('audio');
  const nowTitle = document.getElementById('nowTitle');
  if (!playerMain || !audio || !nowTitle) return;

  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

  function setTransportIcon(button, direction) {
    if (!button) return;
    const previous = direction === 'previous';
    button.style.color = '#ffffff';
    button.style.webkitTextFillColor = '#ffffff';
    button.style.webkitAppearance = 'none';
    button.style.appearance = 'none';
    button.innerHTML = previous
      ? '<svg viewBox="0 0 24 24" width="27" height="27" aria-hidden="true" focusable="false" style="display:block;margin:auto"><rect x="5" y="6" width="2" height="12" rx="1" fill="#ffffff"></rect><path d="M17 6.5 9.5 12 17 17.5V6.5Z" fill="#ffffff"></path></svg>'
      : '<svg viewBox="0 0 24 24" width="27" height="27" aria-hidden="true" focusable="false" style="display:block;margin:auto"><path d="M7 6.5 14.5 12 7 17.5V6.5Z" fill="#ffffff"></path><rect x="17" y="6" width="2" height="12" rx="1" fill="#ffffff"></rect></svg>';
  }

  setTransportIcon(prevBtn, 'previous');
  setTransportIcon(nextBtn, 'next');

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

  if (!document.querySelector('script[data-playlist-enhancements]')) {
    const script = document.createElement('script');
    script.src = './playlist-enhancements.js?v=1';
    script.defer = true;
    script.dataset.playlistEnhancements = '1';
    document.head.appendChild(script);
  }
})();