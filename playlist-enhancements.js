(() => {
  'use strict';

  const BUILTIN_PLAYLISTS = ['GYM', 'FEEL GOOD', 'BOSSA'];
  const PLAYLISTS_KEY = 'musicPwaPlaylists';
  const FAVORITES_KEY = 'musicPwaFavorites';
  const CUSTOM_KEY = 'musicPwaCustomPlaylists';
  const RESTORE_VIEW_KEY = 'musicPwaRestoreView';
  const BACKUP_VERSION = 2;

  const tabs = document.getElementById('tabs');
  const trackList = document.getElementById('trackList');
  const searchInput = document.getElementById('searchInput');
  const viewActions = document.querySelector('.view-actions');
  const selectBtn = document.getElementById('selectBtn');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const bulkBar = document.getElementById('bulkBar');
  const playlistDialog = document.getElementById('playlistDialog');
  const playlistChoices = document.getElementById('playlistChoices');
  const savePlaylistsBtn = document.getElementById('savePlaylistsBtn');
  const exportBackupBtn = document.getElementById('exportBackupBtn');
  const importBackupBtn = document.getElementById('importBackupBtn');
  const backupFileInput = document.getElementById('backupFileInput');
  const playerPlaylistBtn = document.getElementById('playerPlaylistBtn');
  const removeDeviceBtn = document.getElementById('removeDeviceBtn');
  if (!tabs || !trackList || !viewActions || !selectBtn || !shuffleBtn) return;

  let reorderMode = false;
  let reorderView = '';
  let orderDirty = false;
  let pendingDialog = { mode: 'single', ids: [] };
  let lastPlayingId = null;
  const installedAccessors = new Set();

  const style = document.createElement('style');
  style.textContent = `
    .playlist-add-tab {
      white-space: nowrap; border: 1px dashed #56565f; background: transparent; border-radius: 999px;
      padding: 7px 10px; font-size: 11px; font-weight: 700; color: #c9c9cf;
    }
    .tab.custom-playlist-tab { border-color: #70658c; color: #c9b8f2; background: rgba(112,101,140,.14); }
    .tab.custom-playlist-tab.active { background: #d2c4f5; color: #0b0b0c; border-color: #d2c4f5; }
    .playlist-order-btn.active-order { color: #0b0b0c; background: #f3f3f4; border-color: #f3f3f4; }
    .playlist-manage-dialog .field input { font-size: 14px; }
    .playlist-delete-btn { border-color: #69404a !important; color: #f0a4bd !important; }
    .track-row.plugin-reordering { grid-template-columns: 38px minmax(0,1fr) 76px; }
    .track-row.plugin-reordering .track-favorite,
    .track-row.plugin-reordering .track-menu,
    .track-row.plugin-reordering .offline-badge { display: none !important; }
    .track-row.plugin-reordering .track-play,
    .track-row.plugin-reordering .track-body { pointer-events: none; }
    .manual-order-controls { display: flex; gap: 5px; justify-content: flex-end; padding-right: 2px; }
    .manual-order-controls button {
      width: 32px; height: 32px; border-radius: 8px; border: 1px solid #3a3a40;
      background: transparent; color: #f3f3f4; font-size: 17px; line-height: 1; padding: 0;
      -webkit-appearance: none; appearance: none;
    }
    .manual-order-controls button:disabled { opacity: .22; }
    body.playlist-reordering #shuffleBtn, body.playlist-reordering #selectBtn { opacity: .35; pointer-events: none; }
    @media (max-width:560px) {
      .playlist-add-tab, .tab.custom-playlist-tab { padding: 7px 9px; font-size: 10.5px; }
      .track-row.plugin-reordering { grid-template-columns: 34px minmax(0,1fr) 72px; }
      .manual-order-controls button { width: 30px; height: 30px; }
    }
  `;
  document.head.appendChild(style);

  function safeIds(value) {
    return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string'))] : [];
  }

  function readCustom() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean = {};
      for (const [name, ids] of Object.entries(parsed)) {
        if (typeof name === 'string' && name.trim()) clean[name] = safeIds(ids);
      }
      return clean;
    } catch {
      return {};
    }
  }

  function writeCustom(data) {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(data));
  }

  function customNames() {
    return Object.keys(readCustom());
  }

  function nameKey(name) {
    return String(name || '').trim().toLocaleUpperCase();
  }

  function reservedKeys(except = '') {
    const keys = new Set(['ALL', 'FAVORITES', 'DOWNLOADED', ...BUILTIN_PLAYLISTS].map(nameKey));
    for (const name of customNames()) {
      if (name !== except) keys.add(nameKey(name));
    }
    return keys;
  }

  function validateName(raw, except = '') {
    const name = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Enter a playlist name.');
    if (name.length > 30) throw new Error('Playlist names can be up to 30 characters.');
    if (Object.prototype.hasOwnProperty.call(Object.prototype, name)) throw new Error('Please use a different playlist name.');
    if (reservedKeys(except).has(nameKey(name))) throw new Error('That playlist name is already in use.');
    return name;
  }

  function installAccessor(name) {
    if (installedAccessors.has(name)) return;
    if (Object.prototype.hasOwnProperty.call(Object.prototype, name)) return;
    Object.defineProperty(Object.prototype, name, {
      configurable: true,
      enumerable: false,
      get() {
        return safeIds(readCustom()[name]);
      },
      set(value) {
        const data = readCustom();
        data[name] = safeIds(value);
        writeCustom(data);
      }
    });
    installedAccessors.add(name);
  }

  function uninstallAccessor(name) {
    if (!installedAccessors.has(name)) return;
    try { delete Object.prototype[name]; } catch {}
    installedAccessors.delete(name);
  }

  function installAllAccessors() {
    customNames().forEach(installAccessor);
  }

  function activeView() {
    return tabs.querySelector('.tab.active')?.dataset?.view || 'GYM';
  }

  function isCustom(name) {
    return customNames().includes(name);
  }

  function isPlaylist(name) {
    return BUILTIN_PLAYLISTS.includes(name) || isCustom(name);
  }

  function renderCustomTabs() {
    tabs.querySelectorAll('.custom-playlist-tab, .playlist-add-tab').forEach(node => node.remove());
    for (const name of customNames()) {
      installAccessor(name);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab custom-playlist-tab';
      button.dataset.view = name;
      button.textContent = name;
      tabs.appendChild(button);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'playlist-add-tab';
    add.id = 'addPlaylistTab';
    add.textContent = '＋ PLAYLIST';
    add.setAttribute('aria-label', 'Create playlist');
    tabs.appendChild(add);
    updateHeaderControls();
  }

  function makeDialog(id, title) {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'dialog playlist-manage-dialog';
    dialog.innerHTML = `
      <form method="dialog">
        <div class="dialog-title">${title}</div>
        <label class="field"><span>Playlist name</span><input class="playlist-name-input" type="text" maxlength="30" autocomplete="off"></label>
        <div class="dialog-error help hidden"></div>
        <div class="dialog-actions">
          <button value="cancel" class="button secondary">Cancel</button>
          <button type="button" class="button playlist-save-name">Save</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  const newDialog = makeDialog('newPlaylistDialog', 'New playlist');
  const manageDialog = makeDialog('managePlaylistDialog', 'Playlist settings');
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'button secondary playlist-delete-btn';
  deleteBtn.textContent = 'Delete playlist';
  manageDialog.querySelector('.dialog-actions').prepend(deleteBtn);

  function showDialogError(dialog, message = '') {
    const el = dialog.querySelector('.dialog-error');
    el.textContent = message;
    el.classList.toggle('hidden', !message);
  }

  function openNewPlaylist() {
    showDialogError(newDialog, '');
    const input = newDialog.querySelector('.playlist-name-input');
    input.value = '';
    newDialog.showModal();
    setTimeout(() => input.focus(), 20);
  }

  function createPlaylist() {
    try {
      const input = newDialog.querySelector('.playlist-name-input');
      const name = validateName(input.value);
      const data = readCustom();
      data[name] = [];
      writeCustom(data);
      installAccessor(name);
      renderCustomTabs();
      newDialog.close();
      setTimeout(() => tabs.querySelector(`.custom-playlist-tab[data-view="${CSS.escape(name)}"]`)?.click(), 0);
    } catch (error) {
      showDialogError(newDialog, error.message);
    }
  }

  function openManagePlaylist() {
    const view = activeView();
    if (!isCustom(view)) return;
    showDialogError(manageDialog, '');
    const input = manageDialog.querySelector('.playlist-name-input');
    input.value = view;
    manageDialog.dataset.originalName = view;
    manageDialog.showModal();
    setTimeout(() => input.select(), 20);
  }

  function renamePlaylist() {
    const oldName = manageDialog.dataset.originalName || '';
    if (!isCustom(oldName)) return manageDialog.close();
    try {
      const input = manageDialog.querySelector('.playlist-name-input');
      const newName = validateName(input.value, oldName);
      if (newName === oldName) return manageDialog.close();
      const old = readCustom();
      const next = {};
      for (const [name, ids] of Object.entries(old)) next[name === oldName ? newName : name] = ids;
      writeCustom(next);
      uninstallAccessor(oldName);
      installAccessor(newName);
      renderCustomTabs();
      manageDialog.close();
      setTimeout(() => tabs.querySelector(`.custom-playlist-tab[data-view="${CSS.escape(newName)}"]`)?.click(), 0);
    } catch (error) {
      showDialogError(manageDialog, error.message);
    }
  }

  function deletePlaylist() {
    const name = manageDialog.dataset.originalName || '';
    if (!isCustom(name)) return;
    if (!confirm(`Delete playlist “${name}”?\n\nThe songs and offline audio will not be deleted.`)) return;
    const data = readCustom();
    delete data[name];
    writeCustom(data);
    uninstallAccessor(name);
    manageDialog.close();
    renderCustomTabs();
    tabs.querySelector('.tab[data-view="GYM"]')?.click();
  }

  newDialog.querySelector('.playlist-save-name').addEventListener('click', createPlaylist);
  manageDialog.querySelector('.playlist-save-name').addEventListener('click', renamePlaylist);
  deleteBtn.addEventListener('click', deletePlaylist);
  for (const dialog of [newDialog, manageDialog]) {
    dialog.querySelector('.playlist-name-input').addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      dialog === newDialog ? createPlaylist() : renamePlaylist();
    });
  }

  const orderBtn = document.createElement('button');
  orderBtn.type = 'button';
  orderBtn.id = 'playlistOrderBtn';
  orderBtn.className = 'small-control playlist-order-btn hidden';
  orderBtn.textContent = 'Order';

  const manageBtn = document.createElement('button');
  manageBtn.type = 'button';
  manageBtn.id = 'playlistManageBtn';
  manageBtn.className = 'small-control hidden';
  manageBtn.textContent = 'Edit';

  viewActions.insertBefore(manageBtn, selectBtn);
  viewActions.insertBefore(orderBtn, selectBtn);

  function updateHeaderControls() {
    const view = activeView();
    orderBtn.classList.toggle('hidden', !isPlaylist(view));
    manageBtn.classList.toggle('hidden', !isCustom(view));
  }

  function readBuiltinPlaylists() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeBuiltinPlaylists(data) {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(data));
  }

  function reorderStored(view, id, direction) {
    let ids;
    if (isCustom(view)) {
      const data = readCustom();
      ids = safeIds(data[view]);
      const index = ids.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ids.length) return false;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      data[view] = ids;
      writeCustom(data);
      return true;
    }
    if (BUILTIN_PLAYLISTS.includes(view)) {
      const data = readBuiltinPlaylists();
      ids = safeIds(data[view]);
      const index = ids.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ids.length) return false;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      data[view] = ids;
      writeBuiltinPlaylists(data);
      return true;
    }
    return false;
  }

  function refreshOrderControls() {
    const rows = [...trackList.querySelectorAll('.track-row')];
    rows.forEach((row, index) => {
      row.querySelector('.order-up')?.toggleAttribute('disabled', index === 0);
      row.querySelector('.order-down')?.toggleAttribute('disabled', index === rows.length - 1);
      const indexEl = row.querySelector('.track-index');
      if (indexEl) indexEl.textContent = String(index + 1);
    });
  }

  function moveRow(row, direction) {
    const id = row?.dataset?.id;
    if (!id || !reorderStored(reorderView, id, direction)) return;
    if (direction < 0) {
      const prev = row.previousElementSibling;
      if (prev) trackList.insertBefore(row, prev);
    } else {
      const next = row.nextElementSibling;
      if (next) trackList.insertBefore(next, row);
    }
    orderDirty = true;
    refreshOrderControls();
  }

  function decorateReorderRows() {
    if (!reorderMode) return;
    const rows = [...trackList.querySelectorAll('.track-row')];
    for (const row of rows) {
      row.classList.add('plugin-reordering');
      if (row.querySelector('.manual-order-controls')) continue;
      const controls = document.createElement('div');
      controls.className = 'manual-order-controls';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'order-up';
      up.textContent = '↑';
      up.setAttribute('aria-label', 'Move song up');
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'order-down';
      down.textContent = '↓';
      down.setAttribute('aria-label', 'Move song down');
      up.addEventListener('click', () => moveRow(row, -1));
      down.addEventListener('click', () => moveRow(row, 1));
      controls.append(up, down);
      row.appendChild(controls);
    }
    refreshOrderControls();
  }

  function beginReorder() {
    const view = activeView();
    if (!isPlaylist(view)) return;
    if (!bulkBar?.classList.contains('hidden')) selectBtn.click();
    if (searchInput?.value) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    reorderMode = true;
    reorderView = view;
    orderDirty = false;
    document.body.classList.add('playlist-reordering');
    orderBtn.textContent = 'Done';
    orderBtn.classList.add('active-order');
    searchInput?.setAttribute('disabled', '');
    decorateReorderRows();
  }

  function finishReorder(restoreView = reorderView) {
    if (!reorderMode) return;
    reorderMode = false;
    document.body.classList.remove('playlist-reordering');
    orderBtn.textContent = 'Order';
    orderBtn.classList.remove('active-order');
    searchInput?.removeAttribute('disabled');
    if (orderDirty) {
      sessionStorage.setItem(RESTORE_VIEW_KEY, restoreView || 'GYM');
      location.reload();
      return;
    }
    trackList.querySelectorAll('.track-row').forEach(row => {
      row.classList.remove('plugin-reordering');
      row.querySelector('.manual-order-controls')?.remove();
    });
    updateHeaderControls();
  }

  orderBtn.addEventListener('click', () => reorderMode ? finishReorder() : beginReorder());
  manageBtn.addEventListener('click', openManagePlaylist);

  tabs.addEventListener('click', event => {
    const add = event.target.closest('.playlist-add-tab');
    if (add) {
      if (reorderMode) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (orderDirty) {
          sessionStorage.setItem(RESTORE_VIEW_KEY, reorderView || 'GYM');
          location.reload();
        } else {
          finishReorder();
          openNewPlaylist();
        }
        return;
      }
      openNewPlaylist();
      return;
    }
    const tab = event.target.closest('.tab[data-view]');
    if (!tab) return;
    if (reorderMode && tab.dataset.view !== reorderView) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const targetView = tab.dataset.view;
      if (orderDirty) {
        sessionStorage.setItem(RESTORE_VIEW_KEY, targetView);
        location.reload();
      } else {
        finishReorder();
        setTimeout(() => tabs.querySelector(`.tab[data-view="${CSS.escape(targetView)}"]`)?.click(), 0);
      }
      return;
    }
    setTimeout(updateHeaderControls, 0);
  }, true);

  const listObserver = new MutationObserver(() => {
    const playing = trackList.querySelector('.track-row.playing');
    if (playing?.dataset?.id) lastPlayingId = playing.dataset.id;
    if (reorderMode) requestAnimationFrame(decorateReorderRows);
  });
  listObserver.observe(trackList, { childList: true, subtree: false });

  document.addEventListener('click', event => {
    const menu = event.target.closest('.track-menu');
    if (menu) {
      const id = menu.closest('.track-row')?.dataset?.id;
      if (id) pendingDialog = { mode: 'single', ids: [id] };
      return;
    }
    if (event.target.closest('#bulkAddBtn')) {
      const ids = [...trackList.querySelectorAll('.track-row.selected')].map(row => row.dataset.id).filter(Boolean);
      pendingDialog = { mode: 'add', ids };
      return;
    }
    if (playerPlaylistBtn && event.target.closest('#playerPlaylistBtn')) {
      const id = trackList.querySelector('.track-row.playing')?.dataset?.id || lastPlayingId;
      if (id) pendingDialog = { mode: 'single', ids: [id] };
    }
  }, true);

  function augmentPlaylistChoices() {
    if (!playlistChoices || !playlistDialog?.open) return;
    playlistChoices.querySelectorAll('.custom-playlist-choice').forEach(node => node.remove());
    const data = readCustom();
    const id = pendingDialog.ids[0];
    for (const name of Object.keys(data)) {
      const label = document.createElement('label');
      label.className = 'playlist-choice custom-playlist-choice';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = name;
      cb.dataset.customPlaylist = '1';
      cb.checked = pendingDialog.mode === 'single' && !!id && safeIds(data[name]).includes(id);
      const span = document.createElement('span');
      span.textContent = name;
      label.append(cb, span);
      playlistChoices.appendChild(label);
    }
  }

  if (playlistDialog) {
    new MutationObserver(() => {
      if (playlistDialog.open) augmentPlaylistChoices();
    }).observe(playlistDialog, { attributes: true, attributeFilter: ['open'] });
  }

  savePlaylistsBtn?.addEventListener('click', () => {
    if (!pendingDialog.ids.length) return;
    const data = readCustom();
    const checked = new Set([...playlistChoices.querySelectorAll('input[data-custom-playlist="1"]:checked')].map(cb => cb.value));
    for (const name of Object.keys(data)) {
      const set = new Set(safeIds(data[name]));
      if (pendingDialog.mode === 'add') {
        if (checked.has(name)) pendingDialog.ids.forEach(id => set.add(id));
      } else {
        const id = pendingDialog.ids[0];
        if (checked.has(name)) set.add(id); else set.delete(id);
      }
      data[name] = [...set];
    }
    writeCustom(data);
    pendingDialog = { mode: 'single', ids: [] };
  });

  removeDeviceBtn?.addEventListener('click', () => {
    const id = pendingDialog.ids[0] || trackList.querySelector('.track-row.playing')?.dataset?.id || lastPlayingId;
    if (!id) return;
    const data = readCustom();
    for (const name of Object.keys(data)) data[name] = safeIds(data[name]).filter(trackId => trackId !== id);
    writeCustom(data);
  }, true);

  async function exportEnhancedBackup(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const builtins = readBuiltinPlaylists();
    const custom = readCustom();
    const playlists = {};
    for (const name of BUILTIN_PLAYLISTS) playlists[name] = safeIds(builtins[name]);
    for (const [name, ids] of Object.entries(custom)) playlists[name] = safeIds(ids);
    let favorites = [];
    try { favorites = safeIds(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')); } catch {}
    const payload = {
      app: 'Lexi Music',
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      playlists,
      customPlaylistNames: Object.keys(custom),
      favorites
    };
    const filename = `lexi-music-playlists-${new Date().toISOString().slice(0, 10)}.json`;
    const text = JSON.stringify(payload, null, 2);
    const file = new File([text], filename, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Lexi Music playlist backup' });
        return;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importEnhancedBackup(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || !parsed.playlists) throw new Error('This is not a Lexi Music playlist backup.');
      const importedBuiltins = {};
      for (const name of BUILTIN_PLAYLISTS) importedBuiltins[name] = safeIds(parsed.playlists[name]);

      const explicitNames = Array.isArray(parsed.customPlaylistNames) ? parsed.customPlaylistNames : [];
      const inferredNames = Object.keys(parsed.playlists).filter(name => !BUILTIN_PLAYLISTS.includes(name));
      const candidates = explicitNames.length ? explicitNames : inferredNames;
      const importedCustom = {};
      for (const rawName of candidates) {
        if (typeof rawName !== 'string') continue;
        const name = rawName.trim();
        if (!name || BUILTIN_PLAYLISTS.includes(name) || ['ALL', 'FAVORITES', 'DOWNLOADED'].includes(nameKey(name))) continue;
        if (Object.prototype.hasOwnProperty.call(Object.prototype, name)) continue;
        importedCustom[name] = safeIds(parsed.playlists[name]);
      }
      const importedFavorites = safeIds(parsed.favorites);
      if (!confirm('Replace the current playlists and Favorites with this backup? Downloaded songs will not be changed.')) return;
      writeBuiltinPlaylists(importedBuiltins);
      writeCustom(importedCustom);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(importedFavorites));
      sessionStorage.setItem(RESTORE_VIEW_KEY, 'GYM');
      location.reload();
    } catch (error) {
      alert(error.message || 'Could not import this playlist backup.');
    } finally {
      backupFileInput.value = '';
    }
  }

  exportBackupBtn?.addEventListener('click', exportEnhancedBackup, true);
  importBackupBtn?.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    backupFileInput?.click();
  }, true);
  backupFileInput?.addEventListener('change', event => {
    event.stopImmediatePropagation();
    importEnhancedBackup(backupFileInput.files?.[0]);
  }, true);

  installAllAccessors();
  renderCustomTabs();

  const restore = sessionStorage.getItem(RESTORE_VIEW_KEY);
  if (restore) {
    sessionStorage.removeItem(RESTORE_VIEW_KEY);
    setTimeout(() => tabs.querySelector(`.tab[data-view="${CSS.escape(restore)}"]`)?.click(), 30);
  } else {
    updateHeaderControls();
  }
})();