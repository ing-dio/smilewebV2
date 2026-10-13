/**
 * Harvests the public icanhazdadjoke.com corpus (744 family friendly dad jokes).
 *
 * The result is written to `tools/data/dadjokes.json` and is later merged into the
 * generated dataset by `tools/build-jokes.mjs`.
 *
 * Run with:  node tools/data/fetch-dadjokes.mjs
 * The script is idempotent and cached: if the seed file already exists it does nothing
 * unless `--force` is passed.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'dadjokes.json');
const FIRST_PAGE = 'https://icanhazdadjoke.com/search?limit=20&page=1';
const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'SmileWeb dataset builder (https://github.com/smileweb)',
};

/** Fetches one page of the search API. */
async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`icanhazdadjoke responded ${res.status} for ${url}`);
  return res.json();
}

/** Small delay so we stay a polite API citizen. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function harvest({ force = false } = {}) {
  await mkdir(HERE, { recursive: true });

  if (!force) {
    try {
      const existing = JSON.parse(await readFile(OUT, 'utf8'));
      if (Array.isArray(existing) && existing.length > 0) return existing;
    } catch {
      /* no cache yet - fall through and fetch */
    }
  }

  const jokes = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await fetchPage(`${FIRST_PAGE.split('&page=')[0]}&page=${page}`);
    totalPages = data.total_pages ?? 1;
    for (const item of data.results ?? []) {
      const text = String(item.joke ?? '').replace(/\s+/g, ' ').trim();
      if (text) jokes.push(text);
    }
    page += 1;
    if (page <= totalPages) await sleep(120);
  } while (page <= totalPages);

  const unique = [...new Set(jokes)].sort();
  await writeFile(OUT, `${JSON.stringify(unique, null, 0)}\n`, 'utf8');
  return unique;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const jokes = await harvest({ force: process.argv.includes('--force') });
  console.log(`dadjokes seed: ${jokes.length} jokes -> tools/data/dadjokes.json`);
}
