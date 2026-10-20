(() => {
  'use strict';

  const player = document.getElementById('player');
  const playerMain = player?.querySelector('.player-main');
  if (!player || !playerMain || player.dataset.fullscreenReady === '1') return;
  player.dataset.fullscreenReady = '1';

  const style = document.createElement('style');
  style.id = 'nowPlayingFullscreenStyles';
  style.textContent = `
    .player:not(.expanded) .player-main {
      cursor: pointer;
    }
    .now-playing-close {
      display: none;
      position: absolute;
      z-index: 3;
      top: calc(env(safe-area-inset-top) + 8px);
      left: 12px;
      width: 42px;
      height: 42px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #f3f3f4;
      align-items: center;
      justify-content: center;
    }
    .now-playing-close svg {
      display: block;
      width: 28px;
      height: 28px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    body.now-playing-expanded {
      overflow: hidden;
      touch-action: none;
    }
    .player.expanded {
      z-index: 200;
      top: 0;
      bottom: 0;
      height: 100dvh;
      min-height: 0;
      padding: calc(env(safe-area-inset-top) + 54px) 22px calc(env(safe-area-inset-bottom) + 24px);
      overflow-y: auto;
      overscroll-behavior: contain;
      background: #0b0b0c;
      border-top: 0;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .player.expanded .now-playing-close {
      display: flex;
    }
    .player.expanded .player-main {
      width: min(520px, 100%);
      margin: 0 auto;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: 13px;
      cursor: default;
    }
    .player.expanded .now-artwork-wrap {
      width: min(82vw, 42dvh, 340px);
      height: min(82vw, 42dvh, 340px);
      flex: 0 0 auto;
      border-radius: 18px;
      box-shadow: 0 18px 46px rgba(0,0,0,.34);
    }
    .player.expanded .now-artwork-placeholder {
      font-size: 64px;
    }
    .player.expanded .player-text {
      width: 100%;
      padding: 0;
      text-align: center;
    }
    .player.expanded .now-title {
      display: block;
      font-size: clamp(21px, 6vw, 27px);
      line-height: 1.17;
      font-weight: 720;
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
    }
    .player.expanded .now-meta {
      margin-top: 7px;
      font-size: 13px;
      line-height: 1.3;
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      color: #a9a9b1;
    }
    .player.expanded .player-actions {
      gap: 10px;
      margin-top: -1px;
    }
    .player.expanded .player-action {
      width: 42px;
      height: 42px;
      font-size: 22px;
    }
    .player.expanded .seek,
    .player.expanded .seek-times,
    .player.expanded .player-controls {
      width: min(520px, 100%);
    }
    .player.expanded .seek {
      margin: 26px auto 6px;
    }
    .player.expanded .seek-times {
      margin: 0 auto 16px;
      font-size: 11px;
    }
    .player.expanded .player-controls {
      margin: 0 auto;
      gap: 16px;
    }
    .player.expanded .transport {
      width: 62px;
      height: 62px;
    }
    .player.expanded .primary-transport {
      width: 68px;
      height: 68px;
      font-size: 28px;
    }
    .player.expanded .repeat {
      width: 58px;
      flex-basis: 58px;
      min-height: 30px;
      font-size: 10.5px;
    }
    @media (max-height: 650px) {
      .player.expanded {
        padding-top: calc(env(safe-area-inset-top) + 48px);
      }
      .player.expanded .player-main {
        gap: 8px;
      }
      .player.expanded .seek {
        margin-top: 14px;
      }
      .player.expanded .seek-times {
        margin-bottom: 7px;
      }
    }
  `;
  document.head.appendChild(style);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.id = 'nowPlayingCloseBtn';
  closeButton.className = 'now-playing-close';
  closeButton.setAttribute('aria-label', 'Close full-screen Now Playing');
  closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 7 7 7-7"></path></svg>';
  player.prepend(closeButton);

  function openFullscreen() {
    if (player.classList.contains('hidden') || player.classList.contains('expanded')) return;
    player.classList.add('expanded');
    document.body.classList.add('now-playing-expanded');
  }

  function closeFullscreen() {
    if (!player.classList.contains('expanded')) return;
    player.classList.remove('expanded');
    document.body.classList.remove('now-playing-expanded');
  }

  playerMain.addEventListener('click', event => {
    if (player.classList.contains('expanded')) return;
    if (event.target.closest('button, input, a, [role="button"]')) return;
    openFullscreen();
  });

  closeButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    closeFullscreen();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeFullscreen();
  });

  const playerObserver = new MutationObserver(() => {
    if (player.classList.contains('hidden')) closeFullscreen();
  });
  playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
})();
