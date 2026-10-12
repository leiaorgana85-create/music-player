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

  function setupSettingsPanel() {
    const dialog = document.getElementById('settingsDialog');
    const form = document.getElementById('settingsForm');
    const clientInput = document.getElementById('clientIdInput');
    const folderInput = document.getElementById('folderIdInput');
    const saveButton = document.getElementById('saveSettingsBtn');
    const exportButton = document.getElementById('exportBackupBtn');
    const statusLabel = document.getElementById('connectionLabel');
    const statusDetail = document.getElementById('statusDetail');
    if (!dialog || !form || !clientInput || !folderInput || !exportButton) return;
    if (dialog.classList.contains('settings-clean')) return;

    const style = document.createElement('style');
    style.textContent = `
      #settingsDialog.settings-clean {
        width: min(390px, calc(100% - 28px));
        max-height: calc(100dvh - 56px);
        padding: 16px;
      }
      #settingsDialog.settings-clean .dialog-title { margin-bottom: 8px; }
      #settingsDialog.settings-clean .settings-section { margin-top: 14px; padding-top: 12px; }
      #settingsDialog.settings-clean .settings-section.settings-first { margin-top: 4px; padding-top: 0; border-top: 0; }
      #settingsDialog.settings-clean .settings-row {
        display: flex; align-items: baseline; justify-content: space-between; gap: 14px;
        padding: 6px 0; font-size: 12px;
      }
      #settingsDialog.settings-clean .settings-row-label { color: var(--muted); }
      #settingsDialog.settings-clean .settings-row-value { color: var(--text); text-align: right; font-weight: 650; }
      #settingsDialog.settings-clean .settings-note { margin: 5px 0 0; }
      #settingsDialog.settings-clean details.settings-advanced > summary {
        cursor: pointer; color: var(--muted); font-size: 12px; font-weight: 650;
      }
      #settingsDialog.settings-clean details.settings-advanced .field { margin: 10px 0; }
      #settingsDialog.settings-clean details.settings-advanced input {
        font-size: 16px !important;
        color: #b9b9c0;
        background: #111113;
      }
      #settingsDialog.settings-clean .dialog-actions { margin-top: 14px; }
    `;
    document.head.appendChild(style);

    dialog.classList.add('settings-clean');
    const title = dialog.querySelector('.dialog-title');
    if (title) title.textContent = 'Settings';

    const clientField = clientInput.closest('.field');
    const folderField = folderInput.closest('.field');
    const originalHelp = folderField?.nextElementSibling?.classList?.contains('help')
      ? folderField.nextElementSibling
      : null;
    const backupSection = exportButton.closest('.settings-section');
    const actions = dialog.querySelector('.dialog-actions');

    clientInput.readOnly = true;
    folderInput.readOnly = true;
    clientInput.tabIndex = -1;
    folderInput.tabIndex = -1;
    clientInput.autocomplete = 'off';
    folderInput.autocomplete = 'off';

    if (saveButton) saveButton.classList.add('hidden');
    const closeButton = actions?.querySelector('button[value="cancel"]');
    if (closeButton) closeButton.textContent = 'Close';

    const storageSection = document.createElement('div');
    storageSection.className = 'settings-section settings-first';
    storageSection.innerHTML = `
      <div class="settings-section-title">Storage</div>
      <div class="settings-row"><span class="settings-row-label">Offline audio</span><span id="settingsAudioStorage" class="settings-row-value">Calculating…</span></div>
      <div class="settings-row"><span class="settings-row-label">Total app storage</span><span id="settingsTotalStorage" class="settings-row-value">Calculating…</span></div>
      <p class="help settings-note">Total app storage is the iOS/WebKit estimate for MUSIC, including offline audio, database data, and app cache.</p>
    `;

    const driveSection = document.createElement('div');
    driveSection.className = 'settings-section';
    driveSection.innerHTML = `
      <div class="settings-section-title">Google Drive</div>
      <div class="settings-row"><span class="settings-row-label">MUSIC folder</span><span id="settingsDriveStatus" class="settings-row-value">Configured</span></div>
      <p class="help settings-note">Drive setup is fixed for this personal app. Authorization is requested only when needed.</p>
    `;

    const advanced = document.createElement('details');
    advanced.className = 'settings-section settings-advanced';
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced setup';
    advanced.appendChild(summary);
    if (clientField) advanced.appendChild(clientField);
    if (folderField) advanced.appendChild(folderField);
    if (originalHelp) {
      originalHelp.textContent = 'Read-only app configuration. These values are kept here for troubleshooting only.';
      advanced.appendChild(originalHelp);
    }

    if (title) title.insertAdjacentElement('afterend', storageSection);
    else form.prepend(storageSection);
    if (backupSection) form.insertBefore(driveSection, backupSection);
    else form.insertBefore(driveSection, actions);

    if (backupSection) {
      const backupTitle = backupSection.querySelector('.settings-section-title');
      const backupHelp = backupSection.querySelector('.help');
      if (backupTitle) backupTitle.textContent = 'Playlist backup';
      if (backupHelp) backupHelp.textContent = 'Backs up all playlists, manual song order, and Favorites. Downloaded audio is not copied or changed.';
    }
    form.insertBefore(advanced, actions);

    function formatBytes(value) {
      const n = Number(value || 0);
      if (!Number.isFinite(n) || n <= 0) return '0 KB';
      if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
      if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
      return `${Math.round(n / 1024)} KB`;
    }

    function offlineAudioText() {
      const text = (statusDetail?.textContent || '').trim();
      if (!text || /loading/i.test(text)) return 'Calculating…';
      const parts = text.split('•').map(x => x.trim()).filter(Boolean);
      if (!parts.length) return 'Calculating…';
      const last = parts[parts.length - 1].replace(/\boffline\b.*$/i, '').trim();
      return last || 'Calculating…';
    }

    async function refreshSettingsStatus() {
      const audioValue = document.getElementById('settingsAudioStorage');
      const totalValue = document.getElementById('settingsTotalStorage');
      const driveValue = document.getElementById('settingsDriveStatus');

      if (audioValue) audioValue.textContent = offlineAudioText();

      if (totalValue) {
        totalValue.textContent = 'Calculating…';
        try {
          const estimate = await navigator.storage?.estimate?.();
          totalValue.textContent = estimate && Number.isFinite(estimate.usage)
            ? formatBytes(estimate.usage)
            : 'Unavailable';
        } catch {
          totalValue.textContent = 'Unavailable';
        }
      }

      if (driveValue) {
        const label = (statusLabel?.textContent || '').toLowerCase();
        if (!navigator.onLine) driveValue.textContent = 'Offline';
        else if (label.includes('google drive connected')) driveValue.textContent = 'Connected';
        else driveValue.textContent = 'Configured';
      }
    }

    const openObserver = new MutationObserver(() => {
      if (!dialog.open) return;
      clientInput.blur();
      folderInput.blur();
      refreshSettingsStatus();
    });
    openObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] });

    dialog.addEventListener('close', () => {
      clientInput.blur();
      folderInput.blur();
      advanced.open = false;
    });
  }

  setupSettingsPanel();

  if (!document.querySelector('script[data-playlist-enhancements]')) {
    const script = document.createElement('script');
    script.src = './playlist-enhancements.js?v=3';
    script.defer = true;
    script.dataset.playlistEnhancements = '1';
    document.head.appendChild(script);
  }
})();