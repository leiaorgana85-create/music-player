(() => {
  'use strict';

  const DEFAULT_FOLDER_ID = '1W8s8gT5p60nOqXv_VvPy6l9uofZAog9E';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
  const SETTINGS_KEY = 'musicPwaSettings';
  const LIBRARY_KEY = 'musicPwaLibraryV2';
  const PLAYLISTS_KEY = 'musicPwaPlaylists';
  const CUSTOM_PLAYLISTS_KEY = 'musicPwaCustomPlaylists';
  const FAVORITES_KEY = 'musicPwaFavorites';
  const TOKEN_KEY = 'musicPwaGoogleAccessToken';
  const PLAYLIST_NAMES = ['GYM', 'FEEL GOOD', 'BOSSA'];
  const PLAYLIST_ALIASES = {
    GYM: ['GYM', '1 - GYM'],
    'FEEL GOOD': ['FEEL GOOD', '2 - FEEL GOOD', 'CHILL'],
    BOSSA: ['BOSSA', '3 - BOSSA', 'BOSSANOVA']
  };
  const SUPPORTED_MIMES = new Set(['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/x-flac']);

  const els = Object.fromEntries([
    'audio','connectionLabel','statusDetail','connectBtn','refreshBtn','settingsBtn','searchInput','downloadAllBtn','tabs','viewTitle','viewCount','shuffleBtn','selectBtn','downloadViewBtn','bulkBar','selectedCount','bulkSelectAllBtn','bulkDeselectAllBtn','bulkAddBtn','bulkRemoveBtn','bulkRemoveDownloadBtn','bulkCancelBtn','progressMessage','trackList','emptyState','player','nowTitle','nowMeta','nowStatus','playerFavoriteBtn','playerPlaylistBtn','seek','prevBtn','playBtn','nextBtn','repeatBtn','playlistDialog','playlistDialogTitle','playlistChoices','savePlaylistsBtn','settingsDialog','settingsForm','clientIdInput','folderIdInput','exportBackupBtn','importBackupBtn','backupFileInput','saveSettingsBtn','trackTemplate'
  ].map(id => [id, document.getElementById(id)]));

  function ensureSelectionControls() {
    if (!els.bulkBar || (els.bulkSelectAllBtn && els.bulkDeselectAllBtn)) return;
    const actions = els.bulkBar.querySelector('.bulk-actions');
    if (!actions) return;
    if (!els.bulkSelectAllBtn) {
      const button = document.createElement('button');
      button.id = 'bulkSelectAllBtn';
      button.className = 'button secondary compact-button';
      button.textContent = 'Select all';
      actions.insertBefore(button, els.bulkAddBtn || actions.firstElementChild);
      els.bulkSelectAllBtn = button;
    }
    if (!els.bulkDeselectAllBtn) {
      const button = document.createElement('button');
      button.id = 'bulkDeselectAllBtn';
      button.className = 'button secondary compact-button';
      button.textContent = 'Deselect all';
      actions.insertBefore(button, els.bulkAddBtn || null);
      els.bulkDeselectAllBtn = button;
    }
  }
  ensureSelectionControls();

  let library = [];
  let offlineIds = new Set();
  let offlineBytes = 0;
  let playlists = loadPlaylists();
  let favorites = loadFavorites();
  let settings = loadSettings();
  let accessToken = readCachedToken();
  let tokenClient = null;
  let googleReady = !!window.google?.accounts?.oauth2?.initTokenClient;
  let currentView = 'GYM';
  let currentTrackId = null;
  let currentObjectUrl = null;
  let currentArtworkUrl = null;
  let queue = [];
  let shuffle = true;
  let repeatMode = 'all';
  let dialogTrackIds = [];
  let dialogMode = 'single';
  let seekDragging = false;
  let selectionMode = false;
  let selectedIds = new Set();

  function safeJson(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function loadSettings() {
    const saved = safeJson(localStorage.getItem(SETTINGS_KEY) || '{}', {});
    return { clientId: '', folderId: DEFAULT_FOLDER_ID, ...(saved || {}) };
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function readLibrary() {
    const saved = safeJson(localStorage.getItem(LIBRARY_KEY) || '[]', []);
    return Array.isArray(saved) ? saved.filter(x => x && typeof x.id === 'string') : [];
  }

  function saveLibrary() {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  }

  function upsertLibraryTrack(track) {
    const index = library.findIndex(x => x.id === track.id);
    if (index >= 0) library[index] = track;
    else library.push(track);
    saveLibrary();
  }

  function deleteLibraryTrack(id) {
    library = library.filter(track => track.id !== id);
    saveLibrary();
  }

  function loadPlaylists() {
    try {
      const saved = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '{}');
      const migrated = {};
      for (const name of PLAYLIST_NAMES) {
        const ids = new Set();
        for (const alias of PLAYLIST_ALIASES[name]) {
          if (Array.isArray(saved[alias])) saved[alias].forEach(id => ids.add(id));
        }
        migrated[name] = [...ids];
      }
      localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(migrated));
      return migrated;
    } catch {
      return Object.fromEntries(PLAYLIST_NAMES.map(name => [name, []]));
    }
  }

  function savePlaylists() {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  }

  function loadCustomPlaylists() {
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_PLAYLISTS_KEY) || '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  }

  function playlistIds(name) {
    if (PLAYLIST_NAMES.includes(name)) return Array.isArray(playlists[name]) ? playlists[name] : [];
    const custom = loadCustomPlaylists();
    return Array.isArray(custom[name]) ? custom[name] : [];
  }

  function saveCustomPlaylist(name, ids) {
    const custom = loadCustomPlaylists();
    if (!Object.prototype.hasOwnProperty.call(custom, name)) return false;
    custom[name] = [...new Set((ids || []).filter(id => typeof id === 'string'))];
    localStorage.setItem(CUSTOM_PLAYLISTS_KEY, JSON.stringify(custom));
    return true;
  }

  function loadFavorites() {
    try {
      const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      return Array.isArray(saved) ? [...new Set(saved.filter(id => typeof id === 'string'))] : [];
    } catch {
      return [];
    }
  }

  function saveFavorites() {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }

  function isFavorite(id) {
    return favorites.includes(id);
  }

  function toggleFavorite(id) {
    if (!id) return;
    favorites = isFavorite(id) ? favorites.filter(x => x !== id) : [...favorites, id];
    saveFavorites();
    updatePlayerFavoriteButton();
    render();
  }

  function readCachedToken() {
    const record = safeJson(localStorage.getItem(TOKEN_KEY) || 'null', null);
    if (!record?.token || !Number.isFinite(record.expiresAt)) return null;
    if (record.expiresAt <= Date.now() + 60_000) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return record.token;
  }

  function saveCachedToken(response) {
    if (!response?.access_token) return;
    const expiresIn = Math.max(60, Number(response.expires_in || 3600));
    accessToken = response.access_token;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      token: response.access_token,
      expiresAt: Date.now() + expiresIn * 1000
    }));
  }

  function invalidateToken() {
    accessToken = null;
    localStorage.removeItem(TOKEN_KEY);
    updateUtilityActions();
  }

  function audioStorage() {
    if (!window.LexiAudioStorage) throw new Error('Offline audio storage module is unavailable.');
    return window.LexiAudioStorage;
  }

  async function audioGet(id) {
    const storage = audioStorage();
    await storage.ready;
    return storage.get(id);
  }

  async function audioPut(value) {
    const storage = audioStorage();
    await storage.ready;
    return storage.put(value);
  }

  async function audioDelete(id) {
    const storage = audioStorage();
    await storage.ready;
    return storage.deleteKey(id);
  }

  function cleanTitle(name) {
    return String(name || '').replace(/\.(mp3|m4a|aac|flac|wav)$/i, '');
  }

  function bytes(n) {
    const x = Number(n || 0);
    if (!x) return '0 KB';
    if (x >= 1024 ** 3) return `${(x / 1024 ** 3).toFixed(2)} GB`;
    if (x >= 1024 ** 2) return `${(x / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.round(x / 1024)} KB`;
  }

  function audioValueSize(value) {
    if (!value) return 0;
    if (value.__musicBytes instanceof ArrayBuffer) return value.__musicBytes.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
    return 0;
  }

  function audioRowIsCurrent(track, row) {
    if (!track || !row?.blob) return false;
    const actualSize = audioValueSize(row.blob);
    if (actualSize <= 0) return false;
    const expectedSize = Number(track.size || 0);
    if (expectedSize > 0 && actualSize !== expectedSize) return false;
    const trackModified = String(track.modifiedTime || '');
    const rowModified = String(row.modifiedTime || '');
    if (trackModified && rowModified && trackModified !== rowModified) return false;
    return true;
  }

  async function responseToAudioValue(response) {
    const type = response.headers.get('content-type') || 'application/octet-stream';
    return { __musicBytes: await response.arrayBuffer(), type };
  }

  function audioObjectUrl(value) {
    if (value?.__musicBytes instanceof ArrayBuffer) {
      return URL.createObjectURL(new Blob([value.__musicBytes], { type: value.type || 'application/octet-stream' }));
    }
    return URL.createObjectURL(value);
  }

  function displayTitle(track) {
    return track?.metadata?.title || track?.title || cleanTitle(track?.name || '');
  }

  function displayArtist(track) {
    return track?.metadata?.artist || '';
  }

  function displayAlbum(track) {
    return track?.metadata?.album || '';
  }

  function displayMeta(track) {
    return [displayArtist(track), displayAlbum(track)].filter(Boolean).join(' • ');
  }

  function newestTimestamp(track) {
    return Date.parse(track.createdTime || track.modifiedTime || '') || 0;
  }

  function sortLibrary() {
    library.sort((a, b) => newestTimestamp(b) - newestTimestamp(a) || String(a.name || '').localeCompare(String(b.name || '')));
  }

  function setStatus(title, detail = '') {
    if (els.connectionLabel) els.connectionLabel.textContent = title;
    if (els.statusDetail) els.statusDetail.textContent = detail;
    updateUtilityActions();
  }

  function statusDetail() {
    return `${library.length} songs`;
  }

  function updateUtilityActions() {
    const online = navigator.onLine;
    if (els.connectBtn) els.connectBtn.classList.add('hidden');
    if (els.refreshBtn) els.refreshBtn.disabled = !online;
    if (els.downloadAllBtn) els.downloadAllBtn.classList.toggle('hidden', !library.length || offlineIds.size >= library.length);
  }

  function showProgress(text = '') {
    if (!els.progressMessage) return;
    els.progressMessage.textContent = text;
    els.progressMessage.classList.toggle('hidden', !text);
  }

  function rebuildOfflineState() {
    const index = audioStorage().getIndex?.() || {};
    const byId = new Map(library.map(track => [track.id, track]));
    offlineIds = new Set();
    offlineBytes = 0;
    for (const [id, meta] of Object.entries(index)) {
      const track = byId.get(id);
      const size = Number(meta?.size || 0);
      if (!track || size <= 0) continue;
      const trackModified = String(track.modifiedTime || '');
      const rowModified = String(meta?.modifiedTime || '');
      if (trackModified && rowModified && trackModified !== rowModified) continue;
      const expectedSize = Number(track.size || 0);
      if (expectedSize > 0 && expectedSize !== size) continue;
      offlineIds.add(id);
      offlineBytes += size;
    }
  }

  async function loadSavedLibrary() {
    library = readLibrary();
    sortLibrary();
    rebuildOfflineState();
    render();
    setStatus(navigator.onLine ? (accessToken ? 'Google Drive connected' : 'Library ready') : 'Offline mode', statusDetail());
  }

  function preloadGoogleIdentity() {
    if (window.google?.accounts?.oauth2?.initTokenClient) {
      googleReady = true;
      return;
    }
    let script = document.querySelector('script[data-google-identity]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = '1';
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => { googleReady = true; }, { once: true });
    script.addEventListener('error', () => { googleReady = false; }, { once: true });
  }

  function requestTokenFromRefreshTap() {
    if (!navigator.onLine) return;
    if (!settings.clientId) {
      setStatus('Drive setup required', 'Open Settings and add the Google OAuth Client ID.');
      return;
    }
    if (!googleReady || !window.google?.accounts?.oauth2?.initTokenClient) {
      preloadGoogleIdentity();
      setStatus('Preparing Google sign-in…', 'Tap Refresh again in a moment.');
      return;
    }

    setStatus('Connecting to Google Drive…', 'Authorize the Google account if prompted.');
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: settings.clientId,
      scope: DRIVE_SCOPE,
      callback: async response => {
        if (response?.error || !response?.access_token) {
          setStatus('Google Drive authorization needed', 'Tap Refresh to try again.');
          return;
        }
        saveCachedToken(response);
        updateUtilityActions();
        await refreshFromDrive();
      },
      error_callback: error => {
        const type = String(error?.type || '');
        setStatus('Google Drive connection not completed', type === 'popup_closed'
          ? 'Google sign-in was closed. Tap Refresh when ready.'
          : 'Google sign-in could not open. Tap Refresh again.');
      }
    });

    // Only this direct Refresh-tap path may open a Google popup.
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  async function driveFetch(url, options = {}) {
    if (!accessToken) throw new Error('Google Drive authorization is needed. Tap Refresh to connect.');
    const res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` }
    });
    if (res.status === 401) {
      invalidateToken();
      throw new Error('Google Drive authorization expired. Tap Refresh to reconnect.');
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message || ''; } catch {}
      throw new Error(detail || `Drive request failed (${res.status}).`);
    }
    return res;
  }

  async function listDriveFolder() {
    const folderId = settings.folderId || DEFAULT_FOLDER_ID;
    const result = [];
    let pageToken = '';
    do {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime)');
      const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&orderBy=name${page}`;
      const json = await (await driveFetch(url)).json();
      result.push(...(json.files || []));
      pageToken = json.nextPageToken || '';
    } while (pageToken);
    return result.filter(file => SUPPORTED_MIMES.has(file.mimeType) || /\.(mp3|m4a|aac|flac)$/i.test(file.name));
  }

  function cleanupCollections(removedIds) {
    if (!removedIds.length) return;
    const removed = new Set(removedIds);
    for (const name of PLAYLIST_NAMES) playlists[name] = playlists[name].filter(id => !removed.has(id));
    savePlaylists();
    favorites = favorites.filter(id => !removed.has(id));
    saveFavorites();

    const custom = loadCustomPlaylists();
    let changed = false;
    for (const name of Object.keys(custom)) {
      if (!Array.isArray(custom[name])) continue;
      const next = custom[name].filter(id => !removed.has(id));
      if (next.length !== custom[name].length) {
        custom[name] = next;
        changed = true;
      }
    }
    if (changed) localStorage.setItem(CUSTOM_PLAYLISTS_KEY, JSON.stringify(custom));
  }

  async function refreshFromDrive() {
    if (!navigator.onLine) return alert('You are offline. Your downloaded songs are still available.');
    if (!accessToken) {
      requestTokenFromRefreshTap();
      return;
    }

    try {
      showProgress('Refreshing from Google Drive…');
      const incoming = await listDriveFolder();
      if (!incoming.length) throw new Error('Drive returned no songs. Nothing was changed.');

      const oldMap = new Map(library.map(track => [track.id, track]));
      const incomingIds = new Set(incoming.map(file => file.id));
      const removedIds = library.filter(track => !incomingIds.has(track.id)).map(track => track.id);

      for (const id of removedIds) {
        try { await audioDelete(id); } catch (error) { console.warn('Could not remove deleted Drive audio row', id, error); }
        deleteLibraryTrack(id);
      }
      cleanupCollections(removedIds);

      for (const file of incoming) {
        const old = oldMap.get(file.id);
        const nextModifiedTime = file.modifiedTime || old?.modifiedTime || null;
        const sameRevision = !!old && old.modifiedTime === nextModifiedTime;
        upsertLibraryTrack({
          id: file.id,
          name: file.name,
          title: cleanTitle(file.name),
          mimeType: file.mimeType,
          size: Number(file.size || 0),
          createdTime: file.createdTime || old?.createdTime || null,
          modifiedTime: nextModifiedTime,
          metadata: sameRevision ? old?.metadata || null : null,
          metadataScanned: sameRevision ? !!old?.metadataScanned : false
        });
      }

      library = readLibrary();
      sortLibrary();
      saveLibrary();
      rebuildOfflineState();

      if (currentTrackId && removedIds.includes(currentTrackId)) {
        try { els.audio.pause(); } catch {}
        els.audio.removeAttribute('src');
        currentTrackId = null;
        els.player.classList.add('hidden');
      }

      render();
      setStatus('Google Drive connected', statusDetail());
      showProgress(removedIds.length
        ? `Updated. ${incoming.length} songs in Drive; removed ${removedIds.length} deleted song${removedIds.length === 1 ? '' : 's'} from this device.`
        : `Updated. ${incoming.length} songs in Drive.`);
      setTimeout(() => showProgress(''), 2500);
    } catch (error) {
      console.error(error);
      showProgress('');
      alert(error.message);
    }
  }

  async function applyEmbeddedMetadata(track, audioValue, includeArtwork = false) {
    if (!track || !audioValue || !window.MusicMetadata?.parse) return {};
    const parsed = await window.MusicMetadata.parse(audioValue, track.mimeType || '', includeArtwork);
    const metadata = {
      title: parsed.title || track.metadata?.title || '',
      artist: parsed.artist || track.metadata?.artist || '',
      album: parsed.album || track.metadata?.album || ''
    };
    const hasText = metadata.title || metadata.artist || metadata.album;
    const changed = !track.metadataScanned || (hasText && JSON.stringify(metadata) !== JSON.stringify(track.metadata || {}));
    track.metadataScanned = true;
    if (hasText) track.metadata = metadata;
    if (changed) upsertLibraryTrack(track);
    return parsed;
  }

  async function downloadTrack(track, quiet = false) {
    if (offlineIds.has(track.id)) return;
    if (!navigator.onLine) throw new Error('Connect to the internet to download songs.');
    if (!accessToken) throw new Error('Tap Refresh first to connect Google Drive.');
    if (!quiet) showProgress(`Downloading ${displayTitle(track)}…`);

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(track.id)}?alt=media`;
    const response = await driveFetch(url);
    const audioValue = await responseToAudioValue(response);
    const actualSize = audioValueSize(audioValue);
    const expectedSize = Number(track.size || 0);
    if (actualSize <= 0 || (expectedSize > 0 && actualSize !== expectedSize)) {
      throw new Error(`Download verification failed for ${displayTitle(track)}. The existing offline copy was kept.`);
    }

    await audioPut({ id: track.id, blob: audioValue, modifiedTime: track.modifiedTime || null });
    offlineIds.add(track.id);
    offlineBytes += actualSize;
    await applyEmbeddedMetadata(track, audioValue, false);
    render();

    if (!quiet) {
      showProgress(`${displayTitle(track)} is available offline.`);
      setTimeout(() => showProgress(''), 1800);
    }
  }

  async function downloadTracks(tracks, doneMessage) {
    const todo = tracks.filter(track => !offlineIds.has(track.id));
    if (!todo.length) {
      showProgress('Everything in this view is already downloaded.');
      setTimeout(() => showProgress(''), 1800);
      return;
    }
    if (!navigator.onLine) return alert('Connect to the internet to download songs.');
    if (!accessToken) return alert('Tap Refresh first to connect Google Drive.');
    if (navigator.storage?.persist) {
      try { await navigator.storage.persist(); } catch {}
    }

    try {
      for (let i = 0; i < todo.length; i++) {
        showProgress(`Downloading ${i + 1} of ${todo.length}: ${displayTitle(todo[i])}`);
        await downloadTrack(todo[i], true);
      }
      setStatus('Google Drive connected', statusDetail());
      showProgress(doneMessage || `Offline ready: ${offlineIds.size} songs • ${bytes(offlineBytes)}.`);
      setTimeout(() => showProgress(''), 2500);
    } catch (error) {
      console.error(error);
      showProgress('');
      alert(error.message);
    }
  }

  async function downloadAll() {
    if (library.length) await downloadTracks(library, `Offline ready: ${library.length} songs available on this device.`);
  }

  async function downloadCurrentView() {
    const rows = currentTracks();
    if (!rows.length) return;
    const label = currentView === 'FAVORITES' ? 'Favorites' : currentView;
    await downloadTracks(rows, `${label} is available offline.`);
  }

  function currentTracks() {
    let rows;
    if (currentView === 'ALL') rows = [...library];
    else if (currentView === 'DOWNLOADED') rows = library.filter(track => offlineIds.has(track.id));
    else if (currentView === 'FAVORITES') rows = favorites.map(id => library.find(track => track.id === id)).filter(Boolean);
    else rows = playlistIds(currentView).map(id => library.find(track => track.id === id)).filter(Boolean);

    const q = (els.searchInput?.value || '').trim().toLowerCase();
    if (q) rows = rows.filter(track => [displayTitle(track), displayArtist(track), displayAlbum(track)].join(' ').toLowerCase().includes(q));
    return rows;
  }

  function updateBulkBar() {
    const hasDownloadedSelection = [...selectedIds].some(id => offlineIds.has(id));
    const visibleIds = currentTracks().map(track => track.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
    els.selectedCount.textContent = `${selectedIds.size} selected`;
    els.bulkBar.classList.toggle('hidden', !selectionMode);
    if (els.bulkSelectAllBtn) els.bulkSelectAllBtn.disabled = !visibleIds.length || allVisibleSelected;
    if (els.bulkDeselectAllBtn) els.bulkDeselectAllBtn.disabled = !selectedIds.size;
    els.bulkRemoveBtn.classList.toggle('hidden', currentView === 'ALL' || currentView === 'DOWNLOADED');
    els.bulkRemoveBtn.textContent = currentView === 'FAVORITES' ? 'Remove favorite' : 'Remove from playlist';
    els.bulkRemoveDownloadBtn.classList.toggle('hidden', !hasDownloadedSelection);
    els.selectBtn.textContent = selectionMode ? 'Done' : 'Select';
  }

  function setSelectionMode(on) {
    selectionMode = on;
    if (!on) selectedIds.clear();
    updateBulkBar();
    render();
  }

  function toggleSelection(id) {
    selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
    updateBulkBar();
    render();
  }

  function selectAllVisible() {
    currentTracks().forEach(track => selectedIds.add(track.id));
    updateBulkBar();
    render();
  }

  function deselectAll() {
    selectedIds.clear();
    updateBulkBar();
    render();
  }

  function viewTitle() {
    if (currentView === 'ALL') return 'All songs';
    if (currentView === 'DOWNLOADED') return 'Downloaded';
    if (currentView === 'FAVORITES') return 'Favorites';
    return currentView;
  }

  function render() {
    updateUtilityActions();
    if (selectionMode) updateBulkBar();
    const rows = currentTracks();
    els.viewTitle.textContent = viewTitle();
    els.viewCount.textContent = currentView === 'DOWNLOADED'
      ? `${rows.length} song${rows.length === 1 ? '' : 's'} • ${bytes(offlineBytes)} offline audio`
      : `${rows.length} song${rows.length === 1 ? '' : 's'}`;
    els.downloadViewBtn.classList.toggle('hidden', currentView === 'ALL' || currentView === 'DOWNLOADED');
    els.trackList.innerHTML = '';
    els.emptyState.classList.toggle('hidden', rows.length > 0);

    rows.forEach((track, index) => {
      const node = els.trackTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.id = track.id;
      if (track.id === currentTrackId) node.classList.add('playing');
      if (selectionMode) node.classList.add('selecting');
      if (selectedIds.has(track.id)) node.classList.add('selected');
      node.querySelector('.track-index').textContent = index + 1;
      node.querySelector('.track-title').textContent = displayTitle(track);
      node.querySelector('.track-meta').textContent = displayMeta(track);

      const favoriteButton = node.querySelector('.track-favorite');
      favoriteButton.textContent = isFavorite(track.id) ? '♥' : '♡';
      favoriteButton.classList.toggle('active', isFavorite(track.id));
      favoriteButton.setAttribute('aria-label', isFavorite(track.id) ? 'Remove from Favorites' : 'Add to Favorites');
      const offlineBadge = node.querySelector('.offline-badge');
      offlineBadge.textContent = '✓';
      offlineBadge.classList.toggle('visible', offlineIds.has(track.id));
      node.querySelector('.select-glyph').textContent = selectedIds.has(track.id) ? '✓' : '○';

      const primaryAction = () => selectionMode ? toggleSelection(track.id) : playTrack(track.id);
      node.querySelector('.track-play').addEventListener('click', primaryAction);
      node.querySelector('.track-body').addEventListener('click', primaryAction);
      favoriteButton.addEventListener('click', () => selectionMode ? toggleSelection(track.id) : toggleFavorite(track.id));
      node.querySelector('.track-menu').addEventListener('click', () => {
        if (selectionMode) toggleSelection(track.id);
        else openPlaylistDialog([track.id], 'single');
      });
      els.trackList.appendChild(node);
    });
  }

  function shuffled(ids) {
    const copy = [...ids];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function buildQueue(trackId) {
    let ids = currentTracks().map(track => track.id);
    if (!ids.includes(trackId)) ids = library.map(track => track.id);
    const rest = ids.filter(id => id !== trackId);
    queue = [trackId, ...(shuffle ? shuffled(rest) : rest)];
  }

  function queueIndex() {
    return queue.indexOf(currentTrackId);
  }

  async function sourceForTrack(track) {
    const cached = await audioGet(track.id);
    if (audioRowIsCurrent(track, cached)) {
      return { url: audioObjectUrl(cached.blob), offline: true, stale: false, blob: cached.blob };
    }
    if (cached?.blob && (!navigator.onLine || !accessToken)) {
      return { url: audioObjectUrl(cached.blob), offline: true, stale: true, blob: cached.blob };
    }
    if (!navigator.onLine) throw new Error('This song is not downloaded. Connect to the internet or download it before the flight.');
    if (!accessToken) throw new Error('Tap Refresh first to connect Google Drive.');

    showProgress(`Loading ${displayTitle(track)} from Drive…`);
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(track.id)}?alt=media`;
    const audioValue = await responseToAudioValue(await driveFetch(url));
    showProgress('');
    return { url: audioObjectUrl(audioValue), offline: false, stale: false, blob: audioValue };
  }

  function setCurrentArtwork(parsed) {
    if (currentArtworkUrl) URL.revokeObjectURL(currentArtworkUrl);
    currentArtworkUrl = null;
    if (!parsed?.artwork?.bytes?.length) return null;
    try {
      currentArtworkUrl = URL.createObjectURL(new Blob([parsed.artwork.bytes], { type: parsed.artwork.mime || 'image/jpeg' }));
      return currentArtworkUrl;
    } catch {
      return null;
    }
  }

  async function playTrack(id, preserveQueue = false) {
    const track = library.find(item => item.id === id);
    if (!track) return;
    try {
      if (!preserveQueue) buildQueue(id);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      const source = await sourceForTrack(track);
      const parsed = source.stale && window.MusicMetadata?.parse
        ? await window.MusicMetadata.parse(source.blob, track.mimeType || '', true)
        : await applyEmbeddedMetadata(track, source.blob, true);
      const artworkUrl = setCurrentArtwork(parsed);
      currentObjectUrl = source.url;
      currentTrackId = id;
      els.audio.src = source.url;
      els.nowTitle.textContent = displayTitle(track);
      els.nowMeta.textContent = [displayArtist(track), displayAlbum(track)].filter(Boolean).join(' • ');
      els.nowMeta.classList.toggle('hidden', !els.nowMeta.textContent);
      els.nowStatus.textContent = source.stale ? 'Playing saved older copy' : source.offline ? 'Playing offline' : 'Playing from Drive';
      els.player.classList.remove('hidden');
      updatePlayerFavoriteButton();
      updateMediaSession(track, artworkUrl, parsed?.artwork?.mime || 'image/jpeg');
      render();
      await els.audio.play();
    } catch (error) {
      console.error(error);
      showProgress('');
      alert(error.message);
    }
  }

  function updateMediaSession(track, artworkUrl = currentArtworkUrl, artworkMime = 'image/jpeg') {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: displayTitle(track),
        artist: displayArtist(track) || 'MUSIC',
        album: displayAlbum(track) || (currentView === 'ALL' ? 'Library' : viewTitle()),
        artwork: artworkUrl ? [{ src: artworkUrl, type: artworkMime }] : []
      });
    } catch {}
  }

  function nextTrack(auto = false) {
    if (!queue.length) return;
    if (auto && repeatMode === 'one') return playTrack(currentTrackId, true);
    const index = queueIndex();
    if (index >= 0 && index < queue.length - 1) return playTrack(queue[index + 1], true);
    if (repeatMode !== 'all') return;
    if (shuffle && queue.length > 1) {
      const rest = shuffled(queue.filter(id => id !== currentTrackId));
      queue = [currentTrackId, ...rest];
      return playTrack(queue[1], true);
    }
    return playTrack(queue[0], true);
  }

  function prevTrack() {
    if (!queue.length) return;
    if (els.audio.currentTime > 3) {
      els.audio.currentTime = 0;
      return;
    }
    const index = queueIndex();
    const id = index > 0 ? queue[index - 1] : (repeatMode === 'all' ? queue[queue.length - 1] : queue[0]);
    playTrack(id, true);
  }

  function openPlaylistDialog(trackIds, mode = 'single') {
    dialogTrackIds = [...trackIds];
    dialogMode = mode;
    els.playlistDialogTitle.textContent = mode === 'add' ? `Add ${trackIds.length} songs to playlists` : 'Song options';
    els.playlistChoices.innerHTML = '';

    for (const name of PLAYLIST_NAMES) {
      const label = document.createElement('label');
      label.className = 'playlist-choice';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = name;
      checkbox.checked = mode === 'single' && playlists[name].includes(trackIds[0]);
      const span = document.createElement('span');
      span.textContent = name;
      label.append(checkbox, span);
      els.playlistChoices.appendChild(label);
    }
    els.playlistDialog.showModal();
  }

  function saveDialogPlaylists() {
    if (!dialogTrackIds.length) return;
    const checked = new Set([...els.playlistChoices.querySelectorAll('input:checked')].map(input => input.value));
    if (dialogMode === 'add') {
      for (const name of checked) {
        if (!PLAYLIST_NAMES.includes(name)) continue;
        const set = new Set(playlists[name]);
        dialogTrackIds.forEach(id => set.add(id));
        playlists[name] = [...set];
      }
    } else {
      const id = dialogTrackIds[0];
      for (const name of PLAYLIST_NAMES) {
        const set = new Set(playlists[name]);
        checked.has(name) ? set.add(id) : set.delete(id);
        playlists[name] = [...set];
      }
    }
    savePlaylists();
    if (dialogMode === 'add') setSelectionMode(false);
    else render();
    dialogTrackIds = [];
  }

  function removeSelectedFromCurrentPlaylist() {
    if (currentView === 'ALL' || currentView === 'DOWNLOADED' || !selectedIds.size) return;
    if (currentView === 'FAVORITES') {
      favorites = favorites.filter(id => !selectedIds.has(id));
      saveFavorites();
    } else if (PLAYLIST_NAMES.includes(currentView)) {
      playlists[currentView] = playlists[currentView].filter(id => !selectedIds.has(id));
      savePlaylists();
    } else {
      saveCustomPlaylist(currentView, playlistIds(currentView).filter(id => !selectedIds.has(id)));
    }
    setSelectionMode(false);
  }

  async function removeSelectedDownloads() {
    const ids = [...selectedIds].filter(id => offlineIds.has(id));
    if (!ids.length) return;
    const noun = ids.length === 1 ? 'song' : 'songs';
    if (!confirm(`Remove the downloaded audio for ${ids.length} ${noun}?\n\nThe songs will stay in your library, playlists, and Favorites.`)) return;
    try {
      for (const id of ids) await audioDelete(id);
      rebuildOfflineState();
      selectedIds.clear();
      selectionMode = false;
      updateBulkBar();
      render();
      showProgress(`Removed ${ids.length} offline ${noun}. Library and playlists were kept.`);
      setTimeout(() => showProgress(''), 2400);
    } catch (error) {
      console.error(error);
      alert('Could not remove the selected downloads.');
    }
  }

  function updatePlayButton() {
    els.playBtn.textContent = els.audio.paused ? '▶' : '❚❚';
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = els.audio.paused ? 'paused' : 'playing'; } catch {}
    }
  }

  function updatePlayerFavoriteButton() {
    if (!els.playerFavoriteBtn) return;
    const active = !!currentTrackId && isFavorite(currentTrackId);
    els.playerFavoriteBtn.textContent = active ? '♥' : '♡';
    els.playerFavoriteBtn.classList.toggle('active', active);
    els.playerFavoriteBtn.setAttribute('aria-label', active ? 'Remove from Favorites' : 'Add to Favorites');
  }

  function updateRepeatButton() {
    const label = repeatMode === 'off' ? 'Off' : repeatMode === 'all' ? 'All' : '1';
    els.repeatBtn.textContent = `↻ ${label}`;
    els.repeatBtn.dataset.mode = repeatMode;
    els.repeatBtn.setAttribute('aria-label', repeatMode === 'off' ? 'Repeat off' : repeatMode === 'all' ? 'Repeat all' : 'Repeat one');
  }

  function cycleRepeat() {
    repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    updateRepeatButton();
  }

  function setupPlayerTimeline() {
    if (!els.seek || document.querySelector('.seek-times')) return;
    const times = document.createElement('div');
    times.className = 'seek-times';
    const current = document.createElement('span');
    const duration = document.createElement('span');
    current.textContent = '0:00';
    duration.textContent = '0:00';
    times.append(current, duration);
    els.seek.insertAdjacentElement('afterend', times);

    const formatTime = value => {
      if (!Number.isFinite(value) || value < 0) return '0:00';
      const total = Math.floor(value);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    };
    const updateTimes = () => {
      current.textContent = formatTime(els.audio.currentTime);
      duration.textContent = formatTime(els.audio.duration);
      if ('mediaSession' in navigator && Number.isFinite(els.audio.duration) && els.audio.duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: els.audio.duration,
            playbackRate: els.audio.playbackRate || 1,
            position: Math.min(els.audio.currentTime, els.audio.duration)
          });
        } catch {}
      }
    };
    els.audio.addEventListener('timeupdate', updateTimes);
    els.audio.addEventListener('loadedmetadata', updateTimes);
    els.audio.addEventListener('durationchange', updateTimes);
    els.audio.addEventListener('emptied', updateTimes);
    updateTimes();
  }

  function backupModuleUnavailable(event) {
    event?.preventDefault?.();
    alert('Playlist backup is temporarily unavailable. Reload Lexi Music and try again.');
  }

  function bindEvents() {
    els.settingsBtn.addEventListener('click', () => {
      els.clientIdInput.value = settings.clientId || '';
      els.folderIdInput.value = settings.folderId || DEFAULT_FOLDER_ID;
      els.settingsDialog.showModal();
    });

    els.saveSettingsBtn.addEventListener('click', () => {
      settings.clientId = els.clientIdInput.value.trim();
      settings.folderId = els.folderIdInput.value.trim() || DEFAULT_FOLDER_ID;
      saveSettings();
      invalidateToken();
      setStatus('Drive setup saved', 'Tap Refresh to authorize Drive access.');
    });

    els.exportBackupBtn.addEventListener('click', backupModuleUnavailable);
    els.importBackupBtn.addEventListener('click', backupModuleUnavailable);
    els.connectBtn?.addEventListener('click', event => {
      event.preventDefault();
      els.refreshBtn?.click();
    });

    els.refreshBtn.addEventListener('click', () => {
      if (accessToken) refreshFromDrive();
      else requestTokenFromRefreshTap();
    });
    els.downloadAllBtn.addEventListener('click', downloadAll);
    els.downloadViewBtn.addEventListener('click', downloadCurrentView);
    els.searchInput?.addEventListener('input', render);

    els.tabs.addEventListener('click', event => {
      const tab = event.target.closest('.tab');
      if (!tab) return;
      currentView = tab.dataset.view;
      setSelectionMode(false);
      [...els.tabs.querySelectorAll('.tab')].forEach(item => item.classList.toggle('active', item === tab));
      render();
    });

    els.shuffleBtn.addEventListener('click', () => {
      shuffle = !shuffle;
      els.shuffleBtn.setAttribute('aria-pressed', String(shuffle));
      if (currentTrackId) {
        const index = queueIndex();
        const history = index >= 0 ? queue.slice(0, index + 1) : [currentTrackId];
        const future = index >= 0 ? queue.slice(index + 1) : [];
        queue = [...history, ...(shuffle ? shuffled(future) : future)];
      }
    });

    els.selectBtn.addEventListener('click', () => setSelectionMode(!selectionMode));
    els.bulkSelectAllBtn?.addEventListener('click', selectAllVisible);
    els.bulkDeselectAllBtn?.addEventListener('click', deselectAll);
    els.bulkCancelBtn.addEventListener('click', () => setSelectionMode(false));
    els.bulkAddBtn.addEventListener('click', () => {
      if (selectedIds.size) openPlaylistDialog([...selectedIds], 'add');
    });
    els.bulkRemoveBtn.addEventListener('click', removeSelectedFromCurrentPlaylist);
    els.bulkRemoveDownloadBtn.addEventListener('click', removeSelectedDownloads);

    els.playBtn.addEventListener('click', () => {
      if (!currentTrackId && library[0]) return playTrack(library[0].id);
      els.audio.paused ? els.audio.play() : els.audio.pause();
    });
    els.prevBtn.addEventListener('click', prevTrack);
    els.nextBtn.addEventListener('click', () => nextTrack(false));
    els.repeatBtn.addEventListener('click', cycleRepeat);
    els.playerFavoriteBtn.addEventListener('click', () => currentTrackId && toggleFavorite(currentTrackId));
    els.playerPlaylistBtn.addEventListener('click', () => currentTrackId && openPlaylistDialog([currentTrackId], 'single'));
    els.savePlaylistsBtn.addEventListener('click', saveDialogPlaylists);

    els.audio.addEventListener('play', updatePlayButton);
    els.audio.addEventListener('pause', updatePlayButton);
    els.audio.addEventListener('ended', () => nextTrack(true));
    els.audio.addEventListener('timeupdate', () => {
      if (seekDragging || !Number.isFinite(els.audio.duration) || els.audio.duration <= 0) return;
      els.seek.value = Math.round((els.audio.currentTime / els.audio.duration) * 1000);
    });
    els.seek.addEventListener('input', () => { seekDragging = true; });
    els.seek.addEventListener('change', () => {
      if (Number.isFinite(els.audio.duration)) els.audio.currentTime = (Number(els.seek.value) / 1000) * els.audio.duration;
      seekDragging = false;
    });

    window.addEventListener('online', () => setStatus(accessToken ? 'Google Drive connected' : 'Online', statusDetail()));
    window.addEventListener('offline', () => setStatus('Offline mode', `${offlineIds.size} downloaded songs • ${bytes(offlineBytes)}`));

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', () => els.audio.play());
        navigator.mediaSession.setActionHandler('pause', () => els.audio.pause());
        navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
        navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack(false));
        navigator.mediaSession.setActionHandler('seekto', details => {
          if (details.seekTime != null) els.audio.currentTime = details.seekTime;
        });
      } catch {}
    }
  }

  async function init() {
    bindEvents();
    setupPlayerTimeline();
    updateRepeatButton();
    updateBulkBar();
    updatePlayerFavoriteButton();
    preloadGoogleIdentity();
    await loadSavedLibrary();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(registration => {
        registration.update().catch(() => {});
      }).catch(error => console.warn('Service worker unavailable', error));
    }

    // One-time recovery path: the old library lived in a historically large
    // IndexedDB file. Do not open it. If the lightweight cache is empty and a
    // still-valid token exists from the previous app version, rebuild silently
    // from Drive. Otherwise the owner can do the same with one direct Refresh tap.
    if (!library.length && accessToken && navigator.onLine) {
      refreshFromDrive();
    } else if (!library.length) {
      setStatus('Library ready', navigator.onLine ? 'Tap Refresh to rebuild from Google Drive.' : 'Connect to the internet, then tap Refresh.');
    }
  }

  init().catch(error => {
    console.error(error);
    setStatus('Could not start app', error.message);
  });
})();