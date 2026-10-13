import { describe, expect, it } from 'vitest';
import { SafeStorage } from '../../js/storage.js';

/** A minimal but faithful localStorage stand-in. */
function fakeLocalStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    _map: map,
  };
}

describe('SafeStorage', () => {
  it('reports persistent storage and round-trips JSON', () => {
    const scope = { localStorage: fakeLocalStorage() };
    const store = new SafeStorage(scope);
    expect(store.persistent).toBe(true);
    expect(store.get('missing', 'fallback')).toBe('fallback');
    expect(store.set('list', [1, 2, 3])).toBe(true);
    expect(store.get('list')).toEqual([1, 2, 3]);
  });

  it('falls back to memory when localStorage throws', () => {
    const scope = {
      get localStorage() {
        throw new Error('blocked');
      },
    };
    const store = new SafeStorage(scope);
    expect(store.persistent).toBe(false);
    expect(store.set('key', { a: 1 })).toBe(true);
    expect(store.get('key')).toEqual({ a: 1 });
  });

  it('returns the fallback when stored JSON is corrupt', () => {
    const local = fakeLocalStorage();
    local.setItem('broken', '{not json');
    const store = new SafeStorage({ localStorage: local });
    expect(store.get('broken', 'safe')).toBe('safe');
  });

  it('keeps the value in memory when setItem throws (quota)', () => {
    const local = fakeLocalStorage();
    local.setItem = () => {
      throw new Error('quota exceeded');
    };
    // detectStorage still succeeds because it calls set/remove; make remove work.
    local.removeItem = () => {};
    const store = new SafeStorage({ localStorage: local });
    // detectStorage probe fails, so we fall back to memory-only storage.
    expect(store.persistent).toBe(false);
    expect(store.set('k', 'v')).toBe(true);
    expect(store.get('k')).toBe('v');
  });

  it('removes single keys and clears the namespace only', () => {
    const local = fakeLocalStorage();
    local.setItem('smileweb:theme', '"dark"');
    local.setItem('smileweb:stats', '{}');
    local.setItem('other:thing', 'keep');
    const store = new SafeStorage({ localStorage: local });

    store.remove('smileweb:theme');
    expect(store.get('smileweb:theme')).toBeNull();

    store.clear('smileweb:');
    expect(store.get('smileweb:stats')).toBeNull();
    expect(local.getItem('other:thing')).toBe('keep');
  });
});
