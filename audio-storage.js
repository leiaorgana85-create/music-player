(() => {
  'use strict';

  const AUDIO_DB_NAME = 'music-pwa-audio-db';
  const AUDIO_DB_VERSION = 1;
  const AUDIO_STORE = 'audio';
  const AUDIO_INDEX_KEY = 'musicPwaAudioIndexV2';
  const LEGACY_INDEX_KEY = 'musicPwaAudioIndexV1';
  let audioDb = null;
  let deleteBarrier = false;

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

  // Critical startup rule: module readiness never opens IndexedDB.
  // The audio database can contain hundreds of MB and is opened only for a
  // specific playback/download/delete operation.
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
    // Reserved for explicit maintenance paths only. Normal startup never calls it.
    return runRequest('readonly', store => store.getAll());
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
    const result = await runRequest('readwrite', store => store.delete(id));
    removeIndex(id);
    return result;
  }

  async function readStats() {
    // Fast/non-blocking settings statistic from the verified lightweight index.
    // Legacy unindexed rows remain readable and are indexed lazily when played.
    const index = readIndex();
    const rows = Object.values(index).filter(x => Number(x?.size || 0) > 0);
    return {
      count: rows.length,
      bytes: rows.reduce((sum, row) => sum + Number(row.size || 0), 0)
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
      return { count: 0, bytes: 0 };
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
    get,
    put,
    deleteKey,
    readStats,
    deleteDatabase
  };
})();