/**
 * Theme Registry — discovers all themes at build time via Vite glob import.
 *
 * To add a new theme, create a folder under src/themes/<id>/ with:
 *   - theme.json  (metadata: name, group, order, swatch, isDark)
 *   - _vars.scss  (CSS custom property block — source of truth for theme colours)
 */

const themeModules = import.meta.glob('./*/theme.json', { eager: true });

export interface ThemeDefinition {
  id: string;
  name: string;
  group: string;
  order: number;
  isDark: boolean;
  swatch: { bg: string; fg: string; accent: string };
}

const discovered: ThemeDefinition[] = Object.values(themeModules)
  .map((mod: unknown) => ((mod as Record<string, unknown>).default ?? mod) as ThemeDefinition)
  .sort((a, b) => a.order - b.order);

const AUTO_THEME: ThemeDefinition = {
  id: 'auto',
  name: 'Auto',
  group: 'core',
  order: 0,
  isDark: false,
  swatch: { bg: '#ffffff', fg: '#1a1a1a', accent: '#2563eb' },
};

/** All available themes, sorted by order. Includes the "auto" pseudo-theme at index 0. */
export const THEME_LIST: readonly ThemeDefinition[] = [AUTO_THEME, ...discovered];

/** All valid theme IDs. */
export const THEME_IDS: readonly string[] = THEME_LIST.map(t => t.id);

/** Check whether a theme ID is valid (exists in discovered themes). */
export function isValidTheme(id: string): boolean {
  return THEME_IDS.includes(id);
}

/** Look up a theme definition by ID. */
export function getThemeById(id: string): ThemeDefinition | undefined {
  return THEME_LIST.find(t => t.id === id);
}
