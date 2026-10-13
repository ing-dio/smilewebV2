import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_TOTAL } from '../../tools/data/target.mjs';
import { fingerprint, validateJoke } from '../../tools/data/validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const BANK_DIR = resolve(ROOT, 'tools/data/banks');
const DAD_JOKES = resolve(ROOT, 'tools/data/dadjokes.json');
const MANIFEST = resolve(ROOT, 'data/manifest.json');

/** Load every source bank, mirroring tools/build-jokes.mjs. */
async function loadSources() {
  const files = readdirSync(BANK_DIR)
    .filter((name) => name.endsWith('.mjs'))
    .sort();
  const banks = [];
  for (const file of files) {
    const module = await import(pathToFileURL(resolve(BANK_DIR, file)).href);
    banks.push({ file, category: module.default.category, jokes: module.default.jokes });
  }
  if (existsSync(DAD_JOKES)) {
    banks.push({
      file: 'dadjokes.json',
      category: 'Classic Dad Jokes',
      jokes: JSON.parse(readFileSync(DAD_JOKES, 'utf8')),
    });
  }
  return banks;
}

/** Validate + de-duplicate exactly like the builder. */
function curate(banks) {
  const seen = new Set();
  const accepted = [];
  for (const bank of banks) {
    for (const raw of bank.jokes) {
      const result = validateJoke(raw);
      if (!result.ok) continue;
      const key = fingerprint(result.text);
      if (seen.has(key)) continue;
      seen.add(key);
      accepted.push({ category: bank.category, text: result.text });
    }
  }
  return accepted;
}

const banks = await loadSources();
const accepted = curate(banks);

describe('joke dataset', () => {
  it('loads a healthy number of source banks', () => {
    expect(banks.length).toBeGreaterThanOrEqual(10);
    expect(banks.every((bank) => typeof bank.category === 'string')).toBe(true);
  });

  it('reaches the advertised total after curation', () => {
    expect(TARGET_TOTAL).toBe(10_000);
    expect(accepted.length).toBeGreaterThanOrEqual(TARGET_TOTAL);
  });

  it('contains no duplicate jokes', () => {
    const fingerprints = accepted.map((entry) => fingerprint(entry.text));
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it('every shipped joke passes validation', () => {
    const failures = accepted.filter((entry) => !validateJoke(entry.text).ok);
    expect(failures).toEqual([]);
  });

  it('covers a broad spread of categories with real volume', () => {
    const counts = new Map();
    for (const entry of accepted) {
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThanOrEqual(8);
    for (const [category, count] of counts) {
      expect(count, `${category} should have a meaningful number of jokes`).toBeGreaterThan(100);
    }
  });

  it('ships a built manifest that matches the sources', () => {
    if (!existsSync(MANIFEST)) return; // `npm run build:jokes` has not run yet
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    expect(manifest.total).toBeGreaterThanOrEqual(TARGET_TOTAL);
    expect(manifest.total).toBe(
      manifest.categories.reduce((sum, category) => sum + category.count, 0),
    );
    for (const category of manifest.categories) {
      const list = JSON.parse(readFileSync(resolve(ROOT, 'data', category.file), 'utf8'));
      expect(list.length).toBe(category.count);
      expect(list.every((text) => validateJoke(text).ok)).toBe(true);
    }
  });
});
