(() => {
  'use strict';

  const player = document.getElementById('player');
  const playerMain = player?.querySelector('.player-main');
  const audio = window.LexiMusicAudio || document.getElementById('audio');
  const prevBtn = document.getElementById('prevBtn');
  const playBtn = document.getElementById('playBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (!player || !playerMain || player.dataset.fullscreenReady === '3') return;
  player.dataset.fullscreenReady = '3';

  const style = document.createElement('style');
  style.id = 'nowPlayingFullscreenStylesV3';
  style.textContent = `
    .player:not(.expanded) .player-main { cursor: pointer; }
    .primary-transport, #prevBtn, #nextBtn { display:grid; place-items:center; padding:0; line-height:1; }
    .primary-transport svg { width:25px; height:25px; }
    #prevBtn svg, #nextBtn svg { width:30px; height:30px; }
    .primary-transport svg, #prevBtn svg, #nextBtn svg { display:block; }
    .now-playing-close { display:none; position:absolute; z-index:3; top:calc(env(safe-area-inset-top) + 8px); left:12px; width:42px; height:42px; padding:0; border:0; border-radius:50%; background:transparent; color:#f3f3f4; align-items:center; justify-content:center; }
    .now-playing-close svg { display:block; width:28px; height:28px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    body.now-playing-expanded { overflow:hidden; touch-action:none; }
    .player.expanded { z-index:200; top:0; bottom:0; height:100dvh; min-height:0; padding:calc(env(safe-area-inset-top) + 50px) 22px calc(env(safe-area-inset-bottom) + 14px); overflow:hidden; overscroll-behavior:contain; background:#0b0b0c; border-top:0; backdrop-filter:none; -webkit-backdrop-filter:none; display:grid; grid-template-rows:minmax(0,1fr) 30px 24px 82px; align-items:stretch; }
    .player.expanded .now-playing-close { display:flex; }
    .player.expanded .player-main { width:min(520px,100%); height:100%; min-height:0; margin:0 auto; display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr) 88px 48px; align-items:center; justify-items:stretch; gap:0; cursor:default; position:relative; }
    .player.expanded .now-artwork-wrap { width:min(80vw,40dvh,330px); height:min(80vw,40dvh,330px); flex:none; margin:0; align-self:center; justify-self:auto; position:relative; left:50%; transform:translateX(-50%); border-radius:18px; box-shadow:0 18px 46px rgba(0,0,0,.34); }
    .player.expanded .now-artwork { object-position:50% 50%; }
    .player.expanded .now-artwork-placeholder { font-size:64px; }
    .player.expanded .player-text { width:100%; height:88px; min-height:88px; padding:0; overflow:hidden; text-align:center; display:flex; flex-direction:column; align-items:center; justify-content:center; }
    .player.expanded .now-title { width:100%; min-height:0; font-size:clamp(21px,6vw,27px); line-height:1.17; font-weight:720; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
    .player.expanded .now-meta { max-width:100%; margin-top:7px; font-size:13px; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#a9a9b1; }
    .player.expanded .now-status { display:none; }
    .player.expanded .player-actions { height:48px; margin:0; gap:10px; align-self:center; justify-self:center; }
    .player.expanded .player-action { width:42px; height:42px; font-size:22px; }
    .player.expanded .seek, .player.expanded .seek-times, .player.expanded .player-controls { width:min(520px,100%); }
    .player.expanded .seek { align-self:center; margin:0 auto; }
    .player.expanded .seek-times { align-self:center; margin:0 auto; font-size:11px; }
    .player.expanded .player-controls { height:82px; margin:0 auto; display:grid; grid-template-columns:44px 70px 76px 70px 44px; column-gap:5px; align-items:center; justify-content:center; }
    .player.expanded .player-controls::before { content:''; width:44px; height:1px; }
    .player.expanded .transport { width:70px; height:70px; padding:0; }
    .player.expanded #prevBtn svg, .player.expanded #nextBtn svg { width:43px; height:43px; }
    .player.expanded .primary-transport { width:76px; height:76px; }
    .player.expanded .primary-transport svg { width:33px; height:33px; }
    .player.expanded .repeat { width:44px; min-width:44px; flex-basis:44px; min-height:30px; margin:0; padding:3px 0; font-size:9.5px; }
    @media (max-height:650px) {
      .player.expanded { padding-top:calc(env(safe-area-inset-top) + 44px); grid-template-rows:minmax(0,1fr) 28px 20px 74px; }
      .player.expanded .player-main { grid-template-rows:minmax(0,1fr) 76px 42px; }
      .player.expanded .player-text { height:76px; min-height:76px; }
      .player.expanded .player-actions { height:42px; }
      .player.expanded .now-artwork-wrap { width:min(66vw,34dvh,270px); height:min(66vw,34dvh,270px); }
      .player.expanded .player-controls { height:74px; }
    }
  `;
  document.head.appendChild(style);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.id = 'nowPlayingCloseBtnV3';
  closeButton.className = 'now-playing-close';
  closeButton.setAttribute('aria-label', 'Close full-screen Now Playing');
  closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 9 7 7 7-7"></path></svg>';
  player.prepend(closeButton);

  function installTransportIcons() {
    if (prevBtn && !prevBtn.querySelector('svg[data-track-icon="prev"]')) prevBtn.innerHTML = '<svg data-track-icon="prev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path><path d="M18 6.2 9 12l9 5.8V6.2Z" fill="currentColor"></path></svg>';
    if (nextBtn && !nextBtn.querySelector('svg[data-track-icon="next"]')) nextBtn.innerHTML = '<svg data-track-icon="next" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path><path d="m6 6.2 9 5.8-9 5.8V6.2Z" fill="currentColor"></path></svg>';
  }
  function syncPlayIcon() {
    if (!playBtn || !audio) return;
    const state = audio.paused ? 'play' : 'pause';
    const existing = playBtn.querySelector('svg[data-play-state]');
    if (existing?.dataset.playState === state) return;
    playBtn.innerHTML = state === 'play'
      ? '<svg data-play-state="play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.8 18 12 8 18.2V5.8Z" fill="currentColor"></path></svg>'
      : '<svg data-play-state="pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"></rect><rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"></rect></svg>';
  }
  installTransportIcons(); syncPlayIcon();
  audio?.addEventListener('play', syncPlayIcon); audio?.addEventListener('playing', syncPlayIcon); audio?.addEventListener('pause', syncPlayIcon); audio?.addEventListener('ended', syncPlayIcon);
  const playIconObserver = playBtn ? new MutationObserver(() => requestAnimationFrame(syncPlayIcon)) : null;
  playIconObserver?.observe(playBtn, { childList:true, characterData:true, subtree:true });

  function openFullscreen() { if (player.classList.contains('hidden') || player.classList.contains('expanded')) return; player.classList.add('expanded'); document.body.classList.add('now-playing-expanded'); }
  function closeFullscreen() { if (!player.classList.contains('expanded')) return; player.classList.remove('expanded'); document.body.classList.remove('now-playing-expanded'); }
  playerMain.addEventListener('click', event => { if (player.classList.contains('expanded')) return; if (event.target.closest('button,input,a,[role="button"]')) return; openFullscreen(); });
  closeButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); closeFullscreen(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeFullscreen(); });
  const playerObserver = new MutationObserver(() => { if (player.classList.contains('hidden')) closeFullscreen(); });
  playerObserver.observe(player, { attributes:true, attributeFilter:['class'] });
})();
