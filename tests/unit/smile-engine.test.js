import { describe, expect, it } from 'vitest';
import {
  SmileTracker,
  computeSmileScore,
  describeSmile,
  landmarksToBox,
  readBlendshape,
  smilePercent,
} from '../../js/smile-engine.js';

/** Build a MediaPipe-shaped blendshape array. */
function blendshapes(smile, jawOpen = 0) {
  return [
    { categoryName: 'mouthSmileLeft', score: smile },
    { categoryName: 'mouthSmileRight', score: smile },
    { categoryName: 'jawOpen', score: jawOpen },
    { categoryName: 'browInnerUp', score: 0.1 },
  ];
}

describe('readBlendshape', () => {
  it('finds a category by name', () => {
    expect(readBlendshape(blendshapes(0.7), 'mouthSmileLeft')).toBeCloseTo(0.7);
  });

  it('accepts displayName too', () => {
    expect(readBlendshape([{ displayName: 'mouthSmileLeft', score: 0.4 }], 'mouthSmileLeft')).toBe(0.4);
  });

  it('returns 0 for missing or malformed input', () => {
    expect(readBlendshape(null, 'mouthSmileLeft')).toBe(0);
    expect(readBlendshape([], 'mouthSmileLeft')).toBe(0);
    expect(readBlendshape([{ categoryName: 'other', score: 1 }], 'mouthSmileLeft')).toBe(0);
    expect(readBlendshape([{ categoryName: 'mouthSmileLeft', score: 'x' }], 'mouthSmileLeft')).toBe(0);
  });

  it('clamps out-of-range scores', () => {
    expect(readBlendshape([{ categoryName: 'mouthSmileLeft', score: 9 }], 'mouthSmileLeft')).toBe(1);
    expect(readBlendshape([{ categoryName: 'mouthSmileLeft', score: -3 }], 'mouthSmileLeft')).toBe(0);
  });
});

describe('computeSmileScore', () => {
  it('averages both corners', () => {
    const { smile } = computeSmileScore(blendshapes(0.8));
    expect(smile).toBeCloseTo(0.8, 5);
  });

  it('penalises very lopsided input', () => {
    const symmetric = computeSmileScore([
      { categoryName: 'mouthSmileLeft', score: 0.8 },
      { categoryName: 'mouthSmileRight', score: 0.8 },
    ]).smile;
    const lopsided = computeSmileScore([
      { categoryName: 'mouthSmileLeft', score: 0.9 },
      { categoryName: 'mouthSmileRight', score: 0.0 },
    ]).smile;
    expect(lopsided).toBeLessThan(symmetric);
    expect(lopsided).toBeCloseTo(0.36, 2);
  });

  it('is 0 when nothing is detected and exposes jawOpen', () => {
    const result = computeSmileScore([{ categoryName: 'jawOpen', score: 0.5 }]);
    expect(result.smile).toBe(0);
    expect(result.jawOpen).toBe(0.5);
  });

  it('never exceeds 1', () => {
    expect(computeSmileScore(blendshapes(1, 1)).smile).toBeLessThanOrEqual(1);
  });
});

describe('describeSmile / smilePercent', () => {
  it('describes bands', () => {
    expect(describeSmile(0)).toMatch(/waiting/i);
    expect(describeSmile(0.9)).toMatch(/beaming/i);
  });

  it('converts to percent', () => {
    expect(smilePercent(0.5)).toBe(50);
    expect(smilePercent(2)).toBe(100);
    expect(smilePercent(-1)).toBe(0);
  });
});

describe('SmileTracker', () => {
  const fast = { holdMs: 100, releaseMs: 200, smoothing: 1, cooldownMs: 0 };

  it('needs the smile to be held before firing', () => {
    const tracker = new SmileTracker(fast);
    expect(tracker.push({ score: 0.9, now: 0 }).event).toBe('frame');
    expect(tracker.push({ score: 0.9, now: 50 }).event).toBe('frame');
    const fired = tracker.push({ score: 0.9, now: 120 });
    expect(fired.event).toBe('smile:start');
    expect(fired.smiling).toBe(true);
  });

  it('ignores a quick twitch', () => {
    const tracker = new SmileTracker(fast);
    tracker.push({ score: 0.9, now: 0 });
    tracker.push({ score: 0.0, now: 40 });
    const later = tracker.push({ score: 0.0, now: 500 });
    expect(later.smiling).toBe(false);
    expect(later.event).toBe('frame');
  });

  it('keeps smiling through a small dip (hysteresis)', () => {
    const tracker = new SmileTracker({ ...fast, smoothing: 0.5 });
    // Drive it well above the threshold first.
    for (let t = 0; t <= 300; t += 50) tracker.push({ score: 1, now: t });
    expect(tracker.smiling).toBe(true);
    // A single dip between OFF and ON must not end the smile.
    const dip = tracker.push({ score: 0.36, now: 350 });
    expect(dip.smiling).toBe(true);
  });

  it('ends the smile after a sustained drop, then fires smile:end', () => {
    const tracker = new SmileTracker({ ...fast, smoothing: 1 });
    tracker.push({ score: 1, now: 0 });
    tracker.push({ score: 1, now: 150 });
    expect(tracker.smiling).toBe(true);
    tracker.push({ score: 0, now: 200 });
    const ended = tracker.push({ score: 0, now: 450 });
    expect(ended.smiling).toBe(false);
    expect(ended.event).toBe('smile:end');
  });

  it('treats a missing face as not-smiling and decays the score', () => {
    const tracker = new SmileTracker({ ...fast, smoothing: 0.5 });
    tracker.push({ score: 1, faceCount: 1, now: 0 });
    const away = tracker.push({ score: 0, faceCount: 0, now: 100 });
    expect(away.facePresent).toBe(false);
    expect(away.smoothed).toBeLessThan(1);
    expect(away.percent).toBeLessThan(100);
  });

  it('respects the cooldown between celebrations', () => {
    const tracker = new SmileTracker({ holdMs: 50, releaseMs: 100, smoothing: 1, cooldownMs: 5000 });
    tracker.push({ score: 1, now: 0 });
    expect(tracker.push({ score: 1, now: 100 }).event).toBe('smile:start');
    tracker.push({ score: 0, now: 200 });
    expect(tracker.push({ score: 0, now: 400 }).event).toBe('smile:end');
    tracker.push({ score: 1, now: 500 });
    expect(tracker.push({ score: 1, now: 700 }).event).toBe('cooldown');
  });

  it('accumulates smiling time', () => {
    const tracker = new SmileTracker({ ...fast, smoothing: 1 });
    tracker.push({ score: 1, now: 0 });
    tracker.push({ score: 1, now: 200 });
    expect(tracker.smiling).toBe(true);
    expect(tracker.smilingTime(1200)).toBeGreaterThanOrEqual(1000);
    tracker.push({ score: 0, now: 1300 });
    tracker.push({ score: 0, now: 1600 });
    expect(tracker.smiling).toBe(false);
    expect(tracker.smilingTime(9999)).toBeGreaterThan(1000);
  });

  it('accepts raw blendshape categories', () => {
    const tracker = new SmileTracker({ ...fast, smoothing: 1 });
    tracker.push({ categories: blendshapes(1), now: 0 });
    const fired = tracker.push({ categories: blendshapes(1), now: 200 });
    expect(fired.event).toBe('smile:start');
    expect(fired.score).toBeGreaterThan(0.9);
  });

  it('reset() returns to a clean slate', () => {
    const tracker = new SmileTracker(fast);
    tracker.push({ score: 1, now: 0 });
    tracker.push({ score: 1, now: 200 });
    tracker.reset();
    expect(tracker.smiling).toBe(false);
    expect(tracker.smoothed).toBe(0);
    expect(tracker.totalSmilingMs).toBe(0);
  });

  it('uses a monotonic timestamp when none is supplied', () => {
    const tracker = new SmileTracker(fast);
    expect(() => tracker.push({ score: 0.5 })).not.toThrow();
  });
});

describe('landmarksToBox', () => {
  it('computes a padded normalised box', () => {
    const box = landmarksToBox(
      [
        { x: 0.2, y: 0.2 },
        { x: 0.6, y: 0.7 },
      ],
      0,
    );
    expect(box.x).toBeCloseTo(0.2, 6);
    expect(box.y).toBeCloseTo(0.2, 6);
    expect(box.width).toBeCloseTo(0.4, 6);
    expect(box.height).toBeCloseTo(0.5, 6);
  });

  it('clamps to the frame when padded', () => {
    const box = landmarksToBox(
      [
        { x: 0.0, y: 0.0 },
        { x: 1.0, y: 1.0 },
      ],
      0.2,
    );
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(1);
    expect(box.height).toBe(1);
  });

  it('returns null for degenerate input', () => {
    expect(landmarksToBox([])).toBeNull();
    expect(landmarksToBox(null)).toBeNull();
    expect(landmarksToBox([{ x: 0.5, y: 0.5 }])).toBeNull();
    expect(landmarksToBox([{ x: 'a', y: 'b' }])).toBeNull();
  });
});
