/**
 * A very small, defensive wrapper around localStorage.
 *
 * Storage can throw (Safari private mode, disabled cookies, quota) so every
 * access is guarded and falls back to an in-memory map. Nothing here ever
 * throws into the app.
 */

const memory = new Map();

/** Feature-detect a working localStorage. */
function detectStorage(scope = globalThis) {
  try {
    const store = scope.localStorage;
    const probe = '__smileweb_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export class SafeStorage {
  /** @param {object} [scope] injectable scope, handy in tests. */
  constructor(scope = globalThis) {
    this.store = detectStorage(scope);
  }

  /** @returns {boolean} whether durable storage is available. */
  get persistent() {
    return this.store != null;
  }

  /**
   * @template T
   * @param {string} key
   * @param {T} fallback
   * @returns {T}
   */
  get(key, fallback = null) {
    try {
      const raw = this.store ? this.store.getItem(key) : memory.get(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  /**
   * @param {string} key
   * @param {unknown} value
   * @returns {boolean} success
   */
  set(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (this.store) this.store.setItem(key, raw);
      else memory.set(key, raw);
      return true;
    } catch {
      // Quota exceeded / private mode: keep the value in memory for this session.
      memory.set(key, raw);
      return false;
    }
  }

  /** Remove a single key. */
  remove(key) {
    try {
      if (this.store) this.store.removeItem(key);
    } catch {
      /* ignore */
    }
    memory.delete(key);
  }

  /** Forget everything SmileWeb owns. */
  clear(namespace = 'smileweb:') {
    try {
      if (this.store) {
        const doomed = [];
        for (let i = 0; i < this.store.length; i += 1) {
          const key = this.store.key(i);
          if (key && key.startsWith(namespace)) doomed.push(key);
        }
        for (const key of doomed) this.store.removeItem(key);
      }
    } catch {
      /* ignore */
    }
    memory.clear();
  }
}

export const storage = new SafeStorage();
