/**
 * Smile detection logic — pure, framework free and fully unit-testable.
 *
 * The face model hands us blendshape scores (0..1) per frame. This module turns
 * that stream into a stable "is the user smiling?" signal using three tricks:
 *
 *   1. Exponential smoothing so single noisy frames never flip the state.
 *   2. Hysteresis (different on/off thresholds) so the state cannot flap.
 *   3. Time-in-state requirements so a twitch is ignored and a real grin is
 *      held for a moment before we celebrate.
 */
import { BLENDSHAPE, SMILE, SMILE_LEVELS } from './constants.js';
import { clamp, lerp } from './util.js';

/**
 * Read one blendshape score out of a MediaPipe categories array.
 * @param {Array<{categoryName?: string, displayName?: string, score?: number}>} categories
 * @param {string} name
 * @returns {number} 0 when missing.
 */
export function readBlendshape(categories, name) {
  if (!Array.isArray(categories)) return 0;
  for (const category of categories) {
    if (category && (category.categoryName === name || category.displayName === name)) {
      const score = Number(category.score);
      return Number.isFinite(score) ? clamp(score, 0, 1) : 0;
    }
  }
  return 0;
}

/**
 * Combine the left/right mouth-smile blendshapes into a single 0..1 score.
 *
 * A genuine smile usually lifts both corners, so we take the *average* of the
 * two and give a small bonus to the weaker side when both are high — this
 * rewards symmetric grins and punishes lopsided noise.
 *
 * @param {Array<object>} categories MediaPipe blendshape categories.
 * @returns {{ smile: number, jawOpen: number }}
 */
export function computeSmileScore(categories) {
  const left = readBlendshape(categories, BLENDSHAPE.SMILE_LEFT);
  const right = readBlendshape(categories, BLENDSHAPE.SMILE_RIGHT);
  const jawOpen = readBlendshape(categories, BLENDSHAPE.JAW_OPEN);

  const mean = (left + right) / 2;
  const symmetry = Math.min(left, right);
  // 80% mean + 20% symmetry bonus, still clamped to 0..1. This rewards grins
  // where both corners lift and penalises lopsided (noisy) detections.
  const smile = clamp(mean * 0.8 + symmetry * 0.2, 0, 1);
  return { smile, jawOpen };
}

/** Map a 0..1 score onto a friendly label for the smile-o-meter. */
export function describeSmile(score) {
  const value = clamp(score, 0, 1);
  const band = SMILE_LEVELS.find((level) => value < level.max);
  return band ? band.label : SMILE_LEVELS[SMILE_LEVELS.length - 1].label;
}

/** Convert a 0..1 score into the 0..100 integer used by the progress bar. */
export function smilePercent(score) {
  return Math.round(clamp(score, 0, 1) * 100);
}

/**
 * Stateful, time-aware smile tracker.
 *
 * Feed it one sample per video frame:
 *
 * ```js
 * const tracker = new SmileTracker();
 * const sample = tracker.push({ categories, faceCount: 1, now: performance.now() });
 * if (sample.event === 'smile:start') celebrate();
 * ```
 */
export class SmileTracker {
  /**
   * @param {object} [options]
   * @param {number} [options.onThreshold] score needed to start a smile.
   * @param {number} [options.offThreshold] score below which a smile ends.
   * @param {number} [options.holdMs] how long the score must stay high.
   * @param {number} [options.releaseMs] how long it must stay low to end.
   * @param {number} [options.smoothing] EMA factor (0..1, higher = snappier).
   * @param {number} [options.cooldownMs] minimum gap between celebrations.
   */
  constructor(options = {}) {
    this.onThreshold = options.onThreshold ?? SMILE.ON_THRESHOLD;
    this.offThreshold = options.offThreshold ?? SMILE.OFF_THRESHOLD;
    this.holdMs = options.holdMs ?? SMILE.HOLD_MS;
    this.releaseMs = options.releaseMs ?? SMILE.RELEASE_MS;
    this.smoothing = options.smoothing ?? SMILE.SMOOTHING;
    this.cooldownMs = options.cooldownMs ?? SMILE.COOLDOWN_MS;
    this.reset();
  }

