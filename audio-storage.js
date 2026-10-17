(() => {
  'use strict';

  const AUDIO_DB_NAME = 'music-pwa-audio-db';
  const AUDIO_DB_VERSION = 1;
  const AUDIO_STORE = 'audio';
  const LEGACY_DB_NAME = 'music-pwa-db';
  const nativeTransaction = IDBDatabase.prototype.transaction;
  let audioDb = null;

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

  const ready = openAudioDb();

  // Compatibility bridge: existing Lexi Music code still asks music-pwa-db for
  // a single "audio" transaction. Route only that exact case to the separate
  // disposable audio database. Library and every other transaction stay on the
  // original music-pwa-db unchanged. Never fall back to the legacy audio store.
  IDBDatabase.prototype.transaction = function(storeNames, mode, options) {
    const names = typeof storeNames === 'string' ? [storeNames] : Array.from(storeNames || []);
    if (this.name === LEGACY_DB_NAME && names.length === 1 && names[0] === AUDIO_STORE) {
      if (!audioDb) throw new DOMException('Dedicated offline audio storage is not ready.', 'InvalidStateError');
      return nativeTransaction.call(audioDb, AUDIO_STORE, mode, options);
    }
    return nativeTransaction.call(this, storeNames, mode, options);
  };

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Offline audio storage request failed.'));
    });
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

  async function readStats() {
    const db = await openAudioDb();
    const transaction = nativeTransaction.call(db, AUDIO_STORE, 'readonly');
    const store = transaction.objectStore(AUDIO_STORE);
    return new Promise((resolve, reject) => {
      let count = 0;
      let bytes = 0;
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve({ count, bytes });
          return;
        }
        count += 1;
        bytes += storedAudioSize(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('Could not read offline audio storage.'));
      transaction.onabort = () => reject(transaction.error || new Error('Offline audio storage read was cancelled.'));
    });
  }

  async function deleteKey(id) {
    const db = await openAudioDb();
    const transaction = nativeTransaction.call(db, AUDIO_STORE, 'readwrite');
    await requestPromise(transaction.objectStore(AUDIO_STORE).delete(id));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not remove offline audio.'));
      transaction.onabort = () => reject(transaction.error || new Error('Offline audio removal was cancelled.'));
    });
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
    readStats,
    deleteKey,
    deleteDatabase
  };
})();