/**
 * SmileWeb application controller.
 *
 * Wires together the camera, the smile tracker, the joke library and the UI.
 * Everything is progressive: if the camera or the model is unavailable the app
 * degrades to a fully usable joke browser.
 */
import { APP, BROWSE_PAGE_SIZE, MESSAGES, SEARCH_MAX_LENGTH, STORAGE } from './constants.js';
import { CameraController, cameraSupported } from './camera.js';
import { Celebration } from './celebration.js';
import { tryCreateFaceDetector } from './face-model.js';
import { JokeStore, isFavorite, toggleFavorite } from './jokes.js';
import { SmileTracker, describeSmile } from './smile-engine.js';
import { StatsTracker } from './stats.js';
import { SafeStorage } from './storage.js';
import { ThemeController, themeButtonLabel } from './theme.js';
import {
  $,
  $$,
  announce,
  fillCategorySelect,
  renderJokeCard,
  renderJokeList,
  setDisabled,
  setHidden,
  setText,
  toast,
} from './ui.js';
import { copyText, debounce, formatDuration, formatNumber, pick, searchable } from './util.js';

/** How often to run the model (ms). ~20 fps is plenty for smiles. */
const DETECT_INTERVAL_MS = 50;

class SmileWebApp {
  /** Smiling time (ms) already committed to persistent stats. */
  #loggedSmilingMs = 0;

  constructor(scope = globalThis) {
    this.scope = scope;
    this.doc = scope.document;
    this.storage = new SafeStorage(scope);
    this.store = new JokeStore({ baseUrl: APP.dataDir });
    this.camera = new CameraController({ scope });
    this.tracker = new SmileTracker();
    this.stats = new StatsTracker({ storage: this.storage });
    this.celebration = new Celebration({ document: this.doc, window: scope });

    this.detector = null;
    this.tracking = false;
    this.detectorState = 'idle';
    this.rafId = null;
    this.lastDetectAt = 0;
    this.flushTimer = null;
    this.currentJoke = null;
    this.jokeCounter = 0;
    this.seen = new Set(this.storage.get(STORAGE.SEEN, []));
    this.favorites = this.storage.get(STORAGE.FAVORITES, []);
    if (!Array.isArray(this.favorites)) this.favorites = [];

    this.browseState = {
      query: '',
      categoryId: '',
      favoritesOnly: false,
      offset: 0,
      total: 0,
      items: [],
    };

    this.refs = this.#collectRefs();
  }

  /* ------------------------------------------------------------------ */
  /* Setup                                                              */
  /* ------------------------------------------------------------------ */

