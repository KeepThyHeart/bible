import { describe, expect, it } from 'vitest';
import {
  DARK_THEME,
  DEFAULT_THEME,
  DEFAULT_THEME_ID,
  SEPIA_THEME,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  THEME_TOKEN_KEYS,
  isThemeColor,
  presetIdOf,
  sanitizeTheme,
  themeEquals,
} from './theme.js';

describe('presets', () => {
  it('defaults to light', () => {
    expect(DEFAULT_THEME_ID).toBe('light');
    expect(DEFAULT_THEME).toEqual(THEME_PRESETS.light);
  });

  it('gives every preset a value for every token', () => {
    for (const id of THEME_PRESET_IDS) {
      const preset = THEME_PRESETS[id];
      expect(preset).toBeDefined();
      for (const key of THEME_TOKEN_KEYS) {
        expect(isThemeColor(preset?.[key])).toBe(true);
      }
    }
  });

  it('identifies a theme equal to a preset, and null for one that matches none', () => {
    expect(presetIdOf(DARK_THEME)).toBe('dark');
    expect(presetIdOf({ ...DARK_THEME, accent: '#123456' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

/** Relative luminance per the WCAG formula, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (raw: number): number => {
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (no contrast) to 21 (black on white). */
function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for normal-weight text. Every text-role token is held to this. */
const AA_TEXT = 4.5;

describe('preset contrast', () => {
  it('holds every text-role token at WCAG AA against both backgrounds it appears on', () => {
    const textRoles: (keyof (typeof THEME_PRESETS)['light'])[] = [
      'fg',
      'fgMuted',
      'accent',
      'correct',
      'wrong',
      'warn',
    ];
    for (const id of THEME_PRESET_IDS) {
      const preset = THEME_PRESETS[id];
      if (!preset) continue;
      for (const role of textRoles) {
        for (const bg of [preset.bg, preset.bgRaised] as const) {
          const ratio = contrastRatio(preset[role], bg);
          expect(ratio, `${id}.${role} vs background ${bg}`).toBeGreaterThanOrEqual(AA_TEXT);
        }
      }
      // A button's own label against its own fill.
      expect(contrastRatio(preset.accentFg, preset.accent)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe('isThemeColor', () => {
  it('accepts a 6-digit hex colour and nothing else', () => {
    expect(isThemeColor('#aabbcc')).toBe(true);
    expect(isThemeColor('#ABCDEF')).toBe(true);
    expect(isThemeColor('#abc')).toBe(false);
    expect(isThemeColor('aabbcc')).toBe(false);
    expect(isThemeColor('rgb(1,2,3)')).toBe(false);
    expect(isThemeColor(123)).toBe(false);
    expect(isThemeColor(null)).toBe(false);
    expect(isThemeColor(undefined)).toBe(false);
  });
});

describe('themeEquals', () => {
  it('is true only when every token matches', () => {
    expect(themeEquals(DEFAULT_THEME, { ...DEFAULT_THEME })).toBe(true);
    expect(themeEquals(DEFAULT_THEME, { ...DEFAULT_THEME, accent: '#000000' })).toBe(false);
  });
});

describe('sanitizeTheme', () => {
  it('keeps every valid token from the raw value', () => {
    const raw = { ...SEPIA_THEME };
    expect(sanitizeTheme(raw, DEFAULT_THEME)).toEqual(SEPIA_THEME);
  });

  it('falls back to the given theme for a missing or malformed token', () => {
    const result = sanitizeTheme({ accent: '#ff00ff', bg: 'not-a-colour' }, DARK_THEME);
    expect(result.accent).toBe('#ff00ff');
    expect(result.bg).toBe(DARK_THEME.bg);
    expect(result.fg).toBe(DARK_THEME.fg);
  });

  it('falls back entirely for something that is not an object', () => {
    expect(sanitizeTheme(null, DEFAULT_THEME)).toEqual(DEFAULT_THEME);
    expect(sanitizeTheme('not an object', DEFAULT_THEME)).toEqual(DEFAULT_THEME);
    expect(sanitizeTheme(42, DEFAULT_THEME)).toEqual(DEFAULT_THEME);
  });

  it('ignores an unknown key rather than adopting it', () => {
    const result = sanitizeTheme({ mischief: '#ff00ff' }, DEFAULT_THEME);
    expect(result).toEqual(DEFAULT_THEME);
  });
});
