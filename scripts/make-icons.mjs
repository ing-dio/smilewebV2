#!/usr/bin/env node
/**
 * Rasterises the SmileWeb smiley into PNGs using nothing but Node's built-in
 * zlib. No image libraries, no native builds — the icons are reproducible from
 * source and regenerate with `npm run build:icons`.
 *
 * Produces:
 *   assets/icon-192.png
 *   assets/icon-512.png
 *   assets/icon-maskable-512.png  (extra safe padding for Android)
 */
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'assets');

/* -------------------------------------------------------------------------- */
/* Minimal PNG writer (8-bit RGBA, filter type 0)                             */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** @param {number} width @param {number} height @param {Buffer} rgba */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Prefix every scanline with filter byte 0.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                    */
/* -------------------------------------------------------------------------- */

const COLORS = {
  face: [242, 165, 22],
  faceTop: [255, 209, 102],
  ink: [42, 31, 4],
  background: [20, 24, 33],
};

/** Smooth 0..1 coverage for anti-aliasing an implicit shape. */
function coverage(distance, edge, softness) {
  if (distance <= edge - softness) return 1;
  if (distance >= edge + softness) return 0;
  const t = (edge + softness - distance) / (softness * 2);
  return t * t * (3 - 2 * t);
}

function mix(base, over, alpha) {
  return base + (over - base) * alpha;
}

/**
 * Draw the smiley.
 * @param {number} size output size in px.
 * @param {number} padding fraction of the size kept free on each side.
 * @param {boolean} withBackground draw the dark rounded square behind the face.
 */
function drawSmiley(size, padding, withBackground) {
  const pixels = Buffer.alloc(size * size * 4);
  const softness = Math.max(0.75, size / 512);
  const radius = size * (0.5 - padding);
  const cx = size / 2;
  const cy = size / 2;
  const cornerRadius = size * 0.22;

  // Eye + mouth geometry, expressed as fractions of the face radius.
  const eyeRadius = radius * 0.125;
  const eyeOffsetX = radius * 0.34;
  const eyeOffsetY = radius * 0.17;
  const mouthRadius = radius * 0.5;
  const mouthWidth = radius * 0.13;
  const mouthCy = cy + radius * 0.02;
  const mouthStart = 0.18 * Math.PI;
  const mouthEnd = 0.82 * Math.PI;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (withBackground) {
        // Rounded-square background.
        const dx = Math.abs(px - cx) - (size / 2 - cornerRadius);
        const dy = Math.abs(py - cy) - (size / 2 - cornerRadius);
        const outside =
          Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - cornerRadius;
        const bgAlpha = coverage(outside, 0, softness);
        r = COLORS.background[0];
        g = COLORS.background[1];
        b = COLORS.background[2];
        a = bgAlpha;
      }

      // Face disc with a subtle vertical gradient.
      const distFromCentre = Math.hypot(px - cx, py - cy);
      const faceAlpha = coverage(distFromCentre, radius, softness);
      if (faceAlpha > 0) {
        const t = Math.max(0, Math.min(1, (py - (cy - radius)) / (radius * 2)));
        const fr = mix(COLORS.faceTop[0], COLORS.face[0], t);
        const fg = mix(COLORS.faceTop[1], COLORS.face[1], t);
        const fb = mix(COLORS.faceTop[2], COLORS.face[2], t);
        r = mix(r, fr, faceAlpha);
        g = mix(g, fg, faceAlpha);
        b = mix(b, fb, faceAlpha);
        a = Math.max(a, faceAlpha);
      }

      // Eyes.
      const eyeDistance = Math.min(
        Math.hypot(px - (cx - eyeOffsetX), py - (cy - eyeOffsetY)),
        Math.hypot(px - (cx + eyeOffsetX), py - (cy - eyeOffsetY)),
      );
      const eyeAlpha = coverage(eyeDistance, eyeRadius, softness) * faceAlpha;
      if (eyeAlpha > 0) {
        r = mix(r, COLORS.ink[0], eyeAlpha);
        g = mix(g, COLORS.ink[1], eyeAlpha);
        b = mix(b, COLORS.ink[2], eyeAlpha);
      }

      // Mouth: an arc, i.e. the ring segment below the centre.
      const angle = Math.atan2(py - mouthCy, px - cx);
      const inArc = angle >= mouthStart && angle <= mouthEnd;
      if (inArc) {
        const ringDistance = Math.abs(distFromCentre - mouthRadius);
        const mouthAlpha = coverage(ringDistance, mouthWidth / 2, softness) * faceAlpha;
        if (mouthAlpha > 0) {
          r = mix(r, COLORS.ink[0], mouthAlpha);
          g = mix(g, COLORS.ink[1], mouthAlpha);
          b = mix(b, COLORS.ink[2], mouthAlpha);
        }
      }

      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(Math.max(0, Math.min(255, r)));
      pixels[offset + 1] = Math.round(Math.max(0, Math.min(255, g)));
      pixels[offset + 2] = Math.round(Math.max(0, Math.min(255, b)));
      pixels[offset + 3] = Math.round(Math.max(0, Math.min(255, a * 255)));
    }
  }

  return pixels;
}

async function main() {
  await mkdir(ASSETS, { recursive: true });
  const jobs = [
    { file: 'icon-192.png', size: 192, padding: 0.16, background: false },
    { file: 'icon-512.png', size: 512, padding: 0.16, background: false },
    // Maskable icons must keep everything inside a centred 80% safe zone.
    { file: 'icon-maskable-512.png', size: 512, padding: 0.24, background: true },
  ];

  for (const job of jobs) {
    const png = encodePng(job.size, job.size, drawSmiley(job.size, job.padding, job.background));
    await writeFile(resolve(ASSETS, job.file), png);
    console.log(`  wrote assets/${job.file} (${job.size}×${job.size}, ${png.length} bytes)`);
  }
}

await main();
