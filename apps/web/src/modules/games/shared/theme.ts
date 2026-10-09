/**
 * Room themes.
 *
 * A theme is nothing more than values for the CSS custom properties
 * `src/client/styles/app.css` already reads (`--bg`, `--fg`, `--accent`, ...).
 * Adding a preset — or a host editing one to taste — is choosing a different
 * set of values for the same tokens, never writing new CSS. `ThemeTokens` is
 * the whole of what a theme can say; there is nothing else to plug in.
 *
 * Colours are plain 6-digit hex (`#rrggbb`) so that a plain HTML colour picker
 * (`<input type="color">`) reads and writes them with no conversion, and so a
 * value arriving over the wire is trivial to validate strictly.
 */

/** One value per CSS custom property a theme controls. */
export interface ThemeTokens {
  bg: string;
  bgRaised: string;
  bgSunken: string;
  fg: string;
  fgMuted: string;
  border: string;
  accent: string;
  accentFg: string;
  correct: string;
  wrong: string;
  warn: string;
}

export const THEME_TOKEN_KEYS: readonly (keyof ThemeTokens)[] = [
  'bg',
  'bgRaised',
  'bgSunken',
  'fg',
  'fgMuted',
  'border',
  'accent',
  'accentFg',
  'correct',
  'wrong',
  'warn',
];

/** Host-facing label for each token, for a plain token editor. */
export const THEME_TOKEN_LABELS: Readonly<Record<keyof ThemeTokens, string>> = {
  bg: 'Background',
  bgRaised: 'Raised surface',
  bgSunken: 'Sunken surface',
  fg: 'Text',
  fgMuted: 'Muted text',
  border: 'Border',
  accent: 'Accent',
  accentFg: 'Text on accent',
  correct: 'Correct',
  wrong: 'Wrong',
  warn: 'Warning',
};

export type ThemeId = string;

/**
 * The presets by name, for anywhere that wants one of them specifically and
 * needs the compiler to know it exists — `THEME_PRESETS` is a plain string
 * index, so looking a preset up by a dynamic id is the only reason to use it
 * instead of one of these.
 */
/**
 * Every token below reads at WCAG AA (>= 4.5:1) against both `bg` and
 * `bgRaised` where it is used as text. `accent`, `correct` and `wrong` were
 * the ones that did not, by a small margin, before this pass — nudged
 * darker just far enough to clear it.
 */
export const LIGHT_THEME: ThemeTokens = {
  bg: '#f7f8fb',
  bgRaised: '#ffffff',
  bgSunken: '#eef0f5',
  fg: '#1a1d24',
  fgMuted: '#5b6472',
  border: '#d7dbe3',
  accent: '#2d6be4',
  accentFg: '#ffffff',
  correct: '#1a8255',
  wrong: '#c94141',
  warn: '#9a6300',
};

export const DARK_THEME: ThemeTokens = {
  // The palette this UI shipped with before there was a theme system at all.
  bg: '#12151c',
  bgRaised: '#1b1f2a',
  bgSunken: '#0d1015',
  fg: '#f4f6fa',
  fgMuted: '#a8b0c0',
  border: '#2c323f',
  accent: '#5b9dff',
  accentFg: '#06121f',
  correct: '#3ecf8e',
  wrong: '#ff6b6b',
  warn: '#ffc857',
};

/**
 * Every token below reads at WCAG AA (>= 4.5:1) against both `bg` and
 * `bgRaised` where it is used as text, and `accentFg` against `accent`
 * clears the same floor for a button's own label. `fgMuted`, `accent` and
 * `correct` were the ones that did not, by a small margin, before this pass
 * — nudged darker just far enough to clear it rather than restyled, so the
 * palette still reads as sepia.
 */
export const SEPIA_THEME: ThemeTokens = {
  bg: '#f4ecd8',
  bgRaised: '#fbf3e3',
  bgSunken: '#e9dfc4',
  fg: '#3b2f1f',
  fgMuted: '#78684d',
  border: '#d8c9a3',
  accent: '#9b5c28',
  accentFg: '#fff8ec',
  correct: '#49753b',
  wrong: '#a1382a',
  warn: '#8a5a12',
};

/**
 * Named presets. This is the whole of what "adding a theme later" takes: one
 * more entry here, no new code — `THEME_TOKEN_KEYS` and every consumer already
 * work over the whole set generically.
 */
export const THEME_PRESETS: Readonly<Record<ThemeId, ThemeTokens>> = {
  light: LIGHT_THEME,
  dark: DARK_THEME,
  sepia: SEPIA_THEME,
};

export const THEME_PRESET_LABELS: Readonly<Record<ThemeId, string>> = {
  light: 'Light',
  dark: 'Dark',
  sepia: 'Sepia',
};

export const THEME_PRESET_IDS: readonly ThemeId[] = Object.keys(THEME_PRESETS);

/** Light is the default: a room nobody has configured opens on it. */
export const DEFAULT_THEME_ID: ThemeId = 'light';
export const DEFAULT_THEME: ThemeTokens = LIGHT_THEME;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isThemeColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/**
 * Whether two themes carry the same values, key for key. Used to name a
 * custom theme after the preset it happens to still match, rather than
 * showing "Custom" the instant a room is created.
 */
export function themeEquals(a: ThemeTokens, b: ThemeTokens): boolean {
  return THEME_TOKEN_KEYS.every((key) => a[key] === b[key]);
}

export function presetIdOf(theme: ThemeTokens): ThemeId | null {
  for (const id of THEME_PRESET_IDS) {
    const preset = THEME_PRESETS[id];
    if (preset && themeEquals(theme, preset)) return id;
  }
  return null;
}

/**
 * Builds a full theme from whatever of it arrived over the wire, keyed
 * loosely (an unknown record, not yet known to be a `ThemeTokens`). Every
 * token missing or malformed falls back to the given theme's own value, so a
 * settings patch that names one token changed and carries the rest unchanged
 * — which is how the client always sends it, since `setSettings` replaces a
 * field rather than merging inside it — still produces a complete theme
 * rather than a partly-undefined one.
 */
export function sanitizeTheme(raw: unknown, fallback: ThemeTokens): ThemeTokens {
  const source = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const theme = { ...fallback };
  for (const key of THEME_TOKEN_KEYS) {
    const value = source[key];
    if (isThemeColor(value)) theme[key] = value;
  }
  return theme;
}
