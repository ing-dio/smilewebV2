/**
 * A tiny, dependency-free confetti burst.
 *
 * - Uses one full-screen canvas that is created on demand and removed as soon
 *   as the last particle leaves the screen (so it costs nothing when idle).
 * - Honours `prefers-reduced-motion` by simply not animating.
 * - Caps the device pixel ratio at 2 to stay cheap on retina screens.
 */
import { prefersReducedMotion } from './util.js';

const PALETTE = ['#f2a516', '#ff7a59', '#2f9e6b', '#3f8cff', '#e2569b', '#ffd166'];
const SHAPES = ['😄', '🎉', '😁', '✨', '🙂'];

export class Celebration {
  /**
   * @param {object} [options]
   * @param {Document} [options.document]
   * @param {Window} [options.window]
   * @param {() => number} [options.rng]
   */
  constructor({ document: doc = globalThis.document, window: win = globalThis.window, rng = Math.random } = {}) {
    this.document = doc;
    this.window = win;
    this.rng = rng;
    /** @type {HTMLCanvasElement|null} */
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.frame = null;
    this.lastTime = 0;
    this.count = 0;
  }

  get reducedMotion() {
    return prefersReducedMotion(this.window?.matchMedia?.bind(this.window));
  }

  /** Create (once) the overlay canvas. */
  #ensureCanvas() {
    if (this.canvas && this.canvas.isConnected) return;
    const canvas = this.document.createElement('canvas');
    canvas.className = 'celebration-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '50',
    });
    this.document.body.append(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.#resize();
  }

  #resize() {
    if (!this.canvas) return;
    const dpr = Math.min(2, this.window?.devicePixelRatio || 1);
    this.canvas.width = Math.floor((this.window?.innerWidth || 800) * dpr);
    this.canvas.height = Math.floor((this.window?.innerHeight || 600) * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Fire a burst of confetti.
   * @param {number} [amount] particle count.
   */
  burst(amount = 70) {
    if (this.reducedMotion) return false;
    this.#ensureCanvas();
    if (!this.ctx) return false;

    const width = this.window?.innerWidth || 800;
    const height = this.window?.innerHeight || 600;
    const rng = this.rng;

    for (let i = 0; i < amount; i += 1) {
      const fromLeft = rng() > 0.5;
      this.particles.push({
        x: fromLeft ? width * 0.08 : width * 0.92,
        y: height * (0.35 + rng() * 0.3),
        vx: (fromLeft ? 1 : -1) * (2 + rng() * 6),
        vy: -6 - rng() * 8,
        size: 8 + rng() * 14,
        rotation: rng() * Math.PI * 2,
        spin: (rng() - 0.5) * 0.3,
        color: PALETTE[Math.floor(rng() * PALETTE.length)],
        shape: rng() > 0.45 ? 'emoji' : 'rect',
        emoji: SHAPES[Math.floor(rng() * SHAPES.length)],
        life: 1,
        decay: 0.006 + rng() * 0.008,
      });
    }

    if (!this.frame) {
      this.lastTime = 0;
      this.frame = this.window.requestAnimationFrame((t) => this.#tick(t));
    }
    return true;
  }

  #tick(time) {
    const ctx = this.ctx;
    if (!ctx) {
      this.frame = null;
      return;
    }
    const dt = this.lastTime ? Math.min(3, (time - this.lastTime) / 16.67) : 1;
    this.lastTime = time;

    const width = this.window?.innerWidth || 800;
    const height = this.window?.innerHeight || 600;
    ctx.clearRect(0, 0, width, height);

    for (const particle of this.particles) {
      particle.vy += 0.42 * dt; // gravity
      particle.vx *= 0.995;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.rotation += particle.spin * dt;
      particle.life -= particle.decay * dt;
    }

    this.particles = this.particles.filter(
      (particle) => particle.life > 0 && particle.y < height + 60,
    );

    for (const particle of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, particle.life));
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      if (particle.shape === 'emoji') {
        ctx.font = `${particle.size * 1.6}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(particle.emoji, 0, 0);
      } else {
        ctx.fillStyle = particle.color;
        const w = particle.size;
        const h = particle.size * 0.55;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }

    if (this.particles.length > 0) {
      this.frame = this.window.requestAnimationFrame((t) => this.#tick(t));
    } else {
      ctx.clearRect(0, 0, width, height);
      this.frame = null;
      this.#teardown();
    }
  }

  #teardown() {
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }

  /** Stop everything and clean up (used when the page is hidden). */
  destroy() {
    if (this.frame) this.window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.particles = [];
    this.#teardown();
  }
}
