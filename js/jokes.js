/**
 * The joke library.
 *
 * The dataset is split into one file per category so the app never has to
 * download ten thousand jokes up front: the smile feed streams a random
 * category at a time, and the full index is only pulled in when somebody
 * searches or browses.
 */
import { APP, SEARCH_MAX_LENGTH } from './constants.js';
import { normalizeText, searchable, shuffle, splitJoke } from './util.js';

/** Build the rich joke object used throughout the UI. */
function toJoke(category, index, text) {
  const { setup, punchline } = splitJoke(text);
  return {
    id: `${category.id}:${index}`,
    index,
    text,
    setup,
    punchline,
    categoryId: category.id,
    categoryName: category.name,
    normalized: normalizeText(text),
    haystack: searchable(text),
  };
}

/** Join a base URL and a relative path without relying on the URL constructor. */
function joinUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

export class JokeStore {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] where the dataset lives.
   * @param {typeof fetch} [options.fetchImpl] injectable fetch (tests).
   * @param {() => number} [options.rng] injectable random source (tests).
   */
  constructor({ baseUrl = APP.dataDir, fetchImpl = globalThis.fetch, rng = Math.random } = {}) {
    this.baseUrl = baseUrl;
    // Bind so calling it as `this.fetchImpl(...)` keeps `window`/globalThis as the
    // receiver — native fetch throws "Illegal invocation" otherwise.
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : fetchImpl;
    this.rng = rng;

    /** @type {Promise<object>|null} */
    this._manifestPromise = null;
    /** @type {object|null} */
    this._manifest = null;
    /** @type {Map<string, Promise<Array<object>>>} */
    this._chunks = new Map();
    /** @type {Array<object>|null} */
    this._all = null;

    // Deck state for the non-repeating random feed.
    this._order = [];
    this._queue = [];
    this._lastId = null;
    /** @type {Set<string>} ids served recently, used to avoid deja vu. */
    this._recent = new Set();
  }

  /** Fetch (once) and cache the dataset manifest. */
  async loadManifest() {
    this._manifestPromise ??= (async () => {
      const url = joinUrl(this.baseUrl, APP.manifestFile);
      const response = await this.fetchImpl(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
      const manifest = await response.json();
      if (!manifest || !Array.isArray(manifest.categories)) {
        throw new Error('Joke manifest is malformed');
      }
      this._manifest = manifest;
      return manifest;
    })();
    return this._manifestPromise;
  }

  /** @returns {Array<{id: string, name: string, file: string, count: number}>} */
  get categories() {
    return this._manifest?.categories ?? [];
  }

  /** Total number of jokes in the dataset. */
  get total() {
    return (
      this._manifest?.total ??
      this.categories.reduce((sum, category) => sum + (category.count || 0), 0)
    );
  }

  /** Human name for a category id. */
  categoryName(id) {
    return this.categories.find((category) => category.id === id)?.name ?? 'Jokes';
  }

  /**
   * Load one category, memoised. Concurrency-safe: parallel callers share the
   * same promise.
   * @param {string} id
   * @returns {Promise<Array<object>>}
   */
  async loadCategory(id) {
    await this.loadManifest();
    const category = this.categories.find((entry) => entry.id === id);
    if (!category) throw new Error(`Unknown category "${id}"`);

    if (!this._chunks.has(id)) {
      this._chunks.set(
        id,
        (async () => {
          const url = joinUrl(this.baseUrl, category.file);
          const response = await this.fetchImpl(url, { cache: 'force-cache' });
          if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
          const raw = await response.json();
          const list = Array.isArray(raw) ? raw : raw?.jokes;
          if (!Array.isArray(list)) throw new Error(`Category "${id}" has no jokes array`);
          return list.map((text, index) => toJoke(category, index, String(text)));
        })(),
      );
    }
    return this._chunks.get(id);
  }

  /** Load every category and flatten them. Memoised. */
  async loadAll() {
    if (this._all) return this._all;
    await this.loadManifest();
    const chunks = await Promise.all(this.categories.map((category) => this.loadCategory(category.id)));
    this._all = chunks.flat();
    return this._all;
  }

  /** Number of categories already in memory (handy for tests/debugging). */
  get loadedCategoryCount() {
    return this._chunks.size;
  }

  /** Forget the deck so the next draw starts from a fresh shuffle. */
  resetDeck() {
    this._order = [];
    this._queue = [];
    this._recent.clear();
    this._lastId = null;
  }

  /** Refill the internal queue from the next category in the shuffled order. */
  async #refill() {
    await this.loadManifest();
    for (let attempt = 0; attempt < this.categories.length; attempt += 1) {
      if (this._order.length === 0) {
        this._order = shuffle(
          this.categories.map((category) => category.id),
          this.rng,
        );
      }
      const id = this._order.shift();
      const jokes = await this.loadCategory(id);
      const candidates = jokes.filter((joke) => !this._recent.has(joke.id));
      const pool = candidates.length > 0 ? candidates : jokes;
      if (candidates.length === 0) this._recent.clear();
      this._queue.push(...shuffle(pool, this.rng));
      if (this._queue.length > 0) return;
    }
  }

  /**
   * Draw the next joke for the smile feed, avoiding immediate repeats.
   * @returns {Promise<object>}
   */
  async draw() {
    if (this._queue.length === 0) await this.#refill();
    let joke = this._queue.shift();
    if (!joke) {
      // Defensive: an empty dataset would otherwise loop forever.
      throw new Error('The joke library appears to be empty');
    }
    // Avoid handing out the exact same joke twice in a row.
    if (this._queue.length > 0 && joke.id === this._lastId) {
      this._queue.push(joke);
      joke = this._queue.shift() ?? joke;
    }
    this._lastId = joke.id;
    this._recent.add(joke.id);
    if (this._recent.size > 250) {
      // Keep the "recently seen" window bounded.
      const iterator = this._recent.values();
      for (let i = 0; i < 50; i += 1) {
        const next = iterator.next();
        if (next.done) break;
        this._recent.delete(next.value);
      }
    }
    return joke;
  }

  /** Draw several jokes in one go. */
  async drawMany(count) {
    const out = [];
    for (let i = 0; i < count; i += 1) out.push(await this.draw());
    return out;
  }

  /** Look a joke up by its stable id (requires the category to be loaded). */
  async byId(id) {
    const [categoryId] = String(id).split(':');
    if (!categoryId) return null;
    const jokes = await this.loadCategory(categoryId);
    return jokes.find((joke) => joke.id === id) ?? null;
  }

  /**
   * Search the whole library.
   *
   * @param {object} [options]
   * @param {string} [options.query] free text.
   * @param {string} [options.categoryId] restrict to one category.
   * @param {boolean} [options.favoritesOnly] restrict to saved jokes.
   * @param {Array<{id:string,text:string,categoryId:string}>} [options.favorites]
   * @param {number} [options.limit]
   * @param {number} [options.offset]
   * @returns {Promise<{items: Array<object>, total: number}>}
   */
  async search(options = {}) {
    const {
      query = '',
      categoryId = '',
      favoritesOnly = false,
      favorites = [],
      limit = 24,
      offset = 0,
    } = options;

    const trimmed = String(query).trim().slice(0, SEARCH_MAX_LENGTH);
    const tokens = searchable(trimmed).split(' ').filter(Boolean);
    const phrase = searchable(trimmed);

    /** @type {Array<object>} */
    let pool;
    if (favoritesOnly) {
      const missing = favorites.filter((fav) => !fav.text);
      pool = favorites
        .filter((fav) => typeof fav?.text === 'string')
        .map((fav, index) => ({
          id: fav.id ?? `fav:${index}`,
          text: fav.text,
          setup: splitJoke(fav.text).setup,
          punchline: splitJoke(fav.text).punchline,
          categoryId: fav.categoryId ?? '',
          categoryName: this.categoryName(fav.categoryId) || 'Saved',
          normalized: normalizeText(fav.text),
          haystack: searchable(fav.text),
        }));
      void missing;
    } else {
      pool = await this.loadAll();
    }

    if (categoryId) pool = pool.filter((joke) => joke.categoryId === categoryId);

    let matches;
    if (tokens.length === 0) {
      matches = pool.map((joke) => ({ joke, rank: 0 }));
    } else {
      matches = [];
      for (const joke of pool) {
        const haystack = joke.haystack;
        let ok = true;
        for (const token of tokens) {
          if (!haystack.includes(token)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const rank = phrase && haystack.includes(phrase) ? 2 : 1;
        matches.push({ joke, rank });
      }
      matches.sort((a, b) => b.rank - a.rank || a.joke.id.localeCompare(b.joke.id));
    }

    const items = matches.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
    return { items: items.map((entry) => entry.joke), total: matches.length };
  }
}

/* -------------------------------------------------------------------------- */
/* Favourites helpers (pure)                                                   */
/* -------------------------------------------------------------------------- */

/** Is this joke already saved? Compares normalised text so ids may change. */
export function isFavorite(favorites, joke) {
  if (!Array.isArray(favorites) || !joke) return false;
  const key = joke.normalized ?? normalizeText(joke.text ?? '');
  return favorites.some(
    (fav) => fav.id === joke.id || (fav.text && normalizeText(fav.text) === key),
  );
}

/**
 * Toggle a joke in the favourites list.
 * @returns {{ favorites: Array<object>, saved: boolean }}
 */
export function toggleFavorite(favorites, joke, limit = 500) {
  const list = Array.isArray(favorites) ? favorites : [];
  if (isFavorite(list, joke)) {
    const key = joke.normalized ?? normalizeText(joke.text ?? '');
    return {
      saved: false,
      favorites: list.filter(
        (fav) => fav.id !== joke.id && normalizeText(fav.text ?? '') !== key,
      ),
    };
  }
  const entry = {
    id: joke.id,
    text: joke.text,
    categoryId: joke.categoryId,
    savedAt: Date.now(),
  };
  return { saved: true, favorites: [entry, ...list].slice(0, limit) };
}
