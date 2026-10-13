/**
 * Smile statistics. Everything is stored locally and never leaves the device.
 */
import { STORAGE } from './constants.js';
import { localDayKey } from './util.js';

/** Two smiles count as part of the same streak if they are this close. */
export const STREAK_WINDOW_MS = 45_000;

/** @returns a blank statistics record for the given day. */
export function emptyStats(day = localDayKey()) {
  return {
    day,
    today: 0,
    total: 0,
    currentStreak: 0,
    bestStreak: 0,
    smilingMs: 0,
    jokesSeen: 0,
    lastSmileAt: 0,
  };
}

/** Coerce whatever was in storage into a valid stats record. */
export function normalizeStats(raw, day = localDayKey()) {
  const base = emptyStats(day);
  if (!raw || typeof raw !== 'object') return base;
  const number = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0);
  const stats = {
    day: typeof raw.day === 'string' ? raw.day : day,
    today: number(raw.today),
    total: number(raw.total),
    currentStreak: number(raw.currentStreak),
    bestStreak: number(raw.bestStreak),
    smilingMs: number(raw.smilingMs),
    jokesSeen: number(raw.jokesSeen),
    lastSmileAt: number(raw.lastSmileAt),
  };
  if (stats.day !== day) {
    // New day: keep the all-time numbers, reset the daily ones.
    stats.day = day;
    stats.today = 0;
    stats.currentStreak = 0;
  }
  return stats;
}

export class StatsTracker {
  /**
   * @param {object} [options]
   * @param {import('./storage.js').SafeStorage} options.storage
   * @param {() => Date} [options.now] injectable clock.
   */
  constructor({ storage, now = () => new Date() } = {}) {
    this.storage = storage;
    this.now = now;
    this.state = normalizeStats(storage?.get(STORAGE.STATS, null), localDayKey(now()));
  }

  /** Persist the current state. */
  #save() {
    this.storage?.set(STORAGE.STATS, this.state);
  }

  /** Roll stats over when the wall clock crosses midnight. */
  #rollover() {
    const day = localDayKey(this.now());
    if (this.state.day !== day) {
      this.state = normalizeStats(this.state, day);
    }
  }

  /**
   * Record a detected smile.
   * @param {number} [at] epoch ms (defaults to now).
   * @returns {ReturnType<StatsTracker['snapshot']>}
   */
  recordSmile(at = this.now().getTime()) {
    this.#rollover();
    this.state.today += 1;
    this.state.total += 1;
    const gap = at - this.state.lastSmileAt;
    this.state.currentStreak =
      this.state.lastSmileAt > 0 && gap <= STREAK_WINDOW_MS ? this.state.currentStreak + 1 : 1;
    this.state.bestStreak = Math.max(this.state.bestStreak, this.state.currentStreak);
    this.state.lastSmileAt = at;
    this.#save();
    return this.snapshot();
  }

  /** Add measured smiling time (ms). */
  addSmilingTime(ms) {
    const value = Math.max(0, Math.round(Number(ms) || 0));
    if (value === 0) return this.snapshot();
    this.#rollover();
    this.state.smilingMs += value;
    this.#save();
    return this.snapshot();
  }

  /** Count a joke as seen (each joke only counts once). */
  recordJokeSeen(count = 1) {
    this.#rollover();
    this.state.jokesSeen += Math.max(0, Math.floor(count));
    this.#save();
    return this.snapshot();
  }

  /** Wipe every statistic. */
  reset() {
    this.state = emptyStats(localDayKey(this.now()));
    this.#save();
    return this.snapshot();
  }

  /** Immutable view of the current numbers. */
  snapshot() {
    this.#rollover();
    return { ...this.state };
  }
}
