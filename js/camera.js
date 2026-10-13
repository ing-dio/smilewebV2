/**
 * Webcam plumbing: permission handling, stream lifecycle and friendly errors.
 */
import { CAMERA_CONSTRAINTS } from './constants.js';

/** Human readable explanation for a getUserMedia failure. */
export function describeCameraError(error) {
  const name = error?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        code: 'denied',
        message:
          'The camera permission was blocked. Allow it in your browser settings, or just enjoy the jokes without the camera.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        code: 'missing',
        message: 'No camera was found on this device. You can still browse every joke.',
      };
    case 'NotReadableError':
    case 'AbortError':
      return {
        code: 'busy',
        message: 'The camera is already in use by another app. Close it and try again.',
      };
    default:
      return {
        code: 'unknown',
        message:
          error?.message?.length > 0
            ? `The camera could not be started: ${error.message}`
            : 'The camera could not be started.',
      };
  }
}

/** Is a camera API available at all (https/localhost + supported browser)? */
export function cameraSupported(scope = globalThis) {
  return Boolean(scope?.navigator?.mediaDevices?.getUserMedia);
}

export class CameraController {
  /**
   * @param {object} [options]
   * @param {MediaStreamConstraints} [options.constraints]
   * @param {object} [options.scope] injectable global (tests).
   */
  constructor({ constraints = CAMERA_CONSTRAINTS, scope = globalThis } = {}) {
    this.constraints = constraints;
    this.scope = scope;
    /** @type {MediaStream|null} */
    this.stream = null;
  }

  get active() {
    return Boolean(this.stream?.getTracks().some((track) => track.readyState === 'live'));
  }

  /**
   * Request the camera and attach it to a video element.
   * @param {HTMLVideoElement} video
   * @returns {Promise<{ ok: true, stream: MediaStream } | { ok: false, error: Error, code: string, message: string }>}
   */
  async start(video) {
    if (!cameraSupported(this.scope)) {
      return {
        ok: false,
        error: new Error('getUserMedia is unavailable'),
        code: 'unsupported',
        message:
          'This browser will not share a camera with the page (it needs a secure https connection). The jokes are all still here.',
      };
    }

    try {
      this.stop();
      const stream = await this.scope.navigator.mediaDevices.getUserMedia(this.constraints);
      this.stream = stream;
      if (video) {
        video.srcObject = stream;
        // iOS/Safari needs an explicit play() after metadata is ready.
        try {
          await video.play();
        } catch {
          /* autoplay policies: the video will start on the first user gesture */
        }
        await waitForVideo(video);
      }
      return { ok: true, stream };
    } catch (error) {
      const { code, message } = describeCameraError(error);
      return { ok: false, error, code, message };
    }
  }

  /** Stop every track and detach the element. */
  stop(video) {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
    this.stream = null;
    if (video) {
      try {
        video.srcObject = null;
      } catch {
        /* ignore */
      }
    }
  }
}

/** Resolve once the video element has real dimensions, or after a timeout. */
export function waitForVideo(video, timeoutMs = 4000) {
  if (video?.videoWidth > 0 && video?.readyState >= 2) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      video?.removeEventListener?.('loadeddata', onReady);
      video?.removeEventListener?.('playing', onReady);
      resolve(value);
    };
    const onReady = () => finish(video.videoWidth > 0);
    video?.addEventListener?.('loadeddata', onReady, { once: true });
    video?.addEventListener?.('playing', onReady, { once: true });
    setTimeout(() => finish((video?.videoWidth ?? 0) > 0), timeoutMs);
  });
}
