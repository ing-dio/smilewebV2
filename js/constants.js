/**
 * Shared, dependency-free constants for SmileWeb.
 * Everything that tuning might touch lives here so the app and the tests agree.
 */

/** Application level metadata. */
export const APP = Object.freeze({
  name: 'SmileWeb',
  tagline: 'Smile at the camera, get a joke.',
  dataDir: 'data',
  manifestFile: 'manifest.json',
});

/** Blendshape channels we care about, as named by MediaPipe Face Landmarker. */
export const BLENDSHAPE = Object.freeze({
  SMILE_LEFT: 'mouthSmileLeft',
  SMILE_RIGHT: 'mouthSmileRight',
  JAW_OPEN: 'jawOpen',
});

/**
 * Smile detection tuning.
 *
 * `ON` / `OFF` implement hysteresis: a smile must cross `ON` to start and fall
 * below `OFF` to end, which stops the detector flapping around the threshold.
 * `HOLD_MS` / `RELEASE_MS` add a time component so a brief twitch is ignored.
 */
export const SMILE = Object.freeze({
  ON_THRESHOLD: 0.42,
  OFF_THRESHOLD: 0.3,
  HOLD_MS: 320,
  RELEASE_MS: 650,
  SMOOTHING: 0.4,
  /** Minimum face-count confidence before we trust the blendshapes. */
  MIN_FACE_PRESENCE: 0.5,
  /** Smallest gap between two "you smiled!" celebrations. */
  COOLDOWN_MS: 1200,
});

/** Human readable bands for the smile-o-meter. */
export const SMILE_LEVELS = Object.freeze([
  { max: 0.12, label: 'Waiting for a smile' },
  { max: 0.28, label: 'A tiny hint of a smile' },
  { max: 0.42, label: 'Nearly there…' },
  { max: 0.62, label: 'You are smiling!' },
  { max: 1.01, label: 'Beaming — keep it up!' },
]);

/** localStorage keys (namespaced to avoid colliding with other apps). */
export const STORAGE = Object.freeze({
  THEME: 'smileweb:theme',
  FAVORITES: 'smileweb:favorites',
  STATS: 'smileweb:stats',
  SEEN: 'smileweb:seen',
  CONSENT: 'smileweb:consent',
});

/** Number of jokes rendered per "page" in the browse view. */
export const BROWSE_PAGE_SIZE = 24;

/** Longest search query we will bother matching. */
export const SEARCH_MAX_LENGTH = 80;

/** Model + runtime locations. First entry is preferred, the rest are fallbacks. */
export const SOURCES = Object.freeze({
  bundle: [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs',
    'https://unpkg.com/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs',
  ],
  wasm: [
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm',
    'https://unpkg.com/@mediapipe/tasks-vision@1.1.0/wasm',
  ],
  model: [
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  ],
});

/** Webcam constraints — 640×480 is plenty for landmarks and very cheap. */
export const CAMERA_CONSTRAINTS = Object.freeze({
  audio: false,
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24, max: 30 },
    facingMode: 'user',
  },
});

/** Friendly copy shown in the celebration region. */
export const MESSAGES = Object.freeze([
  'Keep smiling and enjoy your day!',
  'That is the smile we were waiting for!',
  'Lovely smile — here comes another one!',
  'Keep smiling and enjoy your day!',
  'Brilliant grin. Have a great one!',
]);
