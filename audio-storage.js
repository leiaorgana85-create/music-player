(() => {
  'use strict';

  const AUDIO_DB_NAME = 'music-pwa-audio-db';
  const AUDIO_DB_VERSION = 1;
  const AUDIO_STORE = 'audio';
  let audioDb = null;

  function isRecoverableDbError(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || '');
    return (
      name === 'InvalidStateError' && /connection is (closing|closed)|database connection is (closing|closed)|not ready/i.test(message)
    ) || (
      name === 'UnknownError' && /indexed database server|connection to indexed database server lost/i.test(message)
    );
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

  const ready = openAudioDb();

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

  async function getAll() {
    return runRequest('readonly', store => store.getAll());
  }

  async function get(key) {
    return runRequest('readonly', store => store.get(key));
  }

  async function put(value) {
    return runRequest('readwrite', store => store.put(value));
  }

  async function deleteKey(id) {
    return runRequest('readwrite', store => store.delete(id));
  }

  async function readStats() {
    const rows = await getAll();
    return {
      count: rows.length,
      bytes: rows.reduce((sum, row) => sum + storedAudioSize(row), 0)
    };
  }

  async function deleteDatabase() {
    try { audioDb?.close(); } catch {}
    audioDb = null;

    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(AUDIO_DB_NAME);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error('Could not delete offline audio database.'));
      request.onblocked = () => reject(new Error('Close any other Lexi Music window and try again.'));
    });

    // Recreate a fresh tiny database so the running app can continue without a
    // reinstall. Verification happens against this new empty store.
    await openAudioDb();
    return readStats();
  }

  window.LexiAudioStorage = {
    databaseName: AUDIO_DB_NAME,
    storeName: AUDIO_STORE,
    ready,
    getAll,
    get,
    put,
    deleteKey,
    readStats,
    deleteDatabase
  };
})();