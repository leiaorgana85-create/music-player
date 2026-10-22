(() => {
  'use strict';
  if (window.__lexiAudioStoragePlayer) return;
  window.__lexiAudioStoragePlayer = true;

  const AUDIO_DB_NAME = 'music-pwa-audio-db';
  const AUDIO_DB_VERSION = 1;
  const AUDIO_STORE = 'audio';
  const AUDIO_INDEX_KEY = 'musicPwaAudioIndexV2';
  const LEGACY_INDEX_KEY = 'musicPwaAudioIndexV1';
  let audioDb = null;
  let opening = null;
  let deleteBarrier = false;
  let operations = Promise.resolve();
  function serialize(task) {
    const run = () => navigator.locks?.request
      ? navigator.locks.request('lexi-music-audio', task) : task();
    const result = operations.then(run, run);
    operations = result.catch(() => {});
    return result;
  }

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
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
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
    }).finally(() => { opening = null; });
    return opening;
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
        const committed = finishTransaction(transaction);
        let request;
        try { request = makeRequest(transaction.objectStore(AUDIO_STORE)); }
        catch (error) { try { transaction.abort(); } catch {} await committed.catch(() => {}); throw error; }
        const [result] = await Promise.all([requestPromise(request), committed]);
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
    const current = localStorage.getItem(AUDIO_INDEX_KEY);
    if (current !== null) return parseIndex(current);
    const legacy = parseIndex(localStorage.getItem(LEGACY_INDEX_KEY));
    localStorage.setItem(AUDIO_INDEX_KEY, JSON.stringify(legacy));
    localStorage.removeItem(LEGACY_INDEX_KEY);
    return legacy;
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

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await runRequest('readwrite', store => store.delete(id));
        const remaining = await runRequest('readonly', store => store.get(id));
        if (!remaining) {
          removeIndex(id);
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

      await openAudioDb();
      const actual = await readActualStats();
      if (actual.rowCount !== 0 || actual.count !== 0 || actual.bytes !== 0) {
        throw new Error(`Offline audio database verification failed: ${actual.rowCount} row(s) remain.`);
      }
      return { count: 0, bytes: 0, rowCount: 0 };
    } finally {
      deleteBarrier = false;
    }
  }

  window.LexiAudioStorage = {
    databaseName: AUDIO_DB_NAME,
    storeName: AUDIO_STORE,
    indexKey: AUDIO_INDEX_KEY,
    ready,
    getIndex,
    getAll: (...args) => serialize(() => getAll(...args)),
    getAllKeys: (...args) => serialize(() => getAllKeys(...args)),
    verifyIndexedAudio: (...args) => serialize(() => verifyIndexedAudio(...args)),
    get: (...args) => serialize(() => get(...args)),
    put: (...args) => serialize(() => put(...args)),
    deleteKey: (...args) => serialize(() => deleteKey(...args)),
    readStats: (...args) => serialize(() => readStats(...args)),
    readActualStats: (...args) => serialize(() => readActualStats(...args)),
    deleteDatabase: (...args) => serialize(() => deleteDatabase(...args))
  };
})();
