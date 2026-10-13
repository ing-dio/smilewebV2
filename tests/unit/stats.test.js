import { describe, expect, it } from 'vitest';
import { STORAGE } from '../../js/constants.js';
import { STREAK_WINDOW_MS, StatsTracker, emptyStats, normalizeStats } from '../../js/stats.js';

/** In-memory storage stub exposing just what StatsTracker needs. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get(key, fallback = null) {
      return map.has(key) ? map.get(key) : fallback;
    },
    set(key, value) {
      map.set(key, value);
      return true;
    },
  };
}

describe('emptyStats / normalizeStats', () => {
  it('builds a blank record for a day', () => {
    expect(emptyStats('2026-10-13')).toMatchObject({
      day: '2026-10-13',
      today: 0,
      total: 0,
      bestStreak: 0,
    });
  });

  it('coerces junk and clamps negatives', () => {
    const stats = normalizeStats({ today: -3, total: '12', bestStreak: Number.NaN }, '2026-10-13');
    expect(stats.today).toBe(0);
    expect(stats.total).toBe(12);
    expect(stats.bestStreak).toBe(0);
    expect(stats.day).toBe('2026-10-13');
  });

  it('keeps all-time numbers but resets daily ones on a new day', () => {
    const stats = normalizeStats(
      { day: '2026-10-12', today: 5, total: 99, currentStreak: 4, bestStreak: 9 },
      '2026-10-13',
    );
    expect(stats.total).toBe(99);
    expect(stats.bestStreak).toBe(9);
    expect(stats.today).toBe(0);
    expect(stats.currentStreak).toBe(0);
    expect(stats.day).toBe('2026-10-13');
  });

  it('returns a blank record for garbage input', () => {
    expect(normalizeStats(null, '2026-10-13')).toEqual(emptyStats('2026-10-13'));
    expect(normalizeStats('nope', '2026-10-13')).toEqual(emptyStats('2026-10-13'));
  });
});

describe('StatsTracker', () => {
  function tracker(initial = {}) {
    const storage = memoryStorage(initial);
    let now = new Date(2026, 9, 13, 10, 0, 0);
    const instance = new StatsTracker({ storage, now: () => new Date(now) });
    return {
      storage,
      instance,
      setNow(date) {
        now = date;
      },
    };
  }

  it('counts smiles and tracks streaks within the window', () => {
    const { instance } = tracker();
    const t = 1_000_000;

    expect(instance.recordSmile(t).currentStreak).toBe(1);
    expect(instance.recordSmile(t + STREAK_WINDOW_MS - 1).currentStreak).toBe(2);
    // A long pause starts a brand new streak.
    const afterGap = instance.recordSmile(t + STREAK_WINDOW_MS * 3);
    expect(afterGap.currentStreak).toBe(1);
    expect(afterGap.bestStreak).toBe(2);
    expect(afterGap.today).toBe(3);
    expect(afterGap.total).toBe(3);
  });

  it('persists to storage under the stats key', () => {
    const { instance, storage } = tracker();
    instance.recordSmile(5000);
    expect(storage.get(STORAGE.STATS).total).toBe(1);
  });

  it('adds smiling time but ignores zero/invalid values', () => {
    const { instance } = tracker();
    expect(instance.addSmilingTime(0).smilingMs).toBe(0);
    expect(instance.addSmilingTime(1500.4).smilingMs).toBe(1500);
    expect(instance.addSmilingTime(-10).smilingMs).toBe(1500);
  });

  it('counts jokes seen', () => {
    const { instance } = tracker();
    instance.recordJokeSeen();
    instance.recordJokeSeen(4);
    expect(instance.snapshot().jokesSeen).toBe(5);
  });

  it('rolls the day over on read', () => {
    const { instance, setNow } = tracker();
    instance.recordSmile(1000);
    expect(instance.snapshot().today).toBe(1);
    setNow(new Date(2026, 9, 14, 8, 0, 0));
    const rolled = instance.snapshot();
    expect(rolled.day).toBe('2026-10-14');
    expect(rolled.today).toBe(0);
    expect(rolled.total).toBe(1);
  });

  it('resets everything', () => {
    const { instance } = tracker();
    instance.recordSmile(1000);
    instance.addSmilingTime(2000);
    instance.recordJokeSeen(3);
    const blank = instance.reset();
    expect(blank).toMatchObject({ today: 0, total: 0, smilingMs: 0, jokesSeen: 0 });
  });

  it('restores an existing record from storage', () => {
    const storage = memoryStorage({
      [STORAGE.STATS]: {
        day: '2026-10-13',
        today: 2,
        total: 40,
        bestStreak: 7,
        lastSmileAt: 0,
      },
    });
    const instance = new StatsTracker({ storage, now: () => new Date(2026, 9, 13, 12) });
    expect(instance.snapshot().total).toBe(40);
    expect(instance.snapshot().bestStreak).toBe(7);
  });
});
