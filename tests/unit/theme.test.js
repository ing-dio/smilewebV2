import { describe, expect, it, vi } from 'vitest';
import { STORAGE } from '../../js/constants.js';
import { THEMES, ThemeController, themeButtonLabel } from '../../js/theme.js';

function makeRoot() {
  return { dataset: {}, style: {} };
}

function makeStorage(initial) {
  let value = initial;
  return {
    get: vi.fn((_key, fallback) => (value === undefined ? fallback : value)),
    set: vi.fn((_key, next) => {
      value = next;
      return true;
    }),
  };
}

describe('ThemeController', () => {
  it('defaults to auto and resolves to light without matchMedia', () => {
    const controller = new ThemeController({ root: makeRoot() });
    expect(controller.theme).toBe('auto');
    expect(controller.resolved).toBe('light');
  });

  it('applies the stored theme to the root element', () => {
    const root = makeRoot();
    const controller = new ThemeController({ root, storage: makeStorage('dark') });
    expect(controller.theme).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('ignores invalid stored values', () => {
    const controller = new ThemeController({ root: makeRoot(), storage: makeStorage('neon') });
    expect(controller.theme).toBe('auto');
  });

  it('resolves auto through matchMedia', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal('matchMedia', matchMedia);
    const controller = new ThemeController({ root: makeRoot() });
    expect(controller.resolved).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('sets a theme, persists it and ignores unknown values', () => {
    const storage = makeStorage('auto');
    const root = makeRoot();
    const controller = new ThemeController({ root, storage });

    expect(controller.set('light')).toBe('light');
    expect(root.dataset.theme).toBe('light');
    expect(storage.get(STORAGE.THEME)).toBe('light');

    expect(controller.set('sparkle')).toBe('light');
    expect(root.dataset.theme).toBe('light');
  });

  it('cycles auto -> light -> dark -> auto', () => {
    const controller = new ThemeController({ root: makeRoot(), storage: makeStorage('auto') });
    expect(controller.cycle()).toBe('light');
    expect(controller.cycle()).toBe('dark');
    expect(controller.cycle()).toBe('auto');
    expect(THEMES).toEqual(['auto', 'light', 'dark']);
  });

  it('notifies on change', () => {
    const onChange = vi.fn();
    const controller = new ThemeController({ root: makeRoot(), onChange });
    controller.set('dark');
    expect(onChange).toHaveBeenLastCalledWith('dark', 'dark');
  });

  it('re-applies auto when the system preference changes', () => {
    let handler = null;
    const query = {
      matches: false,
      addEventListener: (_type, fn) => {
        handler = fn;
      },
      removeEventListener: vi.fn(),
    };
    const onChange = vi.fn();
    const controller = new ThemeController({ root: makeRoot(), onChange });
    const stop = controller.watchSystemPreference(() => query);
    expect(typeof handler).toBe('function');
    onChange.mockClear();
    handler();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(query.removeEventListener).toHaveBeenCalled();
  });
});

describe('themeButtonLabel', () => {
  it('describes the next action for each theme', () => {
    expect(themeButtonLabel('auto', 'dark')).toMatch(/auto \(currently dark\)/);
    expect(themeButtonLabel('light', 'light')).toMatch(/switch to dark/);
    expect(themeButtonLabel('dark', 'dark')).toMatch(/switch to auto/);
  });
});
