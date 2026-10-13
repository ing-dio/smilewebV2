import { describe, expect, it, vi } from 'vitest';
import {
  clamp,
  copyText,
  debounce,
  escapeRegExp,
  formatDuration,
  formatNumber,
  hashString,
  lerp,
  localDayKey,
  normalizeText,
  pick,
  prefersReducedMotion,
  searchable,
  shuffle,
  splitJoke,
} from '../../js/util.js';

describe('clamp / lerp', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('treats NaN and null as the minimum', () => {
    expect(clamp(Number.NaN)).toBe(0);
    expect(clamp(null)).toBe(0);
    expect(clamp(undefined, 2, 4)).toBe(2);
  });

  it('interpolates', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 2)).toBe(10);
  });
});

describe('formatNumber', () => {
  it('adds thousands separators', () => {
    expect(formatNumber(10000, 'en-US')).toBe('10,000');
    expect(formatNumber(0, 'en-US')).toBe('0');
  });

  it('respects an explicit locale', () => {
    expect(formatNumber(10000, 'de-DE')).toBe('10.000');
  });

  it('is defensive about junk input', () => {
    expect(formatNumber('nope')).toBe('0');
    expect(formatNumber(null)).toBe('0');
  });
});

describe('formatDuration', () => {
  it('renders seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(999)).toBe('1s');
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(3_600_000 + 4 * 60_000)).toBe('1h 04m');
  });

  it('never goes negative', () => {
    expect(formatDuration(-5000)).toBe('0s');
  });
});

describe('hashString', () => {
  it('is deterministic and input-sensitive', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
    expect(hashString('hello')).not.toBe(hashString('hellp'));
  });

  it('produces base36 output', () => {
    expect(hashString('why did the chicken cross the road?')).toMatch(/^[0-9a-z]+$/);
  });
});

describe('normalizeText', () => {
  it('lower-cases, strips punctuation and collapses space', () => {
    expect(normalizeText("  Why did  the CHICKEN   cross the road?!  ")).toBe(
      'why did the chicken cross the road',
    );
  });

  it('treats curly quotes as straight ones', () => {
    expect(normalizeText('I\u2019m here')).toBe(normalizeText("I'm here"));
  });
});

describe('searchable', () => {
  it('removes punctuation and accents for matching', () => {
    expect(searchable("Why don't scientists trust atoms?")).toBe(
      'why dont scientists trust atoms',
    );
    expect(searchable('Café')).toBe('cafe');
  });
});

describe('splitJoke', () => {
  it('splits setup and punchline on a blank line', () => {
    expect(splitJoke('Why did the chicken cross the road?\n\nTo get to the other side.')).toEqual({
      setup: 'Why did the chicken cross the road?',
      punchline: 'To get to the other side.',
    });
  });

  it('handles one-liners', () => {
    expect(splitJoke('I used to be a banker, but I lost interest.')).toEqual({
      setup: 'I used to be a banker, but I lost interest.',
      punchline: '',
    });
  });

  it('ignores surrounding whitespace and empty input', () => {
    expect(splitJoke('   hello  ')).toEqual({ setup: 'hello', punchline: '' });
    expect(splitJoke(null)).toEqual({ setup: '', punchline: '' });
  });

  it('keeps single newlines inside a part', () => {
    const { setup, punchline } = splitJoke('Knock, knock.\nWho is there?\n\nBoo!');
    expect(setup).toBe('Knock, knock.\nWho is there?');
    expect(punchline).toBe('Boo!');
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(new RegExp(escapeRegExp('a.b*c')).test('a.b*c')).toBe(true);
    expect(new RegExp(escapeRegExp('a.b*c')).test('axbxc')).toBe(false);
  });
});

describe('localDayKey', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(localDayKey(new Date(2026, 9, 13))).toBe('2026-10-13');
    expect(localDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('shuffle / pick', () => {
  it('shuffles without mutating and keeps every element', () => {
    const input = [1, 2, 3, 4, 5];
    const output = shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...output].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('is driven by the injected rng', () => {
    expect(shuffle([1, 2, 3], () => 0)).toEqual([2, 3, 1]);
  });

  it('picks deterministically and safely', () => {
    expect(pick(['a', 'b', 'c'], () => 0.99)).toBe('c');
    expect(pick([])).toBeUndefined();
    expect(pick(null)).toBeUndefined();
  });
});

describe('debounce', () => {
  it('collapses a burst of calls', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced(1);
    debounced(2);
    debounced(3);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
    vi.useRealTimers();
  });

  it('can be cancelled', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('prefersReducedMotion', () => {
  it('reads the media query', () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
  });

  it('is false when matchMedia is missing or throws', () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(
      prefersReducedMotion(() => {
        throw new Error('nope');
      }),
    ).toBe(false);
  });
});

describe('copyText', () => {
  it('uses the async clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    vi.unstubAllGlobals();
  });

  it('falls back to execCommand and reports failure', async () => {
    vi.stubGlobal('navigator', {});
    const execCommand = vi.fn().mockReturnValue(false);
    const doc = {
      createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }),
      body: { append() {} },
      execCommand,
    };
    await expect(copyText('hello', doc)).resolves.toBe(false);
    expect(execCommand).toHaveBeenCalledWith('copy');
    vi.unstubAllGlobals();
  });
});
