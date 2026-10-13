/**
 * Theme handling: auto (follow the OS), light, or dark.
 * The choice is stored locally and applied to <html data-theme>.
 */
import { STORAGE } from './constants.js';

export const THEMES = ['auto', 'light', 'dark'];

export class ThemeController {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root the <html> element.
   * @param {import('./storage.js').SafeStorage} [options.storage]
   * @param {(theme: string) => void} [options.onChange]
   */
  constructor({ root, storage, onChange = () => {} }) {
    this.root = root;
    this.storage = storage;
    this.onChange = onChange;
    const stored = storage?.get(STORAGE.THEME, 'auto');
    this.theme = THEMES.includes(stored) ? stored : 'auto';
    this.apply();
  }

  /** The theme actually being rendered right now ("light" or "dark"). */
  get resolved() {
    if (this.theme !== 'auto') return this.theme;
    try {
      return globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  /** Push the current theme to the document. */
  apply() {
    if (!this.root) return;
    this.root.dataset.theme = this.theme;
    this.root.style.colorScheme = this.theme === 'auto' ? '' : this.theme;
    this.onChange(this.theme, this.resolved);
  }

  /** Set a specific theme. */
  set(theme) {
    if (!THEMES.includes(theme) || theme === this.theme) return this.theme;
    this.theme = theme;
    this.storage?.set(STORAGE.THEME, theme);
    this.apply();
    return this.theme;
  }

  /** Cycle auto -> light -> dark -> auto. */
  cycle() {
    const index = THEMES.indexOf(this.theme);
    return this.set(THEMES[(index + 1) % THEMES.length]);
  }

  /** Re-resolve "auto" when the OS preference changes. */
  watchSystemPreference(matchMedia = globalThis.matchMedia) {
    if (typeof matchMedia !== 'function') return () => {};
    try {
      const query = matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        if (this.theme === 'auto') this.apply();
      };
      query.addEventListener?.('change', handler);
      return () => query.removeEventListener?.('change', handler);
    } catch {
      return () => {};
    }
  }
}

/** Small label used by the header button. */
export function themeButtonLabel(theme, resolved) {
  if (theme === 'auto') return `Theme: auto (currently ${resolved}). Click to switch to light.`;
  if (theme === 'light') return 'Theme: light. Click to switch to dark.';
  return 'Theme: dark. Click to switch to auto.';
}
