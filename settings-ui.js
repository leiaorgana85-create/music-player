(() => {
  'use strict';

  const dialog = document.getElementById('settingsDialog');
  const form = document.getElementById('settingsForm');
  const clientInput = document.getElementById('clientIdInput');
  const folderInput = document.getElementById('folderIdInput');
  const saveButton = document.getElementById('saveSettingsBtn');
  const exportButton = document.getElementById('exportBackupBtn');
  const statusLabel = document.getElementById('connectionLabel');
  const statusDetail = document.getElementById('statusDetail');
  if (!dialog || !form || !clientInput || !folderInput || !exportButton) return;

  const style = document.createElement('style');
  style.textContent = `
    #settingsDialog.settings-clean {
      width: min(390px, calc(100% - 28px));
      max-height: calc(100dvh - 56px);
      padding: 16px;
    }
    #settingsDialog.settings-clean .dialog-title { margin-bottom: 8px; }
    #settingsDialog.settings-clean .settings-section { margin-top: 14px; padding-top: 12px; }
    #settingsDialog.settings-clean .settings-section:first-of-type { margin-top: 6px; }
    #settingsDialog.settings-clean .settings-row {
      display: flex; align-items: baseline; justify-content: space-between; gap: 14px;
      padding: 6px 0; font-size: 12px;
    }
    #settingsDialog.settings-clean .settings-row-label { color: var(--muted); }
    #settingsDialog.settings-clean .settings-row-value { color: var(--text); text-align: right; font-weight: 650; }
    #settingsDialog.settings-clean .settings-note { margin: 5px 0 0; }
    #settingsDialog.settings-clean details.settings-advanced > summary {
      cursor: pointer; list-style: none; color: var(--muted); font-size: 12px; font-weight: 650;
    }
    #settingsDialog.settings-clean details.settings-advanced > summary::-webkit-details-marker { display: none; }
    #settingsDialog.settings-clean details.settings-advanced > summary::after { content: '  >'; color: #6f6f78; }
    #settingsDialog.settings-clean details.settings-advanced[open] > summary::after { content: '  v'; }
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
  storageSection.className = 'settings-section';
  storageSection.innerHTML = `
    <div class="settings-section-title">Storage</div>
    <div class="settings-row"><span class="settings-row-label">Offline audio</span><span id="settingsAudioStorage" class="settings-row-value">Calculating...</span></div>
    <div class="settings-row"><span class="settings-row-label">Total app storage</span><span id="settingsTotalStorage" class="settings-row-value">Calculating...</span></div>
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

  const firstAfterTitle = title?.nextSibling || form.firstChild;
  form.insertBefore(storageSection, firstAfterTitle);
  form.insertBefore(driveSection, backupSection || actions);

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
    if (!text || /loading/i.test(text)) return 'Calculating...';
    const parts = text.split('•').map(x => x.trim()).filter(Boolean);
    if (!parts.length) return 'Calculating...';
    let last = parts[parts.length - 1];
    last = last.replace(/\boffline\b.*$/i, '').trim();
    return last || 'Calculating...';
  }

  async function refreshSettingsStatus() {
    const audioValue = document.getElementById('settingsAudioStorage');
    const totalValue = document.getElementById('settingsTotalStorage');
    const driveValue = document.getElementById('settingsDriveStatus');

    if (audioValue) audioValue.textContent = offlineAudioText();

    if (totalValue) {
      totalValue.textContent = 'Calculating...';
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
})();