/**
 * Shared joke validation.
 *
 * Used by the dataset builder (to reject bad entries before they ship) and by
 * the unit tests (to guarantee the shipped dataset stays clean).
 */

/** Absolute minimum / maximum length of a joke in characters. */
export const MIN_LENGTH = 12;
export const MAX_LENGTH = 260;

/**
 * Words we never want in a family-friendly joke library.
 *
 * This is deliberately broad: it is a safety net around machine-authored
 * content, not a linguistic classifier. False positives are cheap (we drop a
 * joke), false negatives are not.
 */
/** Matched as whole words (safe to require a trailing boundary). */
const BLOCKED_WHOLE_WORDS = [
  'fuck', 'fuk', 'fck', 'shit', 'sht', 'bitch', 'bastard', 'asshole', 'arsehole',
  'cunt', 'dick', 'cock', 'penis', 'vagina', 'pussy', 'porn', 'rape', 'nigg',
  'fag', 'retard', 'slut', 'whore', 'boob', 'boobs', 'nipple', 'condom',
  'horny', 'naked', 'nude', 'tampon', 'tampax', 'cocaine', 'heroin', 'meth',
  'marijuana', 'weed', 'drunk', 'hangover', 'suicide', 'murder', 'corpse',
  'kidnap', 'gun', 'knife', 'blood', 'cancer', 'racist', 'nazi', 'stupid',
  'idiot', 'moron', 'imbecile', 'damn', 'hell', 'wtf', 'stfu', 'piss', 'fart',
  'poop', 'diarrhea', 'rectum', 'anus', 'virgin', 'erotic', 'orgasm', 'sexy',
  'killed', 'killing', 'dies', 'death', 'died', 'dead', 'hate', 'hates',
  'god', 'jesus', 'christ', 'church', 'beer', 'wine', 'vodka', 'whisky',
  'whiskey', 'alcohol',
];

/** Matched as prefixes so inflected forms are caught too. */
const BLOCKED_STEMS = [
  'masturbat', 'prostitut', 'seduc', 'sex', 'nigg', 'rape',
];

const BLOCKED_PATTERNS = [
  /\b(https?:\/\/|www\.)/i,
  /\breddit\b/i,
  /\b\d{1,3}\s?(mg|ml|pills?)\b/i,
  /\bkill(s|ed|ing)?\b/i,
  /\bmurder(s|ed|ing)?\b/i,
];

const BLOCKED_RE = new RegExp(
  [
    `\\b(${BLOCKED_WHOLE_WORDS.join('|')})\\b`,
    `\\b(${BLOCKED_STEMS.join('|')})`,
  ].join('|'),
  'i',
);

/**
 * Validate a single joke.
 *
 * @param {unknown} value
 * @returns {{ ok: true, text: string } | { ok: false, reason: string }}
 */
export function validateJoke(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not-a-string' };

  // Normalise whitespace but keep the meaningful line breaks.
  let text = value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  if (text.length < MIN_LENGTH) return { ok: false, reason: 'too-short' };
  if (text.length > MAX_LENGTH) return { ok: false, reason: 'too-long' };
  if (text.split('\n\n').length > 2) return { ok: false, reason: 'too-many-parts' };
  if (/[\t\r]/.test(text)) return { ok: false, reason: 'control-chars' };
  if (text.includes('  ')) return { ok: false, reason: 'double-space' };

  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 8) return { ok: false, reason: 'not-enough-letters' };
  if (letters / text.length < 0.55) return { ok: false, reason: 'not-written-in-words' };

  // Reject SHOUTING (allow short acronyms and emoji-free text only).
  const upper = (text.match(/[A-Z]/g) ?? []).length;
  if (upper / letters > 0.6 && letters > 12) return { ok: false, reason: 'shouting' };

  if (BLOCKED_RE.test(text)) return { ok: false, reason: 'blocked-word' };
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) return { ok: false, reason: `blocked-pattern:${pattern.source}` };
  }

  if (!/[.!?]/.test(text)) return { ok: false, reason: 'no-terminator' };
  if (/\(\s*\)|\[\s*\]/.test(text)) return { ok: false, reason: 'empty-brackets' };

  return { ok: true, text };
}

/** Convert a category name into a URL/file-safe slug. */
export function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Normalised form used for duplicate detection. */
export function fingerprint(text) {
  return String(text)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Additional check: does a joke contain a `\n\n` in the right place? */
export function isStructured(text) {
  return text.includes('\n\n');
}
