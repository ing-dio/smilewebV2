#!/usr/bin/env node
/**
 * Project self-check.
 *
 * Runs the dataset build, then asserts that every shipped artefact is present
 * and sane: the joke library reaches its target, the manifest matches the
 * per-category files, the PWA icons are real PNGs and every source module
 * exists. Exits non-zero (and prints a report) if anything is wrong.
 *
 * Usage:  npm run verify
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_TOTAL } from '../tools/data/target.mjs';
import { fingerprint, validateJoke } from '../tools/data/validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const problems = [];
const notes = [];
const fail = (message) => problems.push(message);
const ok = (message) => notes.push(message);

function checkFile(relative, { minBytes = 1 } = {}) {
  const path = resolve(ROOT, relative);
  if (!existsSync(path)) {
    fail(`missing file: ${relative}`);
    return null;
  }
  const size = statSync(path).size;
  if (size < minBytes) {
    fail(`${relative} looks empty (${size} bytes)`);
    return null;
  }
  return path;
}

function isPng(path) {
  const bytes = readFileSync(path).subarray(0, 8);
  return bytes.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

/* ------------------------------------------------------------------ */
/* 1. Build the dataset fresh so the checks below mean something.      */
/* ------------------------------------------------------------------ */
console.log('SmileWeb self-check');
console.log('───────────────────');
try {
  execFileSync(process.execPath, ['tools/build-jokes.mjs'], { cwd: ROOT, stdio: 'inherit' });
  ok('dataset build completed');
} catch {
  fail('dataset build failed (run `npm run build:jokes` to see why)');
}

/* ------------------------------------------------------------------ */
/* 2. Required files exist and are not empty.                          */
/* ------------------------------------------------------------------ */
const REQUIRED = [
  'index.html',
  'sw.js',
  'css/styles.css',
  'js/app.js',
  'js/camera.js',
  'js/celebration.js',
  'js/constants.js',
  'js/face-model.js',
  'js/jokes.js',
  'js/smile-engine.js',
  'js/stats.js',
  'js/storage.js',
  'js/theme.js',
  'js/ui.js',
  'js/util.js',
  'scripts/serve.mjs',
  'scripts/make-icons.mjs',
  'tools/build-jokes.mjs',
  'tools/data/validate.mjs',
  'tools/data/target.mjs',
  'assets/icon.svg',
  'assets/manifest.webmanifest',
  'data/manifest.json',
];
for (const relative of REQUIRED) checkFile(relative);

/* ------------------------------------------------------------------ */
/* 3. PWA icons are real PNGs.                                         */
/* ------------------------------------------------------------------ */
for (const icon of ['assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png']) {
  const path = checkFile(icon, { minBytes: 100 });
  if (path && !isPng(path)) fail(`${icon} is not a valid PNG`);
}

/* ------------------------------------------------------------------ */
/* 4. The dataset meets the target and the manifest matches the files. */
/* ------------------------------------------------------------------ */
try {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'data/manifest.json'), 'utf8'));
  if (manifest.total < TARGET_TOTAL) {
    fail(`dataset has ${manifest.total} jokes, target is ${TARGET_TOTAL}`);
  } else {
    ok(`dataset has ${manifest.total} jokes (target ${TARGET_TOTAL})`);
  }

  const seen = new Set();
  let duplicates = 0;
  let invalid = 0;
  let counted = 0;

  for (const category of manifest.categories) {
    const list = JSON.parse(readFileSync(resolve(ROOT, 'data', category.file), 'utf8'));
    if (list.length !== category.count) {
      fail(`${category.file} has ${list.length} jokes but the manifest says ${category.count}`);
    }
    for (const text of list) {
      counted += 1;
      const result = validateJoke(text);
      if (!result.ok) invalid += 1;
      const key = fingerprint(text);
      if (seen.has(key)) duplicates += 1;
      else seen.add(key);
    }
  }

  if (counted !== manifest.total) fail(`counted ${counted} jokes, manifest says ${manifest.total}`);
  if (duplicates > 0) fail(`${duplicates} duplicate jokes in the shipped dataset`);
  if (invalid > 0) fail(`${invalid} jokes in the shipped dataset fail validation`);
  if (duplicates === 0 && invalid === 0) ok('every shipped joke is unique and valid');
} catch (error) {
  fail(`could not verify the dataset: ${error.message}`);
}

/* ------------------------------------------------------------------ */
/* 5. Report.                                                          */
/* ------------------------------------------------------------------ */
if (problems.length > 0) {
  console.error('\n✗ Problems:');
  for (const problem of problems) console.error(`   - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\n✓ All checks passed:');
  for (const note of notes) console.log(`   - ${note}`);
}
