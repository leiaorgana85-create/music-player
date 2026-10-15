(() => {
  'use strict';

  const DEFAULT_FOLDER_ID = '1W8s8gT5p60nOqXv_VvPy6l9uofZAog9E';
  const PLAYLIST_NAMES = ['GYM', 'FEEL GOOD', 'BOSSA'];
  const PLAYLIST_ALIASES = {
    'GYM': ['GYM', '1 - GYM'],
    'FEEL GOOD': ['FEEL GOOD', '2 - FEEL GOOD', 'CHILL'],
    'BOSSA': ['BOSSA', '3 - BOSSA', 'BOSSANOVA']
  };
  const SUPPORTED_MIMES = new Set(['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/x-flac']);
  const DB_NAME = 'music-pwa-db';
  const DB_VERSION = 1;
  const SETTINGS_KEY = 'musicPwaSettings';
  const PLAYLISTS_KEY = 'musicPwaPlaylists';
  const CUSTOM_PLAYLISTS_KEY = 'musicPwaCustomPlaylists';
  const FAVORITES_KEY = 'musicPwaFavorites';
  const bootStart = window.__musicBootStart || performance.now();
  const startupTiming = {
    scriptDelay: performance.now() - bootStart,
    dbOpen: 0,
    libraryRead: 0,
    audioRead: 0,
    render: 0,
    ready: 0
  };

  const els = Object.fromEntries([
    'audio','connectionLabel','statusDetail','connectBtn','refreshBtn','settingsBtn','searchInput','downloadAllBtn','tabs','viewTitle','viewCount','shuffleBtn','selectBtn','downloadViewBtn','bulkBar','selectedCount','bulkAddBtn','bulkRemoveBtn','bulkRemoveDownloadBtn','bulkCancelBtn','progressMessage','trackList','emptyState','player','nowTitle','nowMeta','nowStatus','playerFavoriteBtn','playerPlaylistBtn','seek','prevBtn','playBtn','nextBtn','repeatBtn','playlistDialog','playlistDialogTitle','playlistChoices','savePlaylistsBtn','settingsDialog','settingsForm','clientIdInput','folderIdInput','exportBackupBtn','importBackupBtn','backupFileInput','saveSettingsBtn','trackTemplate'
  ].map(id => [id, document.getElementById(id)]));

  let db;
  let library = [];
  let offlineIds = new Set();
  let offlineBytes = 0;
  let audioRowsById = new Map();
  let playlists = loadPlaylists();
  let favorites = loadFavorites();
  let settings = loadSettings();
  let accessToken = null;
  let tokenClient = null;
  let currentView = 'GYM';
  let currentTrackId = null;
  let currentObjectUrl = null;
  let currentArtworkUrl = null;
  let queue = [];
  let shuffle = true;
  let repeatMode = 'all'; // off | all | one
  let dialogTrackIds = [];
  let dialogMode = 'single'; // single | add
  let seekDragging = false;
  let selectionMode = false;
  let selectedIds = new Set();
  let metadataScanRunning = false;

  function loadSettings() {
    try {
      return { clientId: '', folderId: DEFAULT_FOLDER_ID, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return { clientId: '', folderId: DEFAULT_FOLDER_ID };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
      return saved;
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
    if (isFavorite(id)) favorites = favorites.filter(x => x !== id);
    else favorites.push(id);
    saveFavorites();
    updatePlayerFavoriteButton();
    render();
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains('library')) idb.createObjectStore('library', { keyPath: 'id' });
        if (!idb.objectStoreNames.contains('audio')) idb.createObjectStore('audio', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function isRecoverableDbError(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || '');
    return (
      name === 'InvalidStateError' && /connection is (closing|closed)|database connection is (closing|closed)/i.test(message)
    ) || (
      name === 'UnknownError' && /indexed database server|connection to indexed database server lost/i.test(message)
    );
  }

  async function reopenDb() {
    try { db?.close(); } catch {}
    db = null;
    await new Promise(resolve => setTimeout(resolve, 0));
    db = await openDb();
    return db;
  }

  async function dbRequest(store, mode, makeRequest) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (!db) db = await openDb();
        const objectStore = db.transaction(store, mode).objectStore(store);
        return await reqP(makeRequest(objectStore));
      } catch (error) {
        if (attempt === 0 && isRecoverableDbError(error)) {
          await reopenDb();
          continue;
        }
        throw error;
      }
    }
    throw new Error('IndexedDB request failed.');
  }

  async function dbGetAll(store) { return dbRequest(store, 'readonly', objectStore => objectStore.getAll()); }
  async function dbGet(store, key) { return dbRequest(store, 'readonly', objectStore => objectStore.get(key)); }
  async function dbPut(store, value) { return dbRequest(store, 'readwrite', objectStore => objectStore.put(value)); }
  async function dbDelete(store, key) { return dbRequest(store, 'readwrite', objectStore => objectStore.delete(key)); }

  function cleanTitle(name) {
    return name.replace(/\.(mp3|m4a|aac|flac|wav)$/i, '');
  }

  function bytes(n) {
    const x = Number(n || 0);
    if (!x) return '0 KB';
    if (x >= 1024 * 1024 * 1024) return `${(x / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (x >= 1024 * 1024) return `${(x / 1024 / 1024).toFixed(1)} MB`;
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
    const tags = [displayArtist(track), displayAlbum(track)].filter(Boolean);
    if (tags.length) return tags.join(' • ');
    return [track?.size ? bytes(track.size) : '', offlineIds.has(track?.id) ? 'Offline' : 'Drive'].filter(Boolean).join(' • ');
  }

  function newestTimestamp(track) {
    return Date.parse(track.createdTime || track.modifiedTime || '') || 0;
  }

  function sortLibrary() {
    library.sort((a, b) => newestTimestamp(b) - newestTimestamp(a) || a.name.localeCompare(b.name));
  }

  function setStatus(title, detail) {
    els.connectionLabel.textContent = title;
    els.statusDetail.textContent = detail;
  }

  function statusDetail() {
    return `${library.length} songs • ${offlineIds.size} downloaded • ${bytes(offlineBytes)} offline`;
  }

  function showProgress(text = '') {
    els.progressMessage.textContent = text;
    els.progressMessage.classList.toggle('hidden', !text);
  }

  async function loadSavedLibrary(timing = null) {
    let mark = performance.now();
    library = await dbGetAll('library');
    sortLibrary();
    if (timing) timing.libraryRead = performance.now() - mark;

    mark = performance.now();
    const audioRows = await dbGetAll('audio');
    audioRowsById = new Map(audioRows.map(row => [row.id, row]));
    const libraryById = new Map(library.map(track => [track.id, track]));
    const currentRows = audioRows.filter(row => audioRowIsCurrent(libraryById.get(row.id), row));
    offlineIds = new Set(currentRows.map(row => row.id));
    offlineBytes = currentRows.reduce((sum, row) => sum + audioValueSize(row.blob), 0);
    if (timing) timing.audioRead = performance.now() - mark;

    mark = performance.now();
    render();
    if (timing) timing.render = performance.now() - mark;

    setStatus(navigator.onLine ? 'Saved library' : 'Offline mode', statusDetail());
  }

  async function loadGoogleIdentity() {
    if (window.google?.accounts?.oauth2) return;
    if (!navigator.onLine) throw new Error('You are offline. Connect to the internet to sign in.');
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-google-identity]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.dataset.googleIdentity = '1';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load Google sign-in.'));
      document.head.appendChild(s);
    });
  }

  async function ensureToken(interactive = true) {
    if (accessToken) return accessToken;
    if (!settings.clientId) throw new Error('Open Settings and add your Google OAuth Client ID first.');
    await loadGoogleIdentity();
    return new Promise((resolve, reject) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: settings.clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: response => {
          if (response.error) return reject(new Error(response.error_description || response.error));
          accessToken = response.access_token;
          els.refreshBtn.disabled = false;
          resolve(accessToken);
        },
        error_callback: err => reject(new Error(err?.message || 'Google sign-in failed.'))
      });
      tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    });
  }

  async function driveFetch(url, options = {}) {
    const token = await ensureToken(false).catch(() => ensureToken(true));
    let res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) {
      accessToken = null;
      const fresh = await ensureToken(true);
      res = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${fresh}` }
      });
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
    return result.filter(f => SUPPORTED_MIMES.has(f.mimeType) || /\.(mp3|m4a|aac|flac)$/i.test(f.name));
  }

  async function refreshFromDrive() {
    if (!navigator.onLine) return alert('You are offline. Your downloaded songs are still available.');
    try {
      showProgress('Refreshing from Google Drive…');
      const incoming = await listDriveFolder();
      if (!incoming.length) throw new Error('Drive returned no songs. Nothing was changed.');
      const oldMap = new Map(library.map(x => [x.id, x]));

      // Merge only. A partial or transient Drive listing must never delete local
      // library rows, offline audio, playlist membership, favorites, or saved tags.
      for (const f of incoming) {
        const old = oldMap.get(f.id);
        const sameRevision = !!old && old.modifiedTime === (f.modifiedTime || old.modifiedTime || null);
        await dbPut('library', {
          id: f.id,
          name: f.name,
          title: cleanTitle(f.name),
          mimeType: f.mimeType,
          size: Number(f.size || 0),
          createdTime: f.createdTime || old?.createdTime || null,
          modifiedTime: f.modifiedTime || old?.modifiedTime || null,
          metadata: sameRevision ? old?.metadata || null : null,
          metadataScanned: sameRevision ? !!old?.metadataScanned : false
        });
      }
      await loadSavedLibrary();
      setStatus('Google Drive connected', statusDetail());
      showProgress(`Updated. ${incoming.length} songs received from Drive; ${library.length} kept locally.`);
      setTimeout(() => showProgress(''), 3000);
      scheduleMetadataScan();
    } catch (e) {
      console.error(e);
      showProgress('');
      alert(e.message);
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
    const changed = !track.metadataScanned ||
      (hasText && JSON.stringify(metadata) !== JSON.stringify(track.metadata || {}));

    track.metadataScanned = true;
    if (hasText) track.metadata = metadata;
    if (changed) await dbPut('library', track);
    return parsed;
  }

  async function scanDownloadedMetadata() {
    if (metadataScanRunning) return;
    metadataScanRunning = true;
    try {
      let changed = false;
      for (const track of library) {
        if (!offlineIds.has(track.id) || track.metadataScanned) continue;
        const cached = await dbGet('audio', track.id);
        if (cached?.blob) {
          await applyEmbeddedMetadata(track, cached.blob, false);
          changed = true;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (changed) render();
    } catch (error) {
      console.warn('Background metadata scan stopped', error);
    } finally {
      metadataScanRunning = false;
    }
  }

  function scheduleMetadataScan() {
    setTimeout(() => scanDownloadedMetadata(), 500);
  }

  async function downloadTrack(track, quiet = false) {
    if (offlineIds.has(track.id)) return;
    if (!navigator.onLine) throw new Error('Connect to the internet to download songs.');
    if (!quiet) showProgress(`Downloading ${displayTitle(track)}…`);
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(track.id)}?alt=media`;
    const response = await driveFetch(url);
    const audioValue = await responseToAudioValue(response);
    const actualSize = audioValueSize(audioValue);
    const expectedSize = Number(track.size || 0);
    if (actualSize <= 0 || (expectedSize > 0 && actualSize !== expectedSize)) {
      throw new Error(`Download verification failed for ${displayTitle(track)}. The existing offline copy was kept.`);
    }
    await dbPut('audio', { id: track.id, blob: audioValue, modifiedTime: track.modifiedTime || null });
    audioRowsById.set(track.id, { id: track.id, blob: audioValue, modifiedTime: track.modifiedTime || null });
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
    const todo = tracks.filter(t => !offlineIds.has(t.id));
    if (!todo.length) {
      showProgress('Everything in this view is already downloaded.');
      setTimeout(() => showProgress(''), 1800);
      return;
    }
    if (!navigator.onLine) return alert('Connect to the internet to download songs.');
    if (navigator.storage?.persist) {
      try { await navigator.storage.persist(); } catch {}
    }
    try {
      for (let i = 0; i < todo.length; i++) {
        showProgress(`Downloading ${i + 1} of ${todo.length}: ${displayTitle(todo[i])}`);
        await downloadTrack(todo[i], true);
      }
      setStatus(accessToken ? 'Google Drive connected' : 'Saved library', statusDetail());
      showProgress(doneMessage || `Offline ready: ${offlineIds.size} songs • ${bytes(offlineBytes)}.`);
      setTimeout(() => showProgress(''), 2500);
    } catch (e) {
      console.error(e);
      showProgress('');
      alert(e.message);
    }
  }

  async function downloadAll() {
    if (!library.length) return;
    await downloadTracks(library, `Offline ready: ${library.length} songs available on this device.`);
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
    else if (currentView === 'DOWNLOADED') rows = library.filter(t => offlineIds.has(t.id));
    else if (currentView === 'FAVORITES') rows = favorites.map(id => library.find(t => t.id === id)).filter(Boolean);
    else rows = playlistIds(currentView).map(id => library.find(t => t.id === id)).filter(Boolean);

    const q = (els.searchInput?.value || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(t => [displayTitle(t), displayArtist(t), displayAlbum(t)].join(' ').toLowerCase().includes(q));
    }
    return rows;
  }

  function updateBulkBar() {
    const hasDownloadedSelection = [...selectedIds].some(id => offlineIds.has(id));
    els.selectedCount.textContent = `${selectedIds.size} selected`;
    els.bulkBar.classList.toggle('hidden', !selectionMode);
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

  function viewTitle() {
    if (currentView === 'ALL') return 'All songs';
    if (currentView === 'DOWNLOADED') return 'Downloaded';
    if (currentView === 'FAVORITES') return 'Favorites';
    return currentView;
  }

  function render() {
    const rows = currentTracks();
    els.viewTitle.textContent = viewTitle();
    els.viewCount.textContent = currentView === 'DOWNLOADED'
      ? `${rows.length} song${rows.length === 1 ? '' : 's'} • ${bytes(offlineBytes)} offline audio`
      : `${rows.length} song${rows.length === 1 ? '' : 's'}`;
    els.downloadViewBtn.classList.toggle('hidden', currentView === 'ALL' || currentView === 'DOWNLOADED');
    els.trackList.innerHTML = '';
    els.emptyState.classList.toggle('hidden', rows.length > 0);

    rows.forEach((track, i) => {
      const node = els.trackTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.id = track.id;
      if (track.id === currentTrackId) node.classList.add('playing');
      if (selectionMode) node.classList.add('selecting');
      if (selectedIds.has(track.id)) node.classList.add('selected');
      node.querySelector('.track-index').textContent = i + 1;
      node.querySelector('.track-title').textContent = displayTitle(track);
      node.querySelector('.track-meta').textContent = displayMeta(track);
      const favoriteBtn = node.querySelector('.track-favorite');
      favoriteBtn.textContent = isFavorite(track.id) ? '♥' : '♡';
      favoriteBtn.classList.toggle('active', isFavorite(track.id));
      favoriteBtn.setAttribute('aria-label', isFavorite(track.id) ? 'Remove from Favorites' : 'Add to Favorites');
      const offlineBadge = node.querySelector('.offline-badge');
      offlineBadge.textContent = '✓';
      offlineBadge.classList.toggle('visible', offlineIds.has(track.id));
      node.querySelector('.select-glyph').textContent = selectedIds.has(track.id) ? '✓' : '○';

      const primaryAction = () => selectionMode ? toggleSelection(track.id) : playTrack(track.id);
      node.querySelector('.track-play').addEventListener('click', primaryAction);
      node.querySelector('.track-body').addEventListener('click', primaryAction);
      favoriteBtn.addEventListener('click', () => selectionMode ? toggleSelection(track.id) : toggleFavorite(track.id));
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
    let ids = currentTracks().map(t => t.id);
    if (!ids.includes(trackId)) ids = library.map(t => t.id);
    const rest = ids.filter(id => id !== trackId);
    queue = [trackId, ...(shuffle ? shuffled(rest) : rest)];
  }

  function queueIndex() {
    return queue.indexOf(currentTrackId);
  }

  async function sourceForTrack(track) {
    const cached = await dbGet('audio', track.id);
    if (audioRowIsCurrent(track, cached)) {
      return { url: audioObjectUrl(cached.blob), offline: true, stale: false, blob: cached.blob };
    }
    if (cached?.blob && !navigator.onLine) {
      return { url: audioObjectUrl(cached.blob), offline: true, stale: true, blob: cached.blob };
    }
    if (!navigator.onLine) throw new Error('This song is not downloaded. Connect to the internet or download it before the flight.');
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
      const blob = new Blob([parsed.artwork.bytes], { type: parsed.artwork.mime || 'image/jpeg' });
      currentArtworkUrl = URL.createObjectURL(blob);
      return currentArtworkUrl;
    } catch {
      return null;
    }
  }

  async function playTrack(id, preserveQueue = false) {
    const track = library.find(t => t.id === id);
    if (!track) return;
    try {
      if (!preserveQueue) buildQueue(id);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      const source = await sourceForTrack(track);
      const parsed = await applyEmbeddedMetadata(track, source.blob, true);
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
    } catch (e) {
      console.error(e);
      alert(e.message);
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
    const i = queueIndex();
    if (i >= 0 && i < queue.length - 1) return playTrack(queue[i + 1], true);
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
    if (els.audio.currentTime > 3) { els.audio.currentTime = 0; return; }
    const i = queueIndex();
    const id = i > 0 ? queue[i - 1] : (repeatMode === 'all' ? queue[queue.length - 1] : queue[0]);
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
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = name;
      cb.checked = mode === 'single' && playlists[name].includes(trackIds[0]);
      const span = document.createElement('span');
      span.textContent = name;
      label.append(cb, span);
      els.playlistChoices.appendChild(label);
    }
    els.playlistDialog.showModal();
  }

  function saveDialogPlaylists() {
    if (!dialogTrackIds.length) return;
    const checked = new Set([...els.playlistChoices.querySelectorAll('input:checked')].map(x => x.value));

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
      const remaining = playlistIds(currentView).filter(id => !selectedIds.has(id));
      saveCustomPlaylist(currentView, remaining);
    }
    setSelectionMode(false);
  }

  async function removeSelectedDownloads() {
    const ids = [...selectedIds].filter(id => offlineIds.has(id));
    if (!ids.length) return;
    const noun = ids.length === 1 ? 'song' : 'songs';
    if (!confirm(`Remove the downloaded audio for ${ids.length} ${noun}?\n\nThe songs will stay in your library, playlists, and Favorites.`)) return;
    try {
      for (const id of ids) await dbDelete('audio', id);
      await loadSavedLibrary();
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
      accessToken = null;
      tokenClient = null;
      setStatus('Drive setup saved', 'Tap Connect Drive to authorize access.');
    });

    // playlist-enhancements.js owns the complete version-2 backup/restore path.
    // These bubble-phase handlers are a fail-closed fallback only; the module's
    // capture-phase handlers stop propagation when it is loaded normally.
    els.exportBackupBtn.addEventListener('click', backupModuleUnavailable);
    els.importBackupBtn.addEventListener('click', backupModuleUnavailable);

    els.connectBtn.addEventListener('click', async () => {
      try {
        await ensureToken(true);
        setStatus('Google Drive connected', 'Ready to refresh MUSIC.');
        els.refreshBtn.disabled = false;
        await refreshFromDrive();
      } catch (e) { alert(e.message); }
    });

    els.refreshBtn.addEventListener('click', refreshFromDrive);
    els.downloadAllBtn.addEventListener('click', downloadAll);
    els.downloadViewBtn.addEventListener('click', downloadCurrentView);
    els.searchInput?.addEventListener('input', render);

    els.tabs.addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      currentView = tab.dataset.view;
      setSelectionMode(false);
      [...els.tabs.querySelectorAll('.tab')].forEach(x => x.classList.toggle('active', x === tab));
      render();
    });

    els.shuffleBtn.addEventListener('click', () => {
      shuffle = !shuffle;
      els.shuffleBtn.setAttribute('aria-pressed', String(shuffle));
      if (currentTrackId) {
        const i = queueIndex();
        const history = i >= 0 ? queue.slice(0, i + 1) : [currentTrackId];
        const future = i >= 0 ? queue.slice(i + 1) : [];
        queue = [...history, ...(shuffle ? shuffled(future) : future)];
      }
    });

    els.selectBtn.addEventListener('click', () => setSelectionMode(!selectionMode));
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

    let mark = performance.now();
    db = await openDb();
    startupTiming.dbOpen = performance.now() - mark;
    await loadSavedLibrary(startupTiming);
    startupTiming.ready = performance.now() - bootStart;

    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('Service worker unavailable', e); }
    }

    if (settings.clientId) {
      setStatus(navigator.onLine ? 'Saved library' : 'Offline mode', statusDetail());
    } else {
      setStatus('Setup required', '');
    }
    scheduleMetadataScan();
  }

  init().catch(e => {
    console.error(e);
    setStatus('Could not start app', e.message);
  });
})();