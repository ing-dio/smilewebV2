#!/usr/bin/env node
/**
 * Zero-dependency static server for SmileWeb.
 *
 * Why not `python -m http.server`? Because we want the production headers:
 *   - pre-compressed responses (gzip / brotli) for CSS, JS and the joke data,
 *   - long-lived immutable caching for hashed-free assets + revalidation for HTML,
 *   - a strict Content-Security-Policy (the app loads the face model from a CDN),
 *   - and `Permissions-Policy: camera=(self)` so the webcam keeps working.
 *
 * Usage:  node scripts/serve.mjs [--port 4173] [--host 127.0.0.1]
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, open } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.webmanifest', '.txt']);

/** Cache policy per file type. */
function cacheControl(pathname) {
  if (pathname === '/' || pathname.endsWith('index.html') || pathname.endsWith('sw.js')) {
    return 'no-cache';
  }
  if (pathname.startsWith('/assets/')) return 'public, max-age=604800';
  if (pathname.startsWith('/data/')) return 'public, max-age=86400';
  return 'public, max-age=3600';
}

/**
 * The CSP needs a few allowances:
 *   - 'wasm-unsafe-eval' for the MediaPipe WebAssembly module,
 *   - jsdelivr/unpkg for the runtime and Google Storage for the model,
 *   - blob: workers, because MediaPipe spawns its own worker,
 *   - 'unsafe-inline' styles, because the app sets inline styles from JS.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' data: blob: https://cdn.jsdelivr.net https://unpkg.com https://storage.googleapis.com",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** Resolve a URL pathname to a real file inside ROOT (or null). */
async function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.split('?')[0]);
  } catch {
    return null;
  }
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  let target = join(ROOT, relative);
  if (!target.startsWith(ROOT + sep) && target !== ROOT) return null;

  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
  } catch {
    return null;
  }

  try {
    const info = await stat(target);
    return info.isFile() ? { path: target, size: info.size } : null;
  } catch {
    return null;
  }
}

/** Read the first bytes of a file so we can honour Range-less HEAD cheaply. */
async function readHead(path, bytes = 0) {
  if (bytes <= 0) return Buffer.alloc(0);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function createStaticServer({ root = ROOT, logger = console } = {}) {
  return createServer(async (req, res) => {
    const pathname = req.url ?? '/';

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS });
      res.end('Method Not Allowed');
      return;
    }

    const file = await resolveFile(pathname);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
      res.end('<!doctype html><title>404</title><p>Not found. <a href="/">Go home</a>.');
      return;
    }

    const ext = extname(file.path).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Cache-Control': cacheControl(file.path.slice(root.length) || '/'),
      ...SECURITY_HEADERS,
      Vary: 'Accept-Encoding',
    };

    const accept = String(req.headers['accept-encoding'] ?? '');
    const small = file.size < 3 * 1024 * 1024;
    if (COMPRESSIBLE.has(ext) && small && accept) {
      const body = await readHead(file.path, file.size);
      /** @type {Buffer|null} */
      let compressed = null;
      if (accept.includes('br')) {
        compressed = brotliCompressSync(body);
        headers['Content-Encoding'] = 'br';
      } else if (accept.includes('gzip')) {
        compressed = gzipSync(body);
        headers['Content-Encoding'] = 'gzip';
      }
      if (compressed) {
        headers['Content-Length'] = String(compressed.length);
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : compressed);
        return;
      }
    }

    headers['Content-Length'] = String(file.size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file.path).pipe(res);
    void logger;
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const valueOf = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
  };
  const port = Number(valueOf('--port', process.env.PORT ?? 4173));
  const host = valueOf('--host', '127.0.0.1');
  const server = createStaticServer();
  server.listen(port, host, () => {
    console.log(`SmileWeb running at http://${host}:${port}/`);
    console.log('Camera access requires localhost or https — this is localhost, so you are fine.');
  });
}
