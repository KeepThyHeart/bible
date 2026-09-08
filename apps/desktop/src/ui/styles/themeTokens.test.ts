import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { THEME_TOKENS, THEME_IDS, isValidThemeId } from './themeTokens';

/**
 * Structural completeness check for the theme system introduced to bring the
 * 12 web decorative themes (arctic, autumn, forest, lagoon, meadow, midnight,
 * ocean, parchment, rose, slate, sunrise, sunset) over to desktop.
 *
 * themeTokens.ts (this package's list of selectable themes) and themes.css
 * (the actual CSS custom property palette each theme needs) are two views of
 * the same 15 themes, kept in sync by hand rather than generated - see
 * themeTokens.ts's doc comment for why. This test is the guardrail for that:
 * it doesn't re-render anything or check pixel colors (jsdom under vitest
 * does not apply this project's actual CSS cascade - see
 * settings-preferences.md), but it does parse themes.css as text and assert
 * every theme in THEME_TOKENS has a matching `[data-theme="<id>"]` block that
 * defines every CSS custom property the rest of the app's stylesheets rely
 * on, so a future theme addition that forgets a token fails a test instead of
 * shipping a pane with invisible text.
 */
const themesCssPath = join(dirname(fileURLToPath(import.meta.url)), 'themes.css');
const themesCss = readFileSync(themesCssPath, 'utf8');

function extractThemeBlock(id: string): string | undefined {
  const match = new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`).exec(themesCss);
  return match?.[1];
}

// The token surface every [data-theme] block must define so themes.css's
// shared `:root` DERIVED COLOR VARIABLES block (rgb(var(--theme-x-rgb))) and
// the rest of the app's stylesheets have something to resolve.
const REQUIRED_RGB_TOKENS = [
  '--theme-bg-primary-rgb', '--theme-bg-secondary-rgb', '--theme-bg-tertiary-rgb',
  '--theme-bg-hover-rgb', '--theme-bg-active-rgb', '--theme-bg-strong-rgb',
  '--theme-surface-primary-rgb', '--theme-surface-secondary-rgb', '--theme-surface-elevated-rgb',
  '--theme-text-primary-rgb', '--theme-text-secondary-rgb', '--theme-text-heading-rgb',
  '--theme-text-muted-rgb', '--theme-text-inverse-rgb',
  '--theme-border-primary-rgb', '--theme-border-secondary-rgb', '--theme-border-focus-rgb',
  '--theme-accent-primary-rgb', '--theme-accent-hover-rgb', '--theme-accent-strong-rgb', '--theme-accent-text-rgb',
  '--theme-christ-rgb',
  '--theme-input-bg-rgb', '--theme-input-border-rgb', '--theme-input-text-rgb', '--theme-input-placeholder-rgb',
  '--theme-control-bg-rgb', '--theme-control-hover-rgb', '--theme-control-text-rgb',
  '--theme-danger-rgb', '--theme-success-rgb', '--theme-warning-rgb', '--theme-info-rgb',
];

const REQUIRED_LITERAL_TOKENS = [
  '--theme-bg-overlay',
  '--theme-pane-header-bg', '--theme-pane-header-border', '--theme-pane-header-text',
  '--theme-tab-text', '--theme-tab-active-bg', '--theme-tab-active-border',
  '--theme-study-controls-bg', '--theme-study-controls-border',
  '--theme-link-color', '--theme-strongs-color',
  '--theme-morph-verb', '--theme-morph-noun', '--theme-morph-adjective', '--theme-morph-pronoun',
  '--theme-footnote-color', '--theme-crossref-color',
  // Bug #2 fix: these were declared for light/dark/sepia long before any CSS
  // rule consumed them. Every theme (old and new) must still carry them.
  '--theme-range-track', '--theme-range-thumb',
  '--theme-highlight-alpha', '--theme-highlight-preview-alpha',
];

describe('themeTokens.ts <-> themes.css structural agreement', () => {
  it('THEME_TOKENS has exactly 15 themes (3 core + 12 ported from web) with unique ids', () => {
    expect(THEME_TOKENS).toHaveLength(15);
    expect(new Set(THEME_IDS).size).toBe(15);
  });

  it.each(THEME_TOKENS.map((t) => t.id))('themes.css has a [data-theme="%s"] block', (id) => {
    expect(extractThemeBlock(id)).toBeDefined();
  });

  it.each(THEME_TOKENS.map((t) => t.id))('the [data-theme="%s"] block defines every required RGB token', (id) => {
    const block = extractThemeBlock(id);
    expect(block).toBeDefined();
    for (const token of REQUIRED_RGB_TOKENS) {
      expect(block).toContain(`${token}:`);
    }
  });

  it.each(THEME_TOKENS.map((t) => t.id))('the [data-theme="%s"] block defines every required literal token (incl. range slider)', (id) => {
    const block = extractThemeBlock(id);
    expect(block).toBeDefined();
    for (const token of REQUIRED_LITERAL_TOKENS) {
      expect(block).toContain(`${token}:`);
    }
  });

  it('isValidThemeId agrees with THEME_IDS', () => {
    for (const id of THEME_IDS) {
      expect(isValidThemeId(id)).toBe(true);
    }
    expect(isValidThemeId('not-a-real-theme')).toBe(false);
  });
});

describe('themes.css range-slider consumption (bug #2)', () => {
  it('input[type=range] gets a track and thumb styled from --theme-range-track/--theme-range-thumb', () => {
    expect(themesCss).toMatch(/input\[type=['"]range['"]\][^{]*\{[^}]*appearance:\s*none/);
    expect(themesCss).toContain('::-webkit-slider-runnable-track');
    expect(themesCss).toContain('::-webkit-slider-thumb');
    expect(themesCss).toContain('::-moz-range-track');
    expect(themesCss).toContain('::-moz-range-thumb');
    // The runnable-track/thumb rules must actually reference the theme
    // variables, not a hardcoded color, or every theme change would leave
    // sliders behind.
    const trackRuleMatch = /::-webkit-slider-runnable-track\s*\{([^}]*)\}/.exec(themesCss);
    expect(trackRuleMatch?.[1]).toContain('var(--theme-range-track)');
    const thumbRuleMatch = /::-webkit-slider-thumb\s*\{([^}]*)\}/.exec(themesCss);
    expect(thumbRuleMatch?.[1]).toContain('var(--theme-range-thumb)');
  });
});
