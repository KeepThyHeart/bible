import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/**
 * Regression tests for the two "the slider does nothing" symptoms:
 * `--global-font-scale` (General -> Global Font Scale) and
 * `--ui-control-font-size` (General -> UI Control Font Size).
 *
 * Both variables were always written onto `document.documentElement`
 * correctly (see usePreferencesStore.test.ts) - the bugs were downstream, in
 * CSS. These are text-level checks, because jsdom under vitest does not apply
 * this project's real cascade (PostCSS/Tailwind never runs, and `@import`ed
 * sheets are not resolved). A text check is therefore the only place this can
 * be caught at all, so it has to assert the *winning* declarations, not merely
 * that a consuming rule exists somewhere.
 *
 * The cascade that made the first version of this file insufficient:
 * `globals.css` `@import`s `themes.css` ABOVE `@tailwind components`, so
 * themes.css's `.pane-header-title { font-size: calc(var(--ui-control-font-size) ...) }`
 * is emitted first and a `@apply text-sm` in globals.css's own
 * `@layer components` block re-declares font-size at IDENTICAL specificity and
 * wins. Asserting only "themes.css references the variable" passed the whole
 * time the setting was dead. Hence the two extra assertions below: the
 * globals.css rule must itself reference the variable, and it must not carry a
 * Tailwind text-size utility that would shadow it again.
 */
const here = dirname(fileURLToPath(import.meta.url));
const globalsCss = readFileSync(join(here, 'globals.css'), 'utf8');
const themesCss = readFileSync(join(here, 'themes.css'), 'utf8');
const dockviewCss = readFileSync(join(here, 'dockview-overrides.css'), 'utf8');
/* The tab strip's sizes are inline styles, so the guard has to read the
   component, not a stylesheet. */
const tabRendererSource = readFileSync(join(here, '..', 'components', 'DockviewTabRenderer.tsx'), 'utf8');

/** Body of the first rule whose selector list starts with `selector {`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  expect(body, `rule for \`${selector}\``).toBeDefined();
  return body ?? '';
}

/**
 * Tailwind font-size utilities (`text-sm`, `text-xs`, `text-[13px]`, ...).
 *
 * Deliberately narrow: `text-start`, `text-primary` and friends are colour /
 * alignment utilities and must not trip this.
 */
const TAILWIND_TEXT_SIZE = /\btext-(xs|sm|base|lg|xl|\d?xl|\[[^\]]+\])\b/;

/** The `<ratio>` in `calc(var(--ui-control-font-size...) * <ratio> * ...)`. */
function controlSizeRatio(body: string): number {
  const match = /--ui-control-font-size[^)]*\)\s*\*\s*([\d.]+)/.exec(body);
  expect(match, `a numeric ratio in \`${body.trim()}\``).not.toBeNull();
  return Number(match?.[1]);
}

/** Rules whose font-size must track the UI-control size setting. */
const UI_CONTROL_SIZED = ['.pane-header-title', '.pane-header-subtitle', '.pane-tab', '.pane-tab-compact'];

describe('--global-font-scale is multiplied into rendered font sizes', () => {
  it('globals.css multiplies it into body (UI chrome baseline) and every .pane-content-* rule', () => {
    const bodyRule = ruleBody(globalsCss, 'body');
    expect(bodyRule).toContain('var(--global-font-scale');
    expect(bodyRule).toContain('var(--ui-font-family)');
    expect(bodyRule).toContain('var(--ui-line-height)');

    for (const pane of ['bible', 'commentary', 'book', 'dictionary']) {
      const rule = ruleBody(globalsCss, `.pane-content-${pane}`);
      expect(rule).toContain('var(--global-font-scale');
    }
  });

  it('themes.css multiplies it into --ui-control-font-size (pane headers/tabs)', () => {
    const rule = /\.pane-header,[\s\S]*?\{([^}]*)\}/.exec(themesCss)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toContain('var(--ui-control-font-size)');
    expect(rule).toContain('var(--global-font-scale');
  });
});

describe('--ui-control-font-size reaches the declarations that actually win', () => {
  it.each(UI_CONTROL_SIZED)(
    'globals.css sizes %s from the variable rather than a Tailwind text-* utility',
    (selector) => {
      const body = ruleBody(globalsCss, selector);

      // The rule that wins the cascade must be the one reading the setting.
      expect(body, `${selector} must size itself from --ui-control-font-size`)
        .toContain('var(--ui-control-font-size');
      expect(body, `${selector} must still honour the global font scale`)
        .toContain('var(--global-font-scale');

      // ...and must not re-declare font-size through a utility class, which is
      // exactly how themes.css's rule was silently overridden.
      const applyList = /@apply([^;]*);/.exec(body)?.[1] ?? '';
      expect(applyList, `${selector} @apply must not set a font size`)
        .not.toMatch(TAILWIND_TEXT_SIZE);
    },
  );

  it('keeps the header title larger than its subtitle', () => {
    // The pre-fix sizes were 14px title / 12px subtitle. Expressed as ratios of
    // the 14px default control size that is 1.0 and ~0.857; the hierarchy, not
    // the exact numbers, is what must survive a future tweak.
    const title = controlSizeRatio(ruleBody(globalsCss, '.pane-header-title'));
    const subtitle = controlSizeRatio(ruleBody(globalsCss, '.pane-header-subtitle'));
    expect(title).toBe(1);
    expect(subtitle).toBeLessThan(title);
  });

  it('the live dockview tab strip consumes the variable and hard-codes no size', () => {
    // `.pane-tab` in globals.css matches nothing that is mounted; every tab a
    // user can see is `.dockview-tab-content`, so that is the selector this
    // test must check.
    const body = ruleBody(dockviewCss, '.dockview-theme-light.dockview-theme-light .dv-tab .dockview-tab-content');
    expect(body).toContain('var(--ui-control-font-size');
    expect(body).toContain('var(--global-font-scale');
    // No rule anywhere in the dockview chrome may pin a literal font size.
    expect(dockviewCss).not.toMatch(/font-size:\s*\d/);
  });

  it('the tab renderer sizes its own chrome from the variable, not from literals', () => {
    // These are INLINE styles, which outrank any stylesheet - so no CSS rule
    // could scale them and the slider moved nothing on the tab strip. The
    // component computes them from the same variable now. Icon, subtitle and
    // close button are included: scaling only the title left a 20px tab
    // carrying a 10px subtitle.
    expect(tabRendererSource).not.toMatch(/fontSize:\s*'\d+px'/);

    const scaled = tabRendererSource.match(/fontSize:\s*controlScaled\(\d+\)/g) ?? [];
    expect(scaled.length).toBeGreaterThanOrEqual(5);
    expect(tabRendererSource).toContain('var(--ui-control-font-size');
    expect(tabRendererSource).toContain('var(--global-font-scale');
  });
});