  /** Return the tracker to its initial, un-smiling state. */
  reset() {
    this.smoothed = 0;
    this.rawScore = 0;
    this.smiling = false;
    this.jawOpen = 0;
    this.facePresent = false;
    this.smilingSince = null;
    this.totalSmilingMs = 0;
    this.lastCelebratedAt = -Infinity;
    this._pendingSince = null;
    this._releaseSince = null;
    return this;
  }

  /**
   * Push a new frame sample.
   *
   * @param {object} sample
   * @param {number} sample.now monotonic timestamp in ms.
   * @param {number} [sample.score] pre-computed 0..1 smile score.
   * @param {Array<object>} [sample.categories] blendshapes (alternative to `score`).
   * @param {number} [sample.jawOpen] optional mouth-open score.
   * @param {number} [sample.faceCount] number of faces seen this frame.
   * @returns {{ smiling: boolean, score: number, percent: number, facePresent: boolean,
   *             label: string, event: 'smile:start'|'smile:end'|'frame'|'cooldown',
   *             durationMs: number }}
   */
  push(sample = {}) {
    const now = Number.isFinite(sample.now) ? sample.now : performance.now();
    const faceCount = Number(sample.faceCount ?? 1);
    const facePresent = faceCount > 0;
    this.facePresent = facePresent;

    let score = sample.score;
    let jawOpen = sample.jawOpen;

    if (Array.isArray(sample.categories)) {
      const computed = computeSmileScore(sample.categories);
      score = computed.smile;
      jawOpen = jawOpen ?? computed.jawOpen;
    }

    score = clamp(Number(score ?? 0), 0, 1);
    this.rawScore = score;
    this.jawOpen = clamp(Number(jawOpen ?? this.jawOpen), 0, 1);

    // No face (or the tracker is paused) -> decay quickly towards zero.
    const target = facePresent ? score : 0;
    this.smoothed = lerp(this.smoothed, target, this.smoothing);

    let event = 'frame';

    if (!this.smiling) {
      if (this.smoothed >= this.onThreshold) {
        this._pendingSince ??= now;
        if (now - this._pendingSince >= this.holdMs) {
          this.smiling = true;
          this.smilingSince = now;
          this._releaseSince = null;
          if (now - this.lastCelebratedAt >= this.cooldownMs) {
            this.lastCelebratedAt = now;
            event = 'smile:start';
          } else {
            event = 'cooldown';
          }
        }
      } else {
        this._pendingSince = null;
      }
    } else {
      if (this.smoothed <= this.offThreshold || !facePresent) {
        this._releaseSince ??= now;
        if (now - this._releaseSince >= this.releaseMs || !facePresent) {
          this.smiling = false;
          if (this.smilingSince != null) this.totalSmilingMs += now - this.smilingSince;
          this.smilingSince = null;
          this._pendingSince = null;
          event = 'smile:end';
        }
      } else {
        this._releaseSince = null;
      }
    }

    const durationMs = this.smiling && this.smilingSince != null ? now - this.smilingSince : 0;

    return {
      smiling: this.smiling,
      score: this.smoothed,
      smoothed: this.smoothed,
      percent: smilePercent(this.smoothed),
      facePresent,
      label: describeSmile(this.smoothed),
      event,
      durationMs,
      jawOpen: this.jawOpen,
    };
  }

  /** How long the user has been smiling in total (including the current smile). */
  smilingTime(now = performance.now()) {
    const live = this.smiling && this.smilingSince != null ? now - this.smilingSince : 0;
    return this.totalSmilingMs + live;
  }
}

/**
 * Compute an axis-aligned bounding box (in normalised 0..1 coordinates) around
 * a set of landmarks. Used to draw the friendly highlight ring over the face.
 */
export function landmarksToBox(landmarks, padding = 0.06) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of landmarks) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (maxX <= minX || maxY <= minY) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  return {
    x: clamp(minX - w * padding, 0, 1),
    y: clamp(minY - h * padding, 0, 1),
    width: clamp(w * (1 + padding * 2), 0, 1),
    height: clamp(h * (1 + padding * 2), 0, 1),
  };
}
