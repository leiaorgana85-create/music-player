(() => {
  'use strict';

  const playerMain = document.querySelector('.player-main');
  const audio = window.LexiMusicAudio || document.getElementById('audio');
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

  window.addEventListener('lexi-artwork-updated', syncArtwork);
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
      #settingsDialog.settings-clean .settings-storage-path {
        margin-top: 4px; color: var(--muted); font-size: 11px; line-height: 1.4;
      }
      #settingsDialog.settings-clean .settings-storage-actions { margin-top: 10px; }
      #settingsDialog.settings-clean .settings-storage-actions .button { width: 100%; }
      #settingsDialog.settings-clean .settings-storage-actions .button + .button { margin-top: 8px; }
      #settingsDialog.settings-clean .settings-storage-result {
        min-height: 16px; margin: 8px 0 0; font-size: 12px; line-height: 1.4;
      }
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
      <div class="settings-storage-path">Exact local audio: <strong>music-pwa-audio-db → audio</strong></div>
      <div class="settings-row"><span class="settings-row-label">WebKit storage estimate</span><span id="settingsTotalStorage" class="settings-row-value">Calculating…</span></div>
      <p class="help settings-note">Offline audio is exact. WebKit storage is only an origin/container estimate and can include allocated-but-unused database space or app cache.</p>
      <div class="settings-storage-actions">
        <button id="settingsClearOfflineBtn" type="button" class="button secondary">Delete all offline audio</button>
        <button id="settingsFactoryResetBtn" type="button" class="button secondary">Reset Lexi Music on this device</button>
      </div>
      <p class="help settings-note">Delete all offline audio keeps your local library and playlists. Reset deletes all Lexi Music data on this device—including the old library database, playlists, Favorites, settings and Music app cache—and starts fresh. Google Drive is never deleted.</p>
      <p id="settingsStorageResult" class="settings-storage-result"></p>
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
      if (!Number.isFinite(n) || n <= 0) return '0 MB';
      if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
      if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
      return `${Math.round(n / 1024)} KB`;
    }

    async function readOfflineAudioStorage() {
      if (!window.LexiAudioStorage) throw new Error('Offline audio storage module is unavailable.');
      await window.LexiAudioStorage.ready;
      return window.LexiAudioStorage.readStats();
    }

    async function clearOfflineAudioStorage() {
      if (!window.LexiAudioStorage) throw new Error('Offline audio storage module is unavailable.');
      await window.LexiAudioStorage.ready;
      if (!window.LexiMusic) throw new Error('Music is still starting.');
      return window.LexiMusic.clearDownloads();
    }

    async function refreshSettingsStatus() {
      const audioValue = document.getElementById('settingsAudioStorage');
      const totalValue = document.getElementById('settingsTotalStorage');
      const driveValue = document.getElementById('settingsDriveStatus');

      if (audioValue) {
        audioValue.textContent = 'Calculating…';
        try {
          const offline = await readOfflineAudioStorage();
          audioValue.textContent = `${offline.count} song${offline.count === 1 ? '' : 's'} · ${formatBytes(offline.bytes)}`;
        } catch {
          audioValue.textContent = 'Unavailable';
        }
      }

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

    const clearOfflineButton = document.getElementById('settingsClearOfflineBtn');
    const factoryResetButton = document.getElementById('settingsFactoryResetBtn');
    const storageResult = document.getElementById('settingsStorageResult');

    clearOfflineButton?.addEventListener('click', async () => {
      clearOfflineButton.disabled = true;
      if (storageResult) storageResult.textContent = 'Checking offline storage…';

      try {
        const before = await readOfflineAudioStorage();
        if (before.count === 0 && before.bytes === 0) {
          if (storageResult) storageResult.textContent = 'Verified: 0 songs · 0 MB offline. Nothing to delete.';
          await refreshSettingsStatus();
          return;
        }

        const confirmed = confirm(
          `Delete all ${before.count} offline song${before.count === 1 ? '' : 's'} (${formatBytes(before.bytes)}) from this device?\n\n` +
          'This deletes only the downloaded audio in Lexi Music. Google Drive files and the local library list are kept.'
        );
        if (!confirmed) return;

        if (storageResult) storageResult.textContent = 'Deleting offline audio database…';
        const after = await clearOfflineAudioStorage();
        if (after.count !== 0 || after.bytes !== 0) {
          throw new Error(`Verification failed: ${after.count} audio row(s) remain.`);
        }

        sessionStorage.setItem('musicStorageClearVerified', '1');
        location.reload();
      } catch (error) {
        console.error(error);
        if (storageResult) storageResult.textContent = 'Could not verify a complete delete. No success was recorded.';
        alert('Could not fully delete and verify offline audio. Please try again.');
      } finally {
        clearOfflineButton.disabled = false;
      }
    });

    factoryResetButton?.addEventListener('click', () => {
      const confirmed = confirm(
        'Start Lexi Music brand new on this device?\n\n' +
        'This deletes ALL Lexi Music data stored on this device: the old library database, offline audio, playlists, Favorites, local settings and Music app cache.\n\n' +
        'Your Google Drive MUSIC files are NOT deleted.'
      );
      if (!confirmed) return;
      factoryResetButton.disabled = true;
      if (storageResult) storageResult.textContent = 'Opening full local reset…';
      location.href = './reset.html';
    });

    const verifiedAfterReload = sessionStorage.getItem('musicStorageClearVerified') === '1';
    if (verifiedAfterReload) {
      sessionStorage.removeItem('musicStorageClearVerified');
      if (storageResult) {
        storageResult.textContent = 'Verified: 0 songs · 0 MB offline. Dedicated audio database was reset.';
      }
      setTimeout(() => {
        const settingsButton = document.getElementById('settingsBtn');
        if (!dialog.open && settingsButton) settingsButton.click();
      }, 50);
    }

    const factoryResetVerified = sessionStorage.getItem('musicFactoryResetVerified');
    if (factoryResetVerified) {
      sessionStorage.removeItem('musicFactoryResetVerified');
      if (storageResult) storageResult.textContent = factoryResetVerified;
      setTimeout(() => {
        const settingsButton = document.getElementById('settingsBtn');
        if (!dialog.open && settingsButton) settingsButton.click();
        setTimeout(refreshSettingsStatus, 100);
      }, 50);
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

  // Compatibility for earlier HTML; current HTML declares the UI module directly.
  if (!document.querySelector('script[data-playlist-enhancements]')) {
    const script = document.createElement('script');
    script.src = './playlist-enhancements.js?v=7';
    script.dataset.playlistEnhancements = '1';
    document.head.appendChild(script);
  }
})();
