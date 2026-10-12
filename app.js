(() => {
  'use strict';

  const DEFAULT_FOLDER_ID = '1W8s8gT5p60nOqXv_VvPy6l9uofZAog9E';
  const PLAYLIST_NAMES = ['GYM', 'CHILL', 'BOSSANOVA'];
  const SUPPORTED_MIMES = new Set(['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/x-flac']);
  const DB_NAME = 'music-pwa-db';
  const DB_VERSION = 1;
  const SETTINGS_KEY = 'musicPwaSettings';
  const PLAYLISTS_KEY = 'musicPwaPlaylists';

  const els = Object.fromEntries([
    'audio','connectionLabel','statusDetail','connectBtn','refreshBtn','settingsBtn','searchInput','downloadAllBtn','tabs','viewTitle','viewCount','shuffleBtn','progressMessage','trackList','emptyState','player','nowTitle','nowStatus','playerPlaylistBtn','seek','prevBtn','playBtn','nextBtn','repeatBtn','playlistDialog','playlistChoices','savePlaylistsBtn','settingsDialog','settingsForm','clientIdInput','folderIdInput','saveSettingsBtn','trackTemplate'
  ].map(id => [id, document.getElementById(id)]));

  let db;
  let library = [];
  let offlineIds = new Set();
  let playlists = loadPlaylists();
  let settings = loadSettings();
  let accessToken = null;
  let tokenClient = null;
  let currentView = 'ALL';
  let currentTrackId = null;
  let currentObjectUrl = null;
  let queue = [];
  let shuffle = false;
  let repeatMode = 'off'; // off | all | one
  let dialogTrackId = null;
  let seekDragging = false;

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
      return Object.fromEntries(PLAYLIST_NAMES.map(name => [name, Array.isArray(saved[name]) ? saved[name] : []]));
    } catch {
      return Object.fromEntries(PLAYLIST_NAMES.map(name => [name, []]));
    }
  }

  function savePlaylists() {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
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

  function tx(store, mode = 'readonly') {
    return db.transaction(store, mode).objectStore(store);
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetAll(store) { return reqP(tx(store).getAll()); }
  async function dbGetAllKeys(store) { return reqP(tx(store).getAllKeys()); }
  async function dbGet(store, key) { return reqP(tx(store).get(key)); }
  async function dbPut(store, value) { return reqP(tx(store, 'readwrite').put(value)); }
  async function dbDelete(store, key) { return reqP(tx(store, 'readwrite').delete(key)); }

  function cleanTitle(name) {
    return name.replace(/\.(mp3|m4a|aac|flac|wav)$/i, '');
  }

  function bytes(n) {
    const x = Number(n || 0);
    if (!x) return '';
    return x >= 1024 * 1024 ? `${(x / 1024 / 1024).toFixed(1)} MB` : `${Math.round(x / 1024)} KB`;
  }

  function setStatus(title, detail) {
    els.connectionLabel.textContent = title;
    els.statusDetail.textContent = detail;
  }

  function showProgress(text = '') {
    els.progressMessage.textContent = text;
    els.progressMessage.classList.toggle('hidden', !text);
  }

  async function loadSavedLibrary() {
    library = (await dbGetAll('library')).sort((a, b) => a.name.localeCompare(b.name));
    // Only read the audio-store keys at startup. Reading every audio record here would
    // deserialize every downloaded song (hundreds of MB) just to discover which IDs exist.
    offlineIds = new Set(await dbGetAllKeys('audio'));
    prunePlaylists();
    render();
    const offlineCount = offlineIds.size;
    setStatus(navigator.onLine ? 'Saved library' : 'Offline mode', `${library.length} songs • ${offlineCount} downloaded`);
  }

  function prunePlaylists() {
    const valid = new Set(library.map(t => t.id));
    let changed = false;
    for (const name of PLAYLIST_NAMES) {
      const filtered = playlists[name].filter(id => valid.has(id));
      if (filtered.length !== playlists[name].length) changed = true;
      playlists[name] = filtered;
    }
    if (changed) savePlaylists();
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
      const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,modifiedTime)');
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
      const oldMap = new Map(library.map(x => [x.id, x]));
      const newIds = new Set(incoming.map(x => x.id));

      for (const old of library) {
        if (!newIds.has(old.id)) {
          await dbDelete('library', old.id);
          await dbDelete('audio', old.id);
          offlineIds.delete(old.id);
        }
      }

      for (const f of incoming) {
        const old = oldMap.get(f.id);
        if (old && old.modifiedTime && old.modifiedTime !== f.modifiedTime && offlineIds.has(f.id)) {
          await dbDelete('audio', f.id);
          offlineIds.delete(f.id);
        }
        await dbPut('library', {
          id: f.id,
          name: f.name,
          title: cleanTitle(f.name),
          mimeType: f.mimeType,
          size: Number(f.size || 0),
          modifiedTime: f.modifiedTime || null
        });
      }
      await loadSavedLibrary();
      setStatus('Google Drive connected', `${library.length} songs • ${offlineIds.size} downloaded`);
      showProgress(`Updated. ${library.length} songs found in MUSIC.`);
      setTimeout(() => showProgress(''), 2500);
    } catch (e) {
      console.error(e);
      showProgress('');
      alert(e.message);
    }
  }

  async function downloadTrack(track, quiet = false) {
    if (offlineIds.has(track.id)) return;
    if (!navigator.onLine) throw new Error('Connect to the internet to download songs.');
    if (!quiet) showProgress(`Downloading ${track.title}…`);
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(track.id)}?alt=media`;
    const blob = await (await driveFetch(url)).blob();
    await dbPut('audio', { id: track.id, blob, modifiedTime: track.modifiedTime || null });
    offlineIds.add(track.id);
    render();
    if (!quiet) {
      showProgress(`${track.title} is available offline.`);
      setTimeout(() => showProgress(''), 1800);
    }
  }

  async function downloadAll() {
    if (!library.length) return;
    try {
      if (navigator.storage?.persist) {
        try { await navigator.storage.persist(); } catch {}
      }
      const todo = library.filter(t => !offlineIds.has(t.id));
      if (!todo.length) return showProgress('All songs are already downloaded.');
      for (let i = 0; i < todo.length; i++) {
        showProgress(`Downloading ${i + 1} of ${todo.length}: ${todo[i].title}`);
        await downloadTrack(todo[i], true);
      }
      showProgress(`Offline ready: ${offlineIds.size} songs downloaded.`);
      setStatus(accessToken ? 'Google Drive connected' : 'Saved library', `${library.length} songs • ${offlineIds.size} downloaded`);
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  }

  function currentTracks() {
    let rows = currentView === 'ALL'
      ? [...library]
      : playlists[currentView].map(id => library.find(t => t.id === id)).filter(Boolean);
    const q = els.searchInput.value.trim().toLowerCase();
    if (q) rows = rows.filter(t => t.title.toLowerCase().includes(q));
    return rows;
  }

  function render() {
    const rows = currentTracks();
    els.viewTitle.textContent = currentView === 'ALL' ? 'All songs' : currentView;
    els.viewCount.textContent = `${rows.length} song${rows.length === 1 ? '' : 's'}`;
    els.trackList.innerHTML = '';
    els.emptyState.classList.toggle('hidden', rows.length > 0);

    rows.forEach((track, i) => {
      const node = els.trackTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.id = track.id;
      if (track.id === currentTrackId) node.classList.add('playing');
      node.querySelector('.track-index').textContent = i + 1;
      node.querySelector('.track-title').textContent = track.title;
      node.querySelector('.track-meta').textContent = [bytes(track.size), offlineIds.has(track.id) ? 'Offline' : 'Drive'].filter(Boolean).join(' • ');
      node.querySelector('.offline-badge').classList.toggle('visible', offlineIds.has(track.id));
      node.querySelector('.track-play').addEventListener('click', () => playTrack(track.id));
      node.querySelector('.track-body').addEventListener('click', () => playTrack(track.id));
      node.querySelector('.track-menu').addEventListener('click', () => openPlaylistDialog(track.id));
      els.trackList.appendChild(node);
    });
  }

  function buildQueue(trackId) {
    queue = currentTracks().map(t => t.id);
    if (!queue.includes(trackId)) queue = library.map(t => t.id);
  }

  async function sourceForTrack(track) {
    const cached = await dbGet('audio', track.id);
    if (cached?.blob) return { url: URL.createObjectURL(cached.blob), offline: true };
    if (!navigator.onLine) throw new Error('This song is not downloaded. Connect to the internet or download it before the flight.');
    showProgress(`Loading ${track.title} from Drive…`);
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(track.id)}?alt=media`;
    const blob = await (await driveFetch(url)).blob();
    showProgress('');
    return { url: URL.createObjectURL(blob), offline: false };
  }

  async function playTrack(id, preserveQueue = false) {
    const track = library.find(t => t.id === id);
    if (!track) return;
    try {
      if (!preserveQueue) buildQueue(id);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      const source = await sourceForTrack(track);
      currentObjectUrl = source.url;
      currentTrackId = id;
      els.audio.src = source.url;
      els.nowTitle.textContent = track.title;
      els.nowStatus.textContent = source.offline ? 'Playing offline' : 'Playing from Drive';
      els.player.classList.remove('hidden');
      updateMediaSession(track);
      render();
      await els.audio.play();
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  }

  function updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: 'MUSIC',
        album: currentView === 'ALL' ? 'Library' : currentView
      });
    } catch {}
  }

  function queueIndex() { return queue.indexOf(currentTrackId); }

  function randomNext(excludeId) {
    const options = queue.filter(id => id !== excludeId);
    return options[Math.floor(Math.random() * options.length)] || excludeId;
  }

  function nextTrack(auto = false) {
    if (!queue.length) return;
    if (auto && repeatMode === 'one') return playTrack(currentTrackId, true);
    let id;
    if (shuffle && queue.length > 1) id = randomNext(currentTrackId);
    else {
      const i = queueIndex();
      if (i < queue.length - 1) id = queue[i + 1];
      else if (repeatMode === 'all') id = queue[0];
      else return;
    }
    playTrack(id, true);
  }

  function prevTrack() {
    if (!queue.length) return;
    if (els.audio.currentTime > 3) { els.audio.currentTime = 0; return; }
    let id;
    if (shuffle && queue.length > 1) id = randomNext(currentTrackId);
    else {
      const i = queueIndex();
      id = i > 0 ? queue[i - 1] : (repeatMode === 'all' ? queue[queue.length - 1] : queue[0]);
    }
    playTrack(id, true);
  }

  function openPlaylistDialog(trackId) {
    dialogTrackId = trackId;
    els.playlistChoices.innerHTML = '';
    for (const name of PLAYLIST_NAMES) {
      const label = document.createElement('label');
      label.className = 'playlist-choice';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = name;
      cb.checked = playlists[name].includes(trackId);
      const span = document.createElement('span');
      span.textContent = name;
      label.append(cb, span);
      els.playlistChoices.appendChild(label);
    }
    els.playlistDialog.showModal();
  }

  function saveDialogPlaylists() {
    if (!dialogTrackId) return;
    const checked = new Set([...els.playlistChoices.querySelectorAll('input:checked')].map(x => x.value));
    for (const name of PLAYLIST_NAMES) {
      const set = new Set(playlists[name]);
      checked.has(name) ? set.add(dialogTrackId) : set.delete(dialogTrackId);
      playlists[name] = [...set];
    }
    savePlaylists();
    render();
  }

  function updatePlayButton() {
    els.playBtn.textContent = els.audio.paused ? '▶' : '❚❚';
  }

  function updateRepeatButton() {
    const label = repeatMode === 'off' ? 'Off' : repeatMode === 'all' ? 'All' : 'One';
    els.repeatBtn.textContent = `Repeat: ${label}`;
  }

  function cycleRepeat() {
    repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    updateRepeatButton();
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
    els.searchInput.addEventListener('input', render);

    els.tabs.addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      currentView = tab.dataset.view;
      [...els.tabs.querySelectorAll('.tab')].forEach(x => x.classList.toggle('active', x === tab));
      render();
    });

    els.shuffleBtn.addEventListener('click', () => {
      shuffle = !shuffle;
      els.shuffleBtn.setAttribute('aria-pressed', String(shuffle));
    });

    els.playBtn.addEventListener('click', () => {
      if (!currentTrackId && library[0]) return playTrack(library[0].id);
      els.audio.paused ? els.audio.play() : els.audio.pause();
    });
    els.prevBtn.addEventListener('click', prevTrack);
    els.nextBtn.addEventListener('click', () => nextTrack(false));
    els.repeatBtn.addEventListener('click', cycleRepeat);
    els.playerPlaylistBtn.addEventListener('click', () => currentTrackId && openPlaylistDialog(currentTrackId));
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

    window.addEventListener('online', () => setStatus(accessToken ? 'Google Drive connected' : 'Online', `${library.length} saved songs • refresh available`));
    window.addEventListener('offline', () => setStatus('Offline mode', `${offlineIds.size} downloaded songs available`));

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
    updateRepeatButton();
    db = await openDb();
    await loadSavedLibrary();

    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('Service worker unavailable', e); }
    }

    if (settings.clientId && navigator.onLine) {
      setStatus('Saved library', `${library.length} songs • tap Connect Drive to refresh`);
    } else if (!settings.clientId) {
      setStatus('Setup required', `${library.length} saved songs • add your Google OAuth Client ID in Settings`);
    }
  }

  init().catch(e => {
    console.error(e);
    setStatus('Could not start app', e.message);
  });
})();