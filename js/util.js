/**
 * Tiny, dependency-free helpers shared across SmileWeb.
 * Kept pure so they can be unit-tested without a DOM.
 */

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value, min = 0, max = 1) {
  if (Number.isNaN(value) || value == null) return min;
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation between `a` and `b`. */
export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Format an integer with locale-aware thousands separators. */
export function formatNumber(value, locale = undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
}

/** Format a duration in ms as `1h 04m`, `4m 20s` or `12s`. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** Locale-independent "is it today" helper (used for daily stats rollover). */
export function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Stable 32-bit FNV-1a hash rendered in base 36.
 * Used to give every joke a short, deterministic id that survives re-generation.
 */
export function hashString(input) {
  let hash = 0x811c9dc5;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Normalise a joke for comparison: lowercase, collapse whitespace, drop
 * punctuation. Two jokes with the same normalised form are duplicates.
 */
export function normalizeText(input) {
  return String(input)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a stored joke into its setup and punchline.
 * A joke uses a single blank line (`\n\n`) to separate the two parts.
 */
export function splitJoke(text) {
  const source = String(text ?? '').trim();
  const index = source.indexOf('\n\n');
  if (index === -1) return { setup: source, punchline: '' };
  return {
    setup: source.slice(0, index).trim(),
    punchline: source.slice(index + 2).trim(),
  };
}

/**
 * Remove accents/emoji/punctuation for the search index, keeping word order.
 * "Why don't scientists trust atoms?" -> "why dont scientists trust atoms"
 */
export function searchable(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201b\u2032']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escape a string for safe use inside a RegExp. */
export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Trailing-edge debounce. */
export function debounce(fn, wait = 200) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

/** Pick a random element from an array (returns undefined when empty). */
export function pick(array, rng = Math.random) {
  if (!Array.isArray(array) || array.length === 0) return undefined;
  return array[Math.floor(rng() * array.length) % array.length];
}

/** Fisher–Yates shuffle that does not mutate the input. */
export function shuffle(array, rng = Math.random) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Does the environment prefer reduced motion? */
export function prefersReducedMotion(matchMedia = globalThis.matchMedia) {
  if (typeof matchMedia !== 'function') return false;
  try {
    return Boolean(matchMedia('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

/** Copy text to the clipboard, with a legacy fallback. */
export async function copyText(text, doc = globalThis.document) {
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea trick */
  }
  try {
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.append(area);
    area.select();
    const ok = doc.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
