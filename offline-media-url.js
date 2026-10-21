(() => {
  'use strict';

  const storage = window.LexiAudioStorage;
  if (!storage?.get || window.__lexiOfflineMediaUrlInstalled) return;
  window.__lexiOfflineMediaUrlInstalled = true;

  const audioIdByBlob = new WeakMap();
  const originalGet = storage.get.bind(storage);
  const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
  const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  const endpoint = new URL('./__lexi_audio__', location.href).href;

  function toPlayableBlob(value) {
    if (value instanceof Blob) return value;
    if (value?.__musicBytes instanceof ArrayBuffer) {
      return new Blob([value.__musicBytes], { type: value.type || 'application/octet-stream' });
    }
    if (value instanceof ArrayBuffer) return new Blob([value], { type: 'application/octet-stream' });
    if (ArrayBuffer.isView(value)) {
      return new Blob([
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
      ], { type: 'application/octet-stream' });
    }
    return null;
  }

  storage.get = async key => {
    const row = await originalGet(key);
    if (!row?.blob) return row;
    const blob = toPlayableBlob(row.blob);
    if (!blob) return row;
    audioIdByBlob.set(blob, String(row.id || key || ''));
    return { ...row, blob };
  };

  URL.createObjectURL = value => {
    const id = value instanceof Blob ? audioIdByBlob.get(value) : null;
    if (!id) return nativeCreateObjectURL(value);
    const url = new URL(endpoint);
    url.searchParams.set('id', id);
    return url.href;
  };

  URL.revokeObjectURL = value => {
    if (typeof value === 'string' && value.startsWith(endpoint)) return;
    try { nativeRevokeObjectURL(value); } catch {}
  };
})();
