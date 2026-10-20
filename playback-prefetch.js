(() => {
  'use strict';

  const LIBRARY_KEY = 'musicPwaLibraryV2';
  const PLAYLISTS_KEY = 'musicPwaPlaylists';
  const CUSTOM_PLAYLISTS_KEY = 'musicPwaCustomPlaylists';
  const FAVORITES_KEY = 'musicPwaFavorites';

  const storage = window.LexiAudioStorage;
  if (!storage?.get) return;

  const originalGet = storage.get.bind(storage);
  const originalPut = storage.put?.bind(storage);
  const originalDeleteKey = storage.deleteKey?.bind(storage);
  const originalDeleteDatabase = storage.deleteDatabase?.bind(storage);

  let prefetched = null;
  let queueMirror = [];
  let currentId = null;
  let randomRecorder = null;
  let metadataModule = null;
  let metadataOriginalParse = null;

  function safeJson(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function library() {
    const rows = safeJson(localStorage.getItem(LIBRARY_KEY) || '[]', []);
    return Array.isArray(rows) ? rows.filter(track => track && typeof track.id === 'string') : [];
  }

  function displayTitle(track) {
    return track?.metadata?.title || track?.title || String(track?.name || '').replace(/\.(mp3|m4a|aac|flac|wav)$/i, '');
  }

  function displayArtist(track) {
    return track?.metadata?.artist || '';
  }

  function displayAlbum(track) {
    return track?.metadata?.album || '';
  }

  function playlistIds(name) {
    const builtIn = safeJson(localStorage.getItem(PLAYLISTS_KEY) || '{}', {});
    if (Array.isArray(builtIn?.[name])) return builtIn[name];
    const custom = safeJson(localStorage.getItem(CUSTOM_PLAYLISTS_KEY) || '{}', {});
    return Array.isArray(custom?.[name]) ? custom[name] : [];
  }

  function currentTrackIds() {
    const rows = library();
    const byId = new Map(rows.map(track => [track.id, track]));
    const view = document.querySelector('#tabs .tab.active')?.dataset?.view || 'GYM';
    let ids;

    if (view === 'ALL') ids = rows.map(track => track.id);
    else if (view === 'DOWNLOADED') {
      const index = storage.getIndex?.() || {};
      ids = rows.filter(track => {
        const meta = index[track.id];
        if (!meta || Number(meta.size || 0) <= 0) return false;
        const expectedSize = Number(track.size || 0);
        if (expectedSize > 0 && Number(meta.size || 0) !== expectedSize) return false;
        const trackModified = String(track.modifiedTime || '');
        const rowModified = String(meta.modifiedTime || '');
        return !(trackModified && rowModified && trackModified !== rowModified);
      }).map(track => track.id);
    } else if (view === 'FAVORITES') {
      const favorites = safeJson(localStorage.getItem(FAVORITES_KEY) || '[]', []);
      ids = Array.isArray(favorites) ? favorites.filter(id => byId.has(id)) : [];
    } else {
      ids = playlistIds(view).filter(id => byId.has(id));
    }

    const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
    if (!q) return ids;
    return ids.filter(id => {
      const track = byId.get(id);
      return [displayTitle(track), displayArtist(track), displayAlbum(track)].join(' ').toLowerCase().includes(q);
    });
  }

  function repeatMode() {
    return document.getElementById('repeatBtn')?.dataset?.mode || 'all';
  }

  function shuffleOn() {
    return document.getElementById('shuffleBtn')?.getAttribute('aria-pressed') !== 'false';
  }

  function applyRecordedShuffle(ids, values) {
    const copy = [...ids];
    let valueIndex = 0;
    for (let i = copy.length - 1; i > 0; i--) {
      const value = values[valueIndex++];
      if (!Number.isFinite(value)) return null;
      const j = Math.floor(value * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function beginRandomRecording(after) {
    if (randomRecorder) return;
    const original = Math.random;
    const values = [];
    const wrapped = () => {
      const value = original();
      values.push(value);
      return value;
    };
    randomRecorder = { original, wrapped };
    Math.random = wrapped;
    queueMicrotask(() => {
      if (Math.random === wrapped) Math.random = original;
      randomRecorder = null;
      try { after(values); } catch (error) { console.warn('Playback prefetch queue mirror skipped', error); }
    });
  }

  function buildQueueMirror(trackId, randomValues) {
    let ids = currentTrackIds();
    if (!ids.includes(trackId)) ids = library().map(track => track.id);
    const rest = ids.filter(id => id !== trackId);
    if (shuffleOn()) {
      const shuffled = applyRecordedShuffle(rest, randomValues);
      queueMirror = [trackId, ...(shuffled || rest)];
    } else {
      queueMirror = [trackId, ...rest];
    }
    currentId = trackId;
    schedulePrefetch();
  }

  function nextIdFromMirror(auto) {
    if (!queueMirror.length || !currentId) return null;
    if (auto && repeatMode() === 'one') return currentId;
    const index = queueMirror.indexOf(currentId);
    if (index >= 0 && index < queueMirror.length - 1) return queueMirror[index + 1];
    if (repeatMode() !== 'all') return null;
    if (!shuffleOn()) return queueMirror[0] || null;
    return null;
  }

  function currentTrackRecord(id) {
    return library().find(track => track.id === id) || null;
  }

  function rowIsCurrent(track, row) {
    if (!track || !row?.blob) return false;
    const value = row.blob;
    const size = value?.__musicBytes instanceof ArrayBuffer
      ? value.__musicBytes.byteLength
      : value instanceof ArrayBuffer
        ? value.byteLength
        : ArrayBuffer.isView(value)
          ? value.byteLength
          : typeof Blob !== 'undefined' && value instanceof Blob
            ? value.size
            : 0;
    if (size <= 0) return false;
    const expectedSize = Number(track.size || 0);
    if (expectedSize > 0 && size !== expectedSize) return false;
    const trackModified = String(track.modifiedTime || '');
    const rowModified = String(row.modifiedTime || '');
    return !(trackModified && rowModified && trackModified !== rowModified);
  }

  async function prefetch(id) {
    if (!id || id === currentId || prefetched?.id === id) return;
    const track = currentTrackRecord(id);
    if (!track) return;

    const index = storage.getIndex?.() || {};
    const meta = index[id];
    if (!meta || Number(meta.size || 0) <= 0) return;

    try {
      const row = await originalGet(id);
      if (!rowIsCurrent(track, row)) return;
      const next = { id, row, parsedPromise: null };
      prefetched = next;
      if (metadataOriginalParse) {
        next.parsedPromise = Promise.resolve(
          metadataOriginalParse(row.blob, track.mimeType || '', true)
        ).catch(error => {
          console.warn('Playback metadata prefetch skipped', error);
          return null;
        });
      }
    } catch (error) {
      console.warn('Playback audio prefetch skipped', error);
    }
  }

  function schedulePrefetch() {
    const id = nextIdFromMirror(false);
    if (!id || id === currentId) return;
    setTimeout(() => prefetch(id), 0);
  }

  storage.get = async key => {
    const id = String(key || '');
    if (prefetched?.id === id && prefetched.row) return prefetched.row;
    return originalGet(key);
  };

  if (originalPut) {
    storage.put = async value => {
      const id = String(value?.id || '');
      if (prefetched?.id === id) prefetched = null;
      return originalPut(value);
    };
  }

  if (originalDeleteKey) {
    storage.deleteKey = async id => {
      if (prefetched?.id === String(id || '')) prefetched = null;
      return originalDeleteKey(id);
    };
  }

  if (originalDeleteDatabase) {
    storage.deleteDatabase = async (...args) => {
      prefetched = null;
      return originalDeleteDatabase(...args);
    };
  }

  function wrapMetadataModule(module) {
    if (!module?.parse || module.__lexiPrefetchWrapped) return module;
    metadataOriginalParse = module.parse.bind(module);
    const wrapped = {
      ...module,
      async parse(value, mimeType = '', includeArtwork = false) {
        if (includeArtwork && prefetched?.row?.blob === value && prefetched.parsedPromise) {
          const parsed = await prefetched.parsedPromise;
          if (parsed) return parsed;
        }
        return metadataOriginalParse(value, mimeType, includeArtwork);
      },
      __lexiPrefetchWrapped: true
    };
    metadataModule = wrapped;
    return wrapped;
  }

  const existingMetadata = window.MusicMetadata;
  if (existingMetadata) {
    metadataModule = wrapMetadataModule(existingMetadata);
    window.MusicMetadata = metadataModule;
  } else {
    Object.defineProperty(window, 'MusicMetadata', {
      configurable: true,
      enumerable: true,
      get() { return metadataModule; },
      set(value) { metadataModule = wrapMetadataModule(value); }
    });
  }

  document.addEventListener('click', event => {
    const row = event.target.closest?.('.track-row');
    const isPrimary = event.target.closest?.('.track-play, .track-body');
    const selecting = !document.getElementById('bulkBar')?.classList.contains('hidden');
    if (row && isPrimary && !selecting) {
      const id = row.dataset.id;
      if (!id) return;
      beginRandomRecording(values => buildQueueMirror(id, values));
      return;
    }

    if (event.target.closest?.('#playBtn') && !currentId) {
      const first = library()[0]?.id;
      if (first) beginRandomRecording(values => buildQueueMirror(first, values));
      return;
    }

    if (event.target.closest?.('#shuffleBtn')) {
      const beforeQueue = [...queueMirror];
      const beforeId = currentId;
      beginRandomRecording(values => {
        if (!beforeId || !beforeQueue.length || !shuffleOn()) {
          schedulePrefetch();
          return;
        }
        const index = beforeQueue.indexOf(beforeId);
        const history = index >= 0 ? beforeQueue.slice(0, index + 1) : [beforeId];
        const future = index >= 0 ? beforeQueue.slice(index + 1) : [];
        const shuffled = applyRecordedShuffle(future, values);
        if (shuffled) queueMirror = [...history, ...shuffled];
        schedulePrefetch();
      });
      return;
    }

    if (event.target.closest?.('#nextBtn')) {
      const next = nextIdFromMirror(false);
      const atEndShuffle = !next && repeatMode() === 'all' && shuffleOn() && queueMirror.length > 1;
      if (atEndShuffle) {
        const rest = queueMirror.filter(id => id !== currentId);
        beginRandomRecording(values => {
          const shuffled = applyRecordedShuffle(rest, values);
          if (!shuffled?.length) return;
          queueMirror = [currentId, ...shuffled];
          currentId = queueMirror[1];
          schedulePrefetch();
        });
      } else if (next) {
        queueMicrotask(() => {
          currentId = next;
          schedulePrefetch();
        });
      }
      return;
    }

    if (event.target.closest?.('#prevBtn')) {
      const audio = document.getElementById('audio');
      if ((audio?.currentTime || 0) > 3) return;
      const index = queueMirror.indexOf(currentId);
      const prev = index > 0
        ? queueMirror[index - 1]
        : repeatMode() === 'all'
          ? queueMirror[queueMirror.length - 1]
          : queueMirror[0];
      if (prev) queueMicrotask(() => {
        currentId = prev;
        schedulePrefetch();
      });
    }
  }, true);

  const audio = document.getElementById('audio');
  if (audio && !audio.__lexiPlayableGateInstalled) {
    const nativePlay = audio.play.bind(audio);
    let lastStartedSrc = '';

    function waitUntilPlayable(timeoutMs = 4000) {
      if (!audio.src || audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve();
      return new Promise(resolve => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          audio.removeEventListener('canplay', finish);
          audio.removeEventListener('canplaythrough', finish);
          audio.removeEventListener('error', finish);
          resolve();
        };
        const timer = setTimeout(finish, timeoutMs);
        audio.addEventListener('canplay', finish, { once: true });
        audio.addEventListener('canplaythrough', finish, { once: true });
        audio.addEventListener('error', finish, { once: true });
      });
    }

    audio.play = async (...args) => {
      const src = audio.currentSrc || audio.src || '';
      if (src && src !== lastStartedSrc) {
        try { audio.load(); } catch {}
        await waitUntilPlayable();
        try { audio.currentTime = 0; } catch {}
      }
      const result = await nativePlay(...args);
      lastStartedSrc = audio.currentSrc || audio.src || src;
      return result;
    };
    audio.__lexiPlayableGateInstalled = true;
  }

  audio?.addEventListener('ended', () => {
    const next = nextIdFromMirror(true);
    const atEndShuffle = !next && repeatMode() === 'all' && shuffleOn() && queueMirror.length > 1;
    if (atEndShuffle) {
      const rest = queueMirror.filter(id => id !== currentId);
      beginRandomRecording(values => {
        const shuffled = applyRecordedShuffle(rest, values);
        if (!shuffled?.length) return;
        queueMirror = [currentId, ...shuffled];
        currentId = queueMirror[1];
        schedulePrefetch();
      });
    } else if (next) {
      queueMicrotask(() => {
        currentId = next;
        schedulePrefetch();
      });
    }
  }, true);

  audio?.addEventListener('play', () => {
    const activeId = document.querySelector('.track-row.playing')?.dataset?.id;
    if (activeId) currentId = activeId;
    setTimeout(schedulePrefetch, 0);
  });
})();
