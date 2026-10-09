// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DARK_THEME, DEFAULT_THEME, LIGHT_THEME, SEPIA_THEME } from '../../shared/theme.js';
import {
  applyTheme,
  clearThemeOverride,
  loadThemeOverride,
  saveThemeOverride,
} from './theme.js';

let restore: (() => void) | null = null;

/** A window that refuses storage, the way a private tab or a locked-down webview does. */
function refuseStorage(): void {
  const own = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('storage is disabled in this context');
    },
  });
  restore = () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    if (own) Object.defineProperty(globalThis, 'localStorage', own);
  };
}

describe('applyTheme', () => {
  it('writes every token onto the element as a CSS custom property', () => {
    const el = document.createElement('div');
    applyTheme(DARK_THEME, el);
    expect(el.style.getPropertyValue('--bg')).toBe(DARK_THEME.bg);
    expect(el.style.getPropertyValue('--accent')).toBe(DARK_THEME.accent);
    expect(el.style.getPropertyValue('--warn')).toBe(DARK_THEME.warn);
  });

  it('picks the native widget scheme from how light the background is', () => {
    const light = document.createElement('div');
    applyTheme(LIGHT_THEME, light);
    expect(light.style.colorScheme).toBe('light');

    const dark = document.createElement('div');
    applyTheme(DARK_THEME, dark);
    expect(dark.style.colorScheme).toBe('dark');
  });
});

describe('theme override', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('has no override until one is saved', () => {
    expect(loadThemeOverride()).toBeNull();
  });

  it('gives back exactly the theme that was saved', () => {
    saveThemeOverride(SEPIA_THEME);
    expect(loadThemeOverride()).toEqual(SEPIA_THEME);
  });

  it('clears the override', () => {
    saveThemeOverride(SEPIA_THEME);
    clearThemeOverride();
    expect(loadThemeOverride()).toBeNull();
  });

  it('ignores a stored value missing a token, rather than handing back a half theme', () => {
    const incomplete: Record<string, string> = { ...DARK_THEME };
    delete incomplete.accent;
    localStorage.setItem('bible-games:theme-override', JSON.stringify(incomplete));
    expect(loadThemeOverride()).toBeNull();
  });

  it('ignores a stored value with an invalid colour', () => {
    localStorage.setItem(
      'bible-games:theme-override',
      JSON.stringify({ ...DARK_THEME, bg: 'not-a-colour' })
    );
    expect(loadThemeOverride()).toBeNull();
  });

  it('ignores a value some other tab left half written', () => {
    localStorage.setItem('bible-games:theme-override', '{"bg": "#123456"');
    expect(loadThemeOverride()).toBeNull();
  });

  it('plays on when the browser refuses storage altogether', () => {
    refuseStorage();
    expect(() => saveThemeOverride(DEFAULT_THEME)).not.toThrow();
    expect(loadThemeOverride()).toBeNull();
    expect(() => clearThemeOverride()).not.toThrow();
  });
});
