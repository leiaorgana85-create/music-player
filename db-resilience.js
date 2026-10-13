(() => {
  'use strict';

  const proto = globalThis.IDBDatabase?.prototype;
  if (!proto || proto.__musicDbResiliencePatched) return;

  const nativeTransaction = proto.transaction;
  const RECOVERY_KEY = 'musicPwaDbRecoveryAt';

  function isRecoverableIndexedDbError(error) {
    const name = String(error?.name || '');
    const message = String(error?.message || '');
    return (
      name === 'InvalidStateError' && /database connection is (closing|closed)|connection is (closing|closed)/i.test(message)
    ) || (
      name === 'UnknownError' && /indexed database server|connection to indexed database server lost/i.test(message)
    );
  }

  function reloadForFreshDatabaseConnection() {
    const now = Date.now();
    let last = 0;
    try { last = Number(sessionStorage.getItem(RECOVERY_KEY) || 0); } catch {}
    if (now - last < 5000) return;
    try { sessionStorage.setItem(RECOVERY_KEY, String(now)); } catch {}
    setTimeout(() => location.reload(), 0);
  }

  Object.defineProperty(proto, '__musicDbResiliencePatched', {
    value: true,
    configurable: true
  });

  proto.transaction = function (...args) {
    try {
      return nativeTransaction.apply(this, args);
    } catch (error) {
      if (isRecoverableIndexedDbError(error)) reloadForFreshDatabaseConnection();
      throw error;
    }
  };

  window.addEventListener('unhandledrejection', event => {
    if (isRecoverableIndexedDbError(event.reason)) reloadForFreshDatabaseConnection();
  });
})();
