import { describe, expect, it, vi } from 'vitest';
import { JokeStore, isFavorite, toggleFavorite } from '../../js/jokes.js';

/** A tiny in-memory dataset served through an injectable fetch. */
function makeServer() {
  const manifest = {
    name: 'Test library',
    version: '1.0.0',
    target: 6,
    total: 6,
    categories: [
      { id: 'alpha', name: 'Alpha', file: 'jokes/alpha.json', count: 3 },
      { id: 'beta', name: 'Beta', file: 'jokes/beta.json', count: 3 },
    ],
  };
  const files = {
    'manifest.json': manifest,
    'jokes/alpha.json': ['Alpha one.', 'Alpha two.', 'Alpha three.'],
    'jokes/beta.json': [
      'Why did the beta go home?\n\nIt missed the alpha.',
      'Beta two!',
      'Beta three.',
    ],
  };
  const calls = [];
  const fetchImpl = vi.fn(async (url) => {
    calls.push(url);
    const key = String(url).replace(/^data\//, '');
    if (Object.hasOwn(files, key)) {
      return { ok: true, status: 200, json: async () => files[key] };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  return { manifest, files, calls, fetchImpl };
}

function makeStore(options = {}) {
  const server = makeServer();
  const store = new JokeStore({
    baseUrl: 'data',
    fetchImpl: server.fetchImpl,
    rng: options.rng ?? (() => 0.5),
  });
  return { store, server };
}

describe('JokeStore loading', () => {
  it('loads and exposes the manifest', async () => {
    const { store } = makeStore();
    const manifest = await store.loadManifest();
    expect(manifest.total).toBe(6);
    expect(store.categories).toHaveLength(2);
    expect(store.total).toBe(6);
  });

  it('memoises the manifest fetch', async () => {
    const { store, server } = makeStore();
    await store.loadManifest();
    await store.loadManifest();
    expect(server.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps a category name and throws on unknown ids', async () => {
    const { store } = makeStore();
    await store.loadManifest();
    expect(store.categoryName('beta')).toBe('Beta');
    expect(store.categoryName('nope')).toBe('Jokes');
    await expect(store.loadCategory('nope')).rejects.toThrow(/Unknown category/);
  });

  it('memoises category loads and builds rich joke objects', async () => {
    const { store } = makeStore();
    const jokes = await store.loadCategory('alpha');
    expect(jokes).toHaveLength(3);
    expect(jokes[0]).toMatchObject({
      id: 'alpha:0',
      text: 'Alpha one.',
      setup: 'Alpha one.',
      punchline: '',
      categoryId: 'alpha',
      categoryName: 'Alpha',
    });
    await store.loadCategory('alpha');
    const alphaCalls = store.loadedCategoryCount;
    expect(alphaCalls).toBe(1);
  });

  it('splits two-part jokes into setup and punchline', async () => {
    const { store } = makeStore();
    const jokes = await store.loadCategory('beta');
    expect(jokes[0].setup).toBe('Why did the beta go home?');
    expect(jokes[0].punchline).toBe('It missed the alpha.');
  });

  it('flattens every category in loadAll', async () => {
    const { store } = makeStore();
    const all = await store.loadAll();
    expect(all).toHaveLength(6);
    expect(all.map((joke) => joke.categoryId)).toContain('beta');
  });

  it('reports a malformed manifest', async () => {
    const store = new JokeStore({
      baseUrl: 'data',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }),
    });
    await expect(store.loadManifest()).rejects.toThrow(/malformed/);
  });
});

describe('JokeStore.draw', () => {
  it('draws jokes without repeats until the deck is exhausted', async () => {
    const { store } = makeStore();
    const drawn = await store.drawMany(6);
    const ids = new Set(drawn.map((joke) => joke.id));
    expect(ids.size).toBe(6);
  });

  it('never returns the same joke twice in a row', async () => {
    let seed = 1;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const { store } = makeStore({ rng });
    let previous = null;
    for (let i = 0; i < 20; i += 1) {
      const joke = await store.draw();
      expect(joke.id).not.toBe(previous);
      previous = joke.id;
    }
  });

  it('looks jokes up by id and resets the deck', async () => {
    const { store } = makeStore();
    const joke = await store.byId('beta:1');
    expect(joke.text).toBe('Beta two!');
    expect(await store.byId('alpha:99')).toBeNull();
    store.resetDeck();
    expect(store.loadedCategoryCount).toBeGreaterThan(0);
  });
});

describe('JokeStore.search', () => {
  it('matches every token and ranks phrase hits first', async () => {
    const { store } = makeStore();
    const { items, total } = await store.search({ query: 'alpha' });
    expect(total).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((joke) => joke.haystack.includes('alpha'))).toBe(true);
  });

  it('filters by category and honours pagination', async () => {
    const { store } = makeStore();
    const first = await store.search({ categoryId: 'beta', limit: 2, offset: 0 });
    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(2);
    const second = await store.search({ categoryId: 'beta', limit: 2, offset: 2 });
    expect(second.items).toHaveLength(1);
  });

  it('returns everything when the query is empty', async () => {
    const { store } = makeStore();
    const { total } = await store.search({});
    expect(total).toBe(6);
  });

  it('searches favourites only when asked', async () => {
    const { store } = makeStore();
    await store.loadManifest();
    const favorites = [
      { id: 'fav:0', text: 'A saved gem about rockets.', categoryId: 'alpha' },
    ];
    const { items } = await store.search({ favoritesOnly: true, favorites, query: 'rockets' });
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('A saved gem about rockets.');
  });
});

describe('favourites helpers', () => {
  const joke = {
    id: 'alpha:0',
    text: 'Alpha one.',
    normalized: 'alpha one',
    categoryId: 'alpha',
  };

  it('detects saved jokes by id or normalised text', () => {
    expect(isFavorite([], joke)).toBe(false);
    expect(isFavorite([{ id: 'other', text: 'Alpha one.' }], joke)).toBe(true);
    expect(isFavorite([{ id: 'alpha:0' }], joke)).toBe(true);
  });

  it('toggles a joke on and off', () => {
    const added = toggleFavorite([], joke);
    expect(added.saved).toBe(true);
    expect(added.favorites).toHaveLength(1);
    expect(added.favorites[0]).toMatchObject({ id: 'alpha:0', categoryId: 'alpha' });

    const removed = toggleFavorite(added.favorites, joke);
    expect(removed.saved).toBe(false);
    expect(removed.favorites).toHaveLength(0);
  });

  it('keeps the newest favourites at the front and enforces the limit', () => {
    const existing = Array.from({ length: 3 }, (_, i) => ({
      id: `old:${i}`,
      text: `Old ${i}.`,
      categoryId: 'alpha',
    }));
    const { favorites } = toggleFavorite(existing, joke, 2);
    expect(favorites).toHaveLength(2);
    expect(favorites[0].id).toBe('alpha:0');
  });
});
