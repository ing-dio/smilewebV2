#!/usr/bin/env node
/**
 * Builds the SmileWeb joke dataset.
 *
 *   tools/data/banks/*.mjs   hand-authored joke banks  ─┐
 *   tools/data/dadjokes.json harvested classic corpus  ─┼─► validate ─► dedupe ─►
 *                                                       ┘
 *   data/jokes/<category>.json  +  data/manifest.json
 *
 * The output is deterministic: running the builder twice produces byte-identical
 * files (the timestamp is the only thing that moves, and it lives in the
 * manifest so it can be ignored by tests).
 *
 * Usage:  node tools/build-jokes.mjs [--check]
 *         --check  fail (exit 1) if the dataset is smaller than the target.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TARGET_TOTAL } from './data/target.mjs';
import { fingerprint, slugify, validateJoke } from './data/validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BANK_DIR = resolve(HERE, 'data/banks');
const DAD_JOKES = resolve(HERE, 'data/dadjokes.json');
const OUT_DIR = resolve(ROOT, 'data');
const JOKES_DIR = resolve(OUT_DIR, 'jokes');
const MANIFEST = resolve(OUT_DIR, 'manifest.json');

/** Nice, stable ordering for the category filter in the UI. */
const CATEGORY_ORDER = [
  'Dad Jokes',
  'Puns',
  'Knock Knock',
  'Riddles',
  'Animal Antics',
  'Food & Drink',
  'Tech & Science',
  'Work & School',
  'Everyday Life',
  'Classic Dad Jokes',
];

/** Import every bank file, sorted by name so builds are reproducible. */
async function loadBanks() {
  let entries = [];
  try {
    entries = await readdir(BANK_DIR);
  } catch {
    return [];
  }
  const files = entries.filter((name) => name.endsWith('.mjs')).sort();
  const banks = [];
  for (const file of files) {
    const module = await import(pathToFileURL(resolve(BANK_DIR, file)).href);
    const data = module.default;
    if (!data || typeof data.category !== 'string' || !Array.isArray(data.jokes)) {
      console.warn(`  ! skipping ${file}: expected { category, jokes }`);
      continue;
    }
    banks.push({ file, category: data.category, jokes: data.jokes });
  }
  return banks;
}

/** The harvested icanhazdadjoke corpus. */
async function loadDadJokes() {
  try {
    const raw = JSON.parse(await readFile(DAD_JOKES, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return [{ file: 'dadjokes.json', category: 'Classic Dad Jokes', jokes: raw }];
  } catch {
    console.warn('  ! tools/data/dadjokes.json missing — run tools/data/fetch-dadjokes.mjs');
    return [];
  }
}

/** Validate + de-duplicate, reporting why entries were dropped. */
function curate(banks) {
  const seen = new Map(); // fingerprint -> category
  const accepted = [];
  const rejected = new Map();
  let duplicates = 0;

  const reject = (reason) => rejected.set(reason, (rejected.get(reason) ?? 0) + 1);

  for (const bank of banks) {
    for (const raw of bank.jokes) {
      const result = validateJoke(raw);
      if (!result.ok) {
        reject(result.reason);
        continue;
      }
      const key = fingerprint(result.text);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.set(key, bank.category);
      accepted.push({ category: bank.category, text: result.text });
    }
  }
  return { accepted, rejected, duplicates };
}

/** Group accepted jokes by category, preserving the curated order. */
function groupByCategory(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.category)) groups.set(entry.category, []);
    groups.get(entry.category).push(entry.text);
  }
  const names = [...groups.keys()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.localeCompare(b);
  });
  return names.map((name) => ({ name, jokes: groups.get(name) }));
}

async function main() {
  const check = process.argv.includes('--check');
  console.log('SmileWeb dataset build');
  console.log('──────────────────────');

  const banks = [...(await loadBanks()), ...(await loadDadJokes())];
  const sourceTotal = banks.reduce((sum, bank) => sum + bank.jokes.length, 0);
  console.log(`  source jokes ....... ${sourceTotal} from ${banks.length} banks`);

  const { accepted, rejected, duplicates } = curate(banks);
  console.log(`  duplicates dropped . ${duplicates}`);
  if (rejected.size > 0) {
    const detail = [...rejected.entries()].map(([reason, count]) => `${reason}×${count}`).join(', ');
    console.log(`  rejected ........... ${detail}`);
  }
  console.log(`  usable ............. ${accepted.length}`);

  const groups = groupByCategory(accepted);

  await rm(JOKES_DIR, { recursive: true, force: true });
  await mkdir(JOKES_DIR, { recursive: true });

  const categories = [];
  for (const group of groups) {
    const id = slugify(group.name);
    const file = `jokes/${id}.json`;
    await writeFile(resolve(OUT_DIR, file), JSON.stringify(group.jokes), 'utf8');
    categories.push({ id, name: group.name, file, count: group.jokes.length });
  }

  const manifest = {
    name: 'SmileWeb joke library',
    version: '1.0.0',
    target: TARGET_TOTAL,
    total: categories.reduce((sum, category) => sum + category.count, 0),
    categories,
  };
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('  categories .......');
  for (const category of categories) {
    console.log(`      ${category.name.padEnd(20)} ${String(category.count).padStart(5)}`);
  }
  console.log(`  TOTAL .............. ${manifest.total}`);

  if (manifest.total < TARGET_TOTAL) {
    const short = TARGET_TOTAL - manifest.total;
    console.warn(`  ! ${short} short of the ${TARGET_TOTAL} target`);
    if (check) process.exitCode = 1;
  } else {
    console.log(`  ✓ target of ${TARGET_TOTAL} reached`);
  }
}

await main();
