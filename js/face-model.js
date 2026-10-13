/**
 * Face landmark wrapper.
 *
 * We deliberately keep MediaPipe behind this thin interface so the rest of the
 * app never talks to the model directly: that makes the smile pipeline easy to
 * fake in tests and easy to swap out later.
 *
 * The module is imported lazily (only when the user asks for the camera) so the
 * initial page load stays tiny.
 */
import { SOURCES } from './constants.js';
import { landmarksToBox } from './smile-engine.js';

/** Raised when the model could not be prepared for any reason. */
export class FaceModelError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'FaceModelError';
    this.cause = cause;
  }
}

/** Try each source in order, returning the first one that imports. */
async function importFirst(urls) {
  let lastError;
  for (const url of urls) {
    try {
      return await import(/* webpackIgnore: true */ /* @vite-ignore */ url);
    } catch (error) {
      lastError = error;
    }
  }
  throw new FaceModelError('Could not load the face-detection runtime', lastError);
}

/**
 * Thin adapter over MediaPipe's FaceLandmarker.
 *
 * @example
 * const detector = await MediaPipeFaceDetector.create();
 * const frame = detector.detect(videoElement, performance.now());
 * frame.smile.score // 0..1
 */
export class MediaPipeFaceDetector {
  /** @param {object} options */
  constructor({ landmarker, close }) {
    this._landmarker = landmarker;
    this._dispose = close;
    /** @type {number} last timestamp handed to the model (must be monotonic). */
    this._lastTimestamp = -1;
    this.ready = true;
  }

  /**
   * Create and warm up a detector.
   * @param {object} [options]
   * @param {string[]} [options.bundles] override the runtime sources.
   * @param {string[]} [options.wasmPaths] override the wasm fileset sources.
   * @param {string[]} [options.models] override the model sources.
   * @param {(stage: string) => void} [options.onStage] progress reporter.
   * @returns {Promise<MediaPipeFaceDetector>}
   */
  static async create(options = {}) {
    const {
      bundles = SOURCES.bundle,
      wasmPaths = SOURCES.wasm,
      models = SOURCES.model,
      onStage = () => {},
    } = options;

    onStage('runtime');
    const vision = await importFirst(bundles);

    if (!vision?.FilesetResolver || !vision?.FaceLandmarker) {
      throw new FaceModelError('The face-detection runtime is missing its exports');
    }

    onStage('wasm');
    let fileset;
    let wasmError;
    for (const path of wasmPaths) {
      try {
        fileset = await vision.FilesetResolver.forVisionTasks(path);
        break;
      } catch (error) {
        wasmError = error;
      }
    }
    if (!fileset) {
      throw new FaceModelError('Could not prepare the WebAssembly runtime', wasmError);
    }

    onStage('model');
    const baseOptions = { modelAssetPath: models[0], delegate: 'GPU' };
    /** @type {any} */
    let landmarker;
    try {
      landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions,
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
        minFaceDetectionConfidence: 0.4,
        minFacePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
    } catch (gpuError) {
      // Some machines/drivers cannot use the GPU delegate — retry on CPU.
      try {
        landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: models[0], delegate: 'CPU' },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.4,
          minFacePresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
        });
      } catch (cpuError) {
        throw new FaceModelError('Could not start the face-landmark model', cpuError ?? gpuError);
      }
    }

    onStage('ready');
    return new MediaPipeFaceDetector({
      landmarker,
      close: () => {
        try {
          landmarker.close();
        } catch {
          /* already closed */
        }
      },
    });
  }

  /**
   * Analyse a single video frame.
   *
   * @param {HTMLVideoElement|HTMLCanvasElement} source
   * @param {number} timestampMs monotonic clock value.
   * @returns {{ faceCount: number, landmarks: Array<object>, categories: Array<object>, box: object|null }}
   */
  detect(source, timestampMs) {
    const timestamp = Math.max(this._lastTimestamp + 1, Math.floor(timestampMs || 0));
    this._lastTimestamp = timestamp;

    /** @type {any} */
    let result;
    try {
      result = this._landmarker.detectForVideo(source, timestamp);
    } catch {
      // A frame that is not ready yet (zero size / decoder stall) is not fatal.
      return { faceCount: 0, landmarks: [], categories: [], box: null };
    }

    const landmarks = result?.faceLandmarks?.[0] ?? [];
    const categories = result?.faceBlendshapes?.[0]?.categories ?? [];
    const faceCount = Array.isArray(result?.faceLandmarks) ? result.faceLandmarks.length : 0;

    return {
      faceCount: landmarks.length > 0 ? Math.max(1, faceCount) : 0,
      landmarks,
      categories,
      box: landmarksToBox(landmarks),
    };
  }

  /** Release the underlying WASM model. */
  close() {
    if (!this.ready) return;
    this.ready = false;
    this._dispose?.();
  }
}

/**
 * Build a detector, falling back to `null` when the model cannot be created.
 * Never throws — the caller decides what to tell the user.
 *
 * @param {object} [options]
 * @returns {Promise<{ detector: MediaPipeFaceDetector|null, error: Error|null }>}
 */
export async function tryCreateFaceDetector(options = {}) {
  // Test seam: end-to-end tests install a deterministic detector factory so the
  // full camera → tracker → UI loop can be exercised without a real face (and
  // without a 4 MB model download). Never set in production.
  const factory = globalThis.__smilewebTestDetectorFactory;
  if (typeof factory === 'function') {
    try {
      return { detector: await factory(options), error: null };
    } catch (error) {
      return { detector: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  try {
    const detector = await MediaPipeFaceDetector.create(options);
    return { detector, error: null };
  } catch (error) {
    return { detector: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
