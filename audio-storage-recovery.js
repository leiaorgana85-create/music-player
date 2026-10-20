(() => {
  'use strict';

  const AUDIO_DB_NAME = 'music-pwa-audio-db';
  const AUDIO_DB_VERSION = 1;
  const AUDIO_STORE = 'audio';
  const AUDIO_INDEX_KEY = 'musicPwaAudioIndexV2';
  const LEGACY_INDEX_KEY = 'musicPwaAudioIndexV1';
  const LIBRARY_KEY = 'musicPwaLibraryV2';
  const pendingAudioDeletes = new Set();
  const originalStorageSetItem = Storage.prototype.setItem;
  const originalStorageGetItem = Storage.prototype.getItem;
  let audioDb = null;
  let deleteBarrier = false;

  function parseLibrary(raw) {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // app-recovery.js removes a Drive-deleted track from the local library even
  // when its separate audio-row deletion throws. Preserve that library row
  // while deletion is unverified so the next Refresh can retry cleanly instead
  // of leaving an inaccessible audio blob behind.
  Storage.prototype.setItem = function guardedStorageSetItem(key, value) {
    if (this === localStorage && String(key) === LIBRARY_KEY && pendingAudioDeletes.size) {
      const previous = parseLibrary(originalStorageGetItem.call(this, LIBRARY_KEY));
      const next = parseLibrary(value);
      const nextIds = new Set(next.map(track => String(track?.id || '')));

      for (const id of pendingAudioDeletes) {
        if (nextIds.has(id)) continue;
        const priorTrack = previous.find(track => String(track?.id || '') === id);
        if (priorTrack) {
          next.push(priorTrack);
          nextIds.add(id);
        }
      }
      value = JSON.stringify(next);
    }
    return originalStorageSetItem.call(this, key, value);
  };

  function isRecoverableDbError(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || '');
    return (
      name === 'InvalidStateError' && /connection is (closing|closed)|database connection is (closing|closed)|not ready/i.test(message)
    ) || (
      name === 'UnknownError' && /indexed database server|connection to indexed database server lost/i.test(message)
    );
  }

  function deletionAbortError() {
    return new DOMException('Offline audio deletion is in progress.', 'AbortError');
  }

  function openAudioDb() {
    if (audioDb) return Promise.resolve(audioDb);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(AUDIO_DB_NAME, AUDIO_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(AUDIO_STORE)) {
          db.createObjectStore(AUDIO_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        audioDb = request.result;
        audioDb.onversionchange = () => {
          try { audioDb?.close(); } catch {}
          audioDb = null;
        };
        resolve(audioDb);
      };
      request.onerror = () => reject(request.error || new Error('Could not open offline audio storage.'));
      request.onblocked = () => reject(new Error('Offline audio storage is blocked by another open app window.'));
    });
  }

  async function reopenAudioDb() {
    try { audioDb?.close(); } catch {}
    audioDb = null;
    await new Promise(resolve => setTimeout(resolve, 0));
    return openAudioDb();
  }

  const ready = Promise.resolve();

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Offline audio storage request failed.'));
    });
  }

  function finishTransaction(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Offline audio storage transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Offline audio storage transaction was cancelled.'));
    });
  }

  async function runRequest(mode, makeRequest) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const db = await openAudioDb();
        const transaction = db.transaction(AUDIO_STORE, mode);
        const request = makeRequest(transaction.objectStore(AUDIO_STORE));
        const result = await requestPromise(request);
        if (mode === 'readwrite') await finishTransaction(transaction);
        return result;
      } catch (error) {
        if (attempt === 0 && isRecoverableDbError(error)) {
          await reopenAudioDb();
          continue;
        }
        throw error;
      }
    }
    throw new Error('Offline audio storage request failed.');
  }

  function storedAudioSize(row) {
    const value = row?.blob ?? row;
    if (!value) return 0;
    if (value.__musicBytes instanceof ArrayBuffer) return value.__musicBytes.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
    return 0;
  }

  function parseIndex(raw) {
    try {
      const parsed = JSON.parse(raw || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function readIndex() {
    const current = parseIndex(localStorage.getItem(AUDIO_INDEX_KEY));
    if (Object.keys(current).length) return current;
    const legacy = parseIndex(localStorage.getItem(LEGACY_INDEX_KEY));
    if (Object.keys(legacy).length) {
      localStorage.setItem(AUDIO_INDEX_KEY, JSON.stringify(legacy));
      return legacy;
    }
    return {};
  }

  function writeIndex(index) {
    localStorage.setItem(AUDIO_INDEX_KEY, JSON.stringify(index));
  }

  function recordIndex(value) {
    const id = String(value?.id || '');
    const size = storedAudioSize(value);
    if (!id || size <= 0) return;
    const index = readIndex();
    index[id] = {
      size,
      modifiedTime: String(value?.modifiedTime || '')
    };
    writeIndex(index);
  }

  function removeIndex(id) {
    const index = readIndex();
    if (!Object.prototype.hasOwnProperty.call(index, id)) return;
    delete index[id];
    writeIndex(index);
  }

  function getIndex() {
    return readIndex();
  }

  async function getAll() {
    return runRequest('readonly', store => store.getAll());
  }

  async function getAllKeys() {
    return runRequest('readonly', store => store.getAllKeys());
  }

  async function verifyIndexedAudio() {
    const index = readIndex();
    const indexed = Object.entries(index).filter(([, meta]) => Number(meta?.size || 0) > 0);
    const keys = (await getAllKeys()).map(key => String(key));
    const keySet = new Set(keys);
    const missingIds = indexed.map(([id]) => id).filter(id => !keySet.has(id));
    return {
      verified: missingIds.length === 0,
      indexedCount: indexed.length,
      bytes: indexed.reduce((sum, [, meta]) => sum + Number(meta.size || 0), 0),
      actualRowCount: keys.length,
      missingCount: missingIds.length,
      missingIds
    };
  }

  async function get(key) {
    const value = await runRequest('readonly', store => store.get(key));
    if (value) recordIndex(value);
    else removeIndex(key);
    return value;
  }

  async function put(value) {
    if (deleteBarrier) throw deletionAbortError();
    const result = await runRequest('readwrite', store => {
      if (deleteBarrier) throw deletionAbortError();
      return store.put(value);
    });
    recordIndex(value);
    return result;
  }

  async function deleteKey(id) {
    const key = String(id || '');
    if (key) pendingAudioDeletes.add(key);

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await runRequest('readwrite', store => store.delete(id));
        const remaining = await runRequest('readonly', store => store.get(id));
        if (!remaining) {
          removeIndex(id);
          if (key) pendingAudioDeletes.delete(key);
          return;
        }
        lastError = new Error('Offline audio row still exists after deletion.');
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, 60 * (attempt + 1)));
    }
    throw lastError || new Error('Could not verify offline audio removal.');
  }

  async function readStats() {
    const index = readIndex();
    const indexedRows = Object.values(index).filter(x => Number(x?.size || 0) > 0);
    const actualKeys = await getAllKeys();
    return {
      count: Math.max(indexedRows.length, actualKeys.length),
      bytes: indexedRows.reduce((sum, row) => sum + Number(row.size || 0), 0),
      actualRowCount: actualKeys.length
    };
  }

  async function readActualStats() {
    const rows = await getAll();
    return {
      count: rows.filter(row => storedAudioSize(row) > 0).length,
      bytes: rows.reduce((sum, row) => sum + storedAudioSize(row), 0),
      rowCount: rows.length
    };
  }

  async function deleteDatabase() {
    if (deleteBarrier) throw deletionAbortError();
    deleteBarrier = true;

    try {
      try { audioDb?.close(); } catch {}
      audioDb = null;
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(AUDIO_DB_NAME);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error || new Error('Could not delete offline audio database.'));
        request.onblocked = () => reject(new Error('Close any other Lexi Music window and try again.'));
      });
      localStorage.removeItem(AUDIO_INDEX_KEY);
      localStorage.removeItem(LEGACY_INDEX_KEY);
      pendingAudioDeletes.clear();

      await openAudioDb();
      const actual = await readActualStats();
      if (actual.rowCount !== 0 || actual.count !== 0 || actual.bytes !== 0) {
        throw new Error(`Offline audio database verification failed: ${actual.rowCount} row(s) remain.`);
      }
      return { count: 0, bytes: 0, rowCount: 0 };
    } catch (error) {
      deleteBarrier = false;
      throw error;
    }
  }

  window.LexiAudioStorage = {
    databaseName: AUDIO_DB_NAME,
    storeName: AUDIO_STORE,
    indexKey: AUDIO_INDEX_KEY,
    ready,
    getIndex,
    getAll,
    getAllKeys,
    verifyIndexedAudio,
    get,
    put,
    deleteKey,
    readStats,
    readActualStats,
    deleteDatabase
  };
})();