  #collectRefs() {
    const d = this.doc;
    return {
      video: $('#camera', d),
      overlay: $('#overlay', d),
      viewport: $('.viewport', d),
      badge: $('#viewport-badge', d),
      badgeLabel: $('[data-bind="badge-label"]', d),
      placeholder: $('[data-placeholder]', d),
      status: $('#status', d),
      meter: $('#smile-meter', d),
      smileValue: $('#smile-value', d),
      smileLabel: $('[data-bind="smile-label"]', d),
      startButtons: $$('[data-action="start"]', d),
      pauseButton: $('#pause-button', d),
      stopButton: $('#stop-button', d),
      fallback: $('#camera-fallback', d),
      card: $('#joke-card', d),
      setup: $('#joke-setup', d),
      punchline: $('#joke-punchline', d),
      category: $('#joke-category', d),
      idLabel: $('#joke-id', d),
      favoriteButton: $('#favorite-button', d),
      revealButton: $('#reveal-button', d),
      shareButton: $('#share-button', d),
      celebrate: $('#celebrate', d),
      filters: $('#filters', d),
      searchInput: $('#search-input', d),
      categorySelect: $('#category-select', d),
      favoritesOnly: $('#favorites-only', d),
      filtersStatus: $('#filters-status', d),
      list: $('#joke-list', d),
      loadMore: $('#load-more', d),
      themeToggle: $('#theme-toggle', d),
      infoDialog: $('#info-dialog', d),
      consentDialog: $('#consent-dialog', d),
      toastNode: $('#toast', d),
      statToday: $('#stat-today', d),
      statStreak: $('#stat-streak', d),
      statTotal: $('#stat-total', d),
      statsToday: $('#stats-today', d),
      statsBestStreak: $('#stats-best-streak', d),
      statsDuration: $('#stats-duration', d),
      statsAllTime: $('#stats-all-time', d),
      statsSeen: $('#stats-seen', d),
      statsFavorites: $('#stats-favorites', d),
    };
  }

  async init() {
    // Dataset manifest -> counts in the UI + the category filter.
    try {
      const manifest = await this.store.loadManifest();
      const total = this.store.total;
      for (const node of $$('[data-bind="total-jokes"]', this.doc)) setText(node, formatNumber(total));
      for (const node of $$('[data-bind="total-categories"]', this.doc)) {
        setText(node, formatNumber(manifest.categories.length));
      }
      fillCategorySelect(this.refs.categorySelect, manifest.categories);
    } catch (error) {
      console.warn('[SmileWeb] joke manifest unavailable:', error);
      toast(this.refs.toastNode, 'The joke library could not be loaded. Check your connection.');
    }

    this.theme = new ThemeController({
      root: this.doc.documentElement,
      storage: this.storage,
      onChange: (theme, resolved) => {
        const button = this.refs.themeToggle;
        if (!button) return;
        button.setAttribute('aria-label', themeButtonLabel(theme, resolved));
        button.setAttribute('aria-pressed', String(theme === 'dark'));
      },
    });
    this.theme.watchSystemPreference(this.scope.matchMedia?.bind(this.scope));

    this.#bindEvents();
    this.#renderStats();
    renderJokeCard(this.refs, null, { empty: true });
    this.#setCameraIdleCopy();

    // Serve a first joke even if the camera is never used.
    this.refs.list?.setAttribute('aria-busy', 'true');

    if (this.doc.visibilityState === 'hidden') this.#stopLoop();
    return this;
  }

  #bindEvents() {
    const d = this.doc;

    d.addEventListener('click', (event) => {
      const actionButton = event.target.closest?.('[data-action]');
      if (actionButton && !actionButton.hasAttribute('disabled')) {
        this.#handleAction(actionButton.dataset.action, actionButton);
      }
    });

    this.refs.searchInput?.addEventListener(
      'input',
      debounce(() => {
        this.browseState.query = this.refs.searchInput.value.slice(0, SEARCH_MAX_LENGTH);
        this.#runSearch({ reset: true });
      }, 180),
    );

    this.refs.filters?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#runSearch({ reset: true });
    });

    this.refs.categorySelect?.addEventListener('change', () => {
      this.browseState.categoryId = this.refs.categorySelect.value;
      this.#runSearch({ reset: true });
    });

    this.refs.favoritesOnly?.addEventListener('change', () => {
      this.browseState.favoritesOnly = this.refs.favoritesOnly.checked;
      this.#runSearch({ reset: true });
    });

    this.refs.list?.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-list-action]');
      if (!button) return;
      const item = button.closest('.joke-list__item');
      const joke = item?.joke;
      if (!joke) return;
      if (button.dataset.listAction === 'copy') this.#copyJoke(joke);
      else this.#toggleFavorite(joke, button);
    });

    d.addEventListener('keydown', (event) => this.#handleKeydown(event));

    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'hidden') {
        this.#flushSmilingTime();
        this.#stopLoop();
        this.celebration.destroy();
      } else if (this.tracking && this.camera.active) {
        this.lastDetectAt = 0;
        this.#startLoop();
      }
    });

    this.scope.addEventListener?.('pagehide', () => {
      this.#flushSmilingTime();
      this.camera.stop(this.refs.video);
      this.detector?.close();
    });
  }

  #handleAction(action, button) {
    switch (action) {
      case 'start':
        this.#requestStart();
        break;
      case 'browse':
        this.doc.getElementById('browse')?.scrollIntoView({ block: 'start' });
        this.#runSearch({ reset: true });
        break;
      case 'close-info':
        this.refs.infoDialog?.close?.();
        break;
      case 'toggle-track':
        this.#setTracking(!this.tracking);
        break;
      case 'stop':
        this.#stopCamera();
        break;
      case 'next-joke':
        this.nextJoke({ reason: 'manual' });
        break;
      case 'theme':
        this.theme?.cycle();
        break;
      case 'reveal':
        setHidden(this.refs.punchline, false);
        setHidden(this.refs.revealButton, true);
        break;
      case 'favorite':
        if (this.currentJoke) this.#toggleFavorite(this.currentJoke, button);
        break;
      case 'copy':
        if (this.currentJoke) this.#copyJoke(this.currentJoke);
        break;
      case 'share':
        this.#shareJoke(this.currentJoke);
        break;
      case 'load-more':
        this.#runSearch({ reset: false });
        break;
      case 'shuffle-browse':
        this.store.resetDeck();
        this.#runSearch({ reset: true, shuffled: true });
        break;
      case 'fake-smile':
        this.#celebrate('Smile detected (imagination edition).');
        break;
      case 'reset-stats':
        this.#resetStats();
        break;
      case 'open-info':
        this.refs.infoDialog?.showModal?.();
        break;
      default:
        break;
    }
  }

  #handleKeydown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const typing =
      target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (event.key === '/' && !typing) {
      event.preventDefault();
      this.refs.searchInput?.focus();
      return;
    }
    if (typing) return;
    if (this.doc.querySelector('dialog[open]') && event.key !== 'Escape') return;

    switch (event.key.toLowerCase()) {
      case ' ':
      case 'spacebar':
        event.preventDefault();
        this.nextJoke({ reason: 'manual' });
        break;
      case 'enter':
        if (!this.refs.punchline?.hasAttribute('hidden')) break;
        setHidden(this.refs.punchline, false);
        setHidden(this.refs.revealButton, true);
        break;
      case 's':
        this.#setTracking(!this.tracking);
        break;
      case 'f':
        if (this.currentJoke) this.#toggleFavorite(this.currentJoke, this.refs.favoriteButton);
        break;
      case 'd':
        this.theme?.cycle();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Camera + detection session                                         */
  /* ------------------------------------------------------------------ */

  async #requestStart() {
    const consent = this.storage.get(STORAGE.CONSENT, false);
    if (!consent && this.refs.consentDialog?.showModal) {
      const dialog = this.refs.consentDialog;
      const answer = await new Promise((resolve) => {
        const onClose = () => {
          dialog.removeEventListener('close', onClose);
          resolve(dialog.returnValue || 'dismiss');
        };
        dialog.addEventListener('close', onClose);
        dialog.showModal();
      });
      if (answer !== 'allow') {
        this.#setStatus('No camera — enjoy the jokes instead.', 'idle');
        if (this.refs.fallback) setHidden(this.refs.fallback, false);
        this.doc.getElementById('browse')?.scrollIntoView({ block: 'start' });
        this.#runSearch({ reset: true });
        return;
      }
      this.storage.set(STORAGE.CONSENT, true);
    }

    await this.startSession();
  }

  async startSession() {
    if (!cameraSupported(this.scope)) {
      this.#showCameraProblem(
        'This browser will not share a camera with the page. The whole library is still yours to browse.',
      );
      return;
    }

    setDisabled(this.refs.startButtons?.[0], true);
    this.#setStatus('Asking for camera access…', 'idle');

    const result = await this.camera.start(this.refs.video);
    if (!result.ok) {
      this.#showCameraProblem(result.message);
      return;
    }

    if (this.refs.viewport) this.refs.viewport.dataset.state = 'live';
    if (this.refs.badge) setHidden(this.refs.badge, false);
    setText(this.refs.badgeLabel, 'Camera on');
    for (const button of this.refs.startButtons) setHidden(button, true);
    setHidden(this.refs.pauseButton, false);
    setHidden(this.refs.stopButton, false);
    setHidden(this.refs.fallback, false);
    this.#setStatus('Warming up the smile detector…', 'idle');

    if (!this.detector) {
      const { detector, error } = await tryCreateFaceDetector({
        onStage: (stage) => {
          if (stage === 'wasm') this.#setStatus('Preparing the detector…', 'idle');
          if (stage === 'model') this.#setStatus('Downloading the face model (one time)…', 'idle');
        },
      });
      if (!detector) {
        console.warn('[SmileWeb] face model unavailable:', error);
        this.#showCameraProblem(
          'The smile detector could not be loaded (it needs a one-time download). You can still browse every joke.',
        );
        return;
      }
      this.detector = detector;
    }

    this.detectorState = 'ready';
    this.tracker.reset();
    this.#setTracking(true);
    this.#setStatus('Look at the camera and smile!', 'idle');
    setText(this.refs.badgeLabel, 'Tracking');
  }

  #setTracking(on) {
    if (on && (!this.camera.active || !this.detector)) {
      // Nothing to track yet — start the whole session instead.
      if (!this.camera.active) this.#requestStart();
      return;
    }
    this.tracking = on;
    if (this.refs.viewport) this.refs.viewport.dataset.state = on ? 'tracking' : 'live';
    setText(this.refs.badgeLabel, on ? 'Tracking' : 'Paused');
    setText(this.refs.pauseButton, on ? 'Pause tracking' : 'Resume tracking');
    if (on) {
      this.#startLoop();
      this.#setStatus('Tracking your smile…', 'idle');
    } else {
      this.#flushSmilingTime();
      this.#stopLoop();
      this.#setStatus('Tracking paused. The jokes are still here.', 'idle');
      this.#resetMeter();
    }
  }

  #stopCamera() {
    this.#flushSmilingTime();
    this.#setTracking(false);
    this.camera.stop(this.refs.video);
    this.tracker.reset();
    if (this.refs.viewport) this.refs.viewport.dataset.state = 'idle';
    if (this.refs.badge) setHidden(this.refs.badge, true);
    for (const button of this.refs.startButtons) setHidden(button, false);
    setDisabled(this.refs.startButtons?.[0], false);
    setHidden(this.refs.pauseButton, true);
    setHidden(this.refs.stopButton, true);
    this.#resetMeter();
    this.#setCameraIdleCopy();
    this.#clearOverlay();
  }

  #showCameraProblem(message) {
    this.#setStatus(message, 'error');
    if (this.refs.viewport) this.refs.viewport.dataset.state = 'error';
    if (this.refs.badge) setHidden(this.refs.badge, true);
    setDisabled(this.refs.startButtons?.[0], false);
    setHidden(this.refs.fallback, false);
    toast(this.refs.toastNode, message, 5200);
    this.#runSearch({ reset: true });
  }

  #setCameraIdleCopy() {
    this.#setStatus('Camera is off. Press “Start smiling” to begin.', 'idle');
    if (this.refs.viewport && this.refs.viewport.dataset.state !== 'error') {
      this.refs.viewport.dataset.state = 'idle';
    }
  }

  #setStatus(text, state = 'idle') {
    const node = this.refs.status;
    if (!node) return;
    setText(node, text);
    node.dataset.state = state;
  }

  #startLoop() {
    if (this.rafId != null) return;
    const raf = this.scope.requestAnimationFrame?.bind(this.scope) ?? ((cb) => setTimeout(cb, 16));
    this.rafId = raf((time) => this.#tick(time));
  }

  #stopLoop() {
    if (this.rafId == null) return;
    this.scope.cancelAnimationFrame?.(this.rafId);
    this.rafId = null;
  }

  #tick(time) {
    this.rafId = null;
    if (!this.tracking || !this.detector || !this.camera.active) return;

    if (time - this.lastDetectAt >= DETECT_INTERVAL_MS) {
      this.lastDetectAt = time;
      const video = this.refs.video;
      if (video && video.videoWidth > 0) {
        let frame;
        try {
          frame = this.detector.detect(video, time);
        } catch (error) {
          console.warn('[SmileWeb] detection error:', error);
          frame = { faceCount: 0, categories: [], landmarks: [], box: null };
        }
        const sample = this.tracker.push({
          categories: frame.categories,
          faceCount: frame.faceCount,
          now: time,
        });
        this.#updateMeter(sample);
        this.#drawOverlay(frame, sample);
        if (sample.event === 'smile:start') this.#onSmile();
        if (sample.event === 'smile:end') this.#flushSmilingTime();
      }
    }
    this.#startLoop();
  }

  #updateMeter(sample) {
    const percent = sample.facePresent ? sample.percent : 0;
    const meter = this.refs.meter;
    if (meter) {
      meter.style.inlineSize = `${percent}%`;
      meter.setAttribute('aria-valuenow', String(percent));
      meter.setAttribute('aria-valuetext', `${percent}% — ${sample.label}`);
    }
    setText(this.refs.smileValue, String(percent));
    setText(this.refs.smileLabel, sample.label);
  }

  #resetMeter() {
    if (this.refs.meter) {
      this.refs.meter.style.inlineSize = '0%';
      this.refs.meter.setAttribute('aria-valuenow', '0');
      this.refs.meter.setAttribute('aria-valuetext', '0%');
    }
    setText(this.refs.smileValue, '0');
    setText(this.refs.smileLabel, describeSmile(0));
    if (this.refs.status) this.refs.status.dataset.state = 'idle';
  }

  #drawOverlay(frame, sample) {
    const canvas = this.refs.overlay;
    const video = this.refs.video;
    if (!canvas || !video) return;
    const width = canvas.clientWidth || video.clientWidth;
    const height = canvas.clientHeight || video.clientHeight;
    if (!width || !height) return;

    const dpr = Math.min(2, this.scope.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!frame?.box || !sample.facePresent) return;

    // The video uses object-fit: cover — reproduce that mapping here.
    const vw = video.videoWidth || width;
    const vh = video.videoHeight || height;
    const scale = Math.max(width / vw, height / vh);
    const drawW = vw * scale;
    const drawH = vh * scale;
    const offsetX = (width - drawW) / 2;
    const offsetY = (height - drawH) / 2;

    const x = offsetX + frame.box.x * drawW;
    const y = offsetY + frame.box.y * drawH;
    const w = frame.box.width * drawW;
    const h = frame.box.height * drawH;

    const smiling = sample.smiling;
    const color = smiling ? '#2f9e6b' : '#f2a516';

    ctx.save();
    ctx.lineWidth = smiling ? 4 : 2.5;
    ctx.strokeStyle = color;
    ctx.globalAlpha = smiling ? 1 : 0.8;
    ctx.shadowColor = color;
    ctx.shadowBlur = smiling ? 22 : 8;

    const radius = Math.min(w, h) * 0.28;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, radius);
    else ctx.rect(x, y, w, h);
    ctx.stroke();
    ctx.restore();

    // A little smile arc at the bottom of the box, proportional to the score.
    const arcWidth = Math.min(w * 0.44, 90);
    const cx = x + w / 2;
    const cy = y + h * 0.78;
    ctx.save();
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, arcWidth / 2, 0.18 * Math.PI, 0.82 * Math.PI, false);
    ctx.stroke();
    ctx.restore();
  }

  #clearOverlay() {
    const canvas = this.refs.overlay;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }

  /* ------------------------------------------------------------------ */
  /* Smile handling                                                     */
  /* ------------------------------------------------------------------ */

  #onSmile() {
    this.stats.recordSmile();
    this.#renderStats();
    if (this.refs.status) {
      setText(this.refs.status, 'You smiled! Here comes a joke.');
      this.refs.status.dataset.state = 'smiling';
    }
    this.#celebrate(pick(MESSAGES) ?? MESSAGES[0]);
    this.nextJoke({ reason: 'smile' });
  }

  #celebrate(message) {
    announce(this.refs.celebrate, message);
    this.celebration.burst(70);
    if (this.refs.toastNode && this.scope.innerWidth < 640) toast(this.refs.toastNode, message);
  }

  #flushSmilingTime() {
    const total = this.tracker.smilingTime();
    const logged = this.#loggedSmilingMs ?? 0;
    const delta = total - logged;
    if (delta > 500) {
      this.stats.addSmilingTime(delta);
      this.#loggedSmilingMs = total;
      this.#renderStats();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Jokes                                                              */
  /* ------------------------------------------------------------------ */

  /** Show the next joke in the feed. */
  async nextJoke({ reason = 'manual' } = {}) {
    try {
      const joke = await this.store.draw();
      this.jokeCounter += 1;
      joke.number = this.jokeCounter;
      this.currentJoke = joke;

      if (!this.seen.has(joke.id)) {
        this.seen.add(joke.id);
        this.stats.recordJokeSeen(1);
        if (this.seen.size > 4000) this.storage.set(STORAGE.SEEN, [...this.seen].slice(-2000));
        else this.storage.set(STORAGE.SEEN, [...this.seen]);
      }

      renderJokeCard(this.refs, joke, {
        fresh: true,
        revealed: true,
        saved: isFavorite(this.favorites, joke),
      });
      this.#renderStats();

      if (reason === 'smile') {
        this.doc.getElementById('joke-stage')?.scrollIntoView({ block: 'nearest' });
      }
    } catch (error) {
      console.error('[SmileWeb] could not load a joke:', error);
      toast(this.refs.toastNode, 'Could not load a joke. Please try again.');
    }
  }

  #toggleFavorite(joke, button) {
    const { favorites, saved } = toggleFavorite(this.favorites, joke);
    this.favorites = favorites;
    this.storage.set(STORAGE.FAVORITES, favorites);
    if (button) {
      button.setAttribute('aria-pressed', String(saved));
      if (button.dataset.listAction === 'favorite') {
        button.textContent = saved ? '♥' : '♡';
        button.setAttribute('aria-label', saved ? 'Remove from saved jokes' : 'Save this joke');
      }
    }
    if (this.currentJoke && joke.id === this.currentJoke.id && this.refs.favoriteButton) {
      this.refs.favoriteButton.setAttribute('aria-pressed', String(saved));
      const label = this.refs.favoriteButton.querySelector('[data-label]') ?? this.refs.favoriteButton;
      label.textContent = saved ? '♥ Saved' : '♡ Save';
    }
    toast(this.refs.toastNode, saved ? 'Saved to your favourites.' : 'Removed from favourites.');
    this.#renderStats();
    if (this.browseState.favoritesOnly) this.#runSearch({ reset: true });
  }

  async #copyJoke(joke) {
    if (!joke) return;
    const ok = await copyText(joke.text, this.doc);
    toast(this.refs.toastNode, ok ? 'Joke copied to the clipboard.' : 'Copy failed — select it manually.');
  }

  async #shareJoke(joke) {
    if (!joke || !this.scope.navigator?.share) return;
    try {
      await this.scope.navigator.share({ title: 'A joke from SmileWeb', text: joke.text });
    } catch {
      /* user cancelled */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Browse + search                                                    */
  /* ------------------------------------------------------------------ */

  async #runSearch({ reset = true, shuffled = false } = {}) {
    const state = this.browseState;
    if (reset) state.offset = 0;
    this.refs.list?.setAttribute('aria-busy', 'true');

    // "Shuffle" hands out a random page of jokes straight from the deck.
    if (shuffled && !state.query && !state.favoritesOnly) {
      try {
        const items = await this.store.drawMany(BROWSE_PAGE_SIZE);
        state.total = items.length;
        state.offset = items.length;
        this.#renderResults(items, { reset: true, total: items.length });
      } catch {
        this.#renderResults([], { reset: true, total: 0 });
      }
      return;
    }

    try {
      const { items, total } = await this.store.search({
        query: state.query,
        categoryId: state.categoryId,
        favoritesOnly: state.favoritesOnly,
        favorites: this.favorites,
        limit: state.favoritesOnly ? 500 : BROWSE_PAGE_SIZE,
        offset: state.offset,
      });
      state.total = total;
      state.offset += items.length;
      this.#renderResults(items, { reset, total });
    } catch (error) {
      console.error('[SmileWeb] search failed:', error);
      toast(this.refs.toastNode, 'The joke library could not be searched right now.');
      this.#renderResults([], { reset: true, total: 0 });
    }
  }

  #renderResults(items, { reset = true, total = 0 } = {}) {
    const tokens = searchable(this.browseState.query).split(' ').filter((token) => token.length > 1);
    renderJokeList(this.refs.list, items, {
      isSaved: (joke) => isFavorite(this.favorites, joke),
      tokens,
      append: !reset,
    });

    const shown = items.length === 0 ? 0 : (this.refs.list?.children.length ?? items.length);
    const poolTotal = this.browseState.total || total || shown;
    setText(
      this.refs.filtersStatus,
      `${formatNumber(shown)} of ${formatNumber(poolTotal)} joke${poolTotal === 1 ? '' : 's'} shown.`,
    );
    setHidden(this.refs.loadMore, shown >= poolTotal);
    this.refs.list?.setAttribute('aria-busy', 'false');
  }

  /* ------------------------------------------------------------------ */
  /* Stats + misc                                                       */
  /* ------------------------------------------------------------------ */

  #renderStats() {
    const stats = this.stats.snapshot();
    setText(this.refs.statToday, formatNumber(stats.today));
    setText(this.refs.statStreak, formatNumber(stats.currentStreak));
    setText(this.refs.statTotal, formatNumber(stats.total));
    setText(this.refs.statsToday, formatNumber(stats.today));
    setText(this.refs.statsBestStreak, formatNumber(stats.bestStreak));
    setText(this.refs.statsDuration, formatDuration(stats.smilingMs + this.tracker.smilingTime()));
    setText(this.refs.statsAllTime, formatNumber(stats.total));
    setText(this.refs.statsSeen, formatNumber(this.seen.size));
    setText(this.refs.statsFavorites, formatNumber(this.favorites.length));
  }

  #resetStats() {
    this.stats.reset();
    this.seen.clear();
    this.storage.remove(STORAGE.SEEN);
    this.#loggedSmilingMs = 0;
    this.#renderStats();
    toast(this.refs.toastNode, 'Stats cleared. Fresh start!');
  }

  /** Register the service worker for offline support (best effort). */
  static registerServiceWorker(scope = globalThis) {
    if (!('serviceWorker' in scope.navigator)) return;
    if (scope.location?.protocol === 'file:') return;
    scope.addEventListener?.('load', () => {
      scope.navigator.serviceWorker.register('sw.js').catch((error) => {
        console.info('[SmileWeb] service worker not registered:', error?.message ?? error);
      });
    });
  }
}

export { SmileWebApp };

/* Bootstrap ----------------------------------------------------------------- */
export function bootstrap(scope = globalThis) {
  const app = new SmileWebApp(scope);
  // Expose for debugging and for the end-to-end tests.
  scope.__smileweb = app;
  return app.init();
}

if (typeof document !== 'undefined' && !globalThis.__SMILEWEB_NO_AUTOSTART__) {
  bootstrap().then((app) => {
    SmileWebApp.registerServiceWorker(globalThis);
    // Give the user something to read straight away.
    app.nextJoke({ reason: 'boot' }).catch(() => {});
  });
}

// Progressive-enhancement flag: styles can opt in once scripting is confirmed.
if (typeof document !== 'undefined') {
  document.documentElement.dataset.js = 'on';
}
