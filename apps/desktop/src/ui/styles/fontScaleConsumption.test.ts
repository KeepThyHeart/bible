import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/**
 * B-045: one UI scale for the whole chrome.
 *
 * `--ui-scale` = (UI control font size / 14) x global font scale, written on
 * <html> by usePreferencesStore. The root font size is `16px * --ui-scale`, so
 * every rem-based rule (Tailwind utilities, headers, menus, dialogs, tabs)
 * scales together, like browser zoom. Chrome rules therefore use plain rem and
 * must NOT also multiply `--ui-control-font-size` / `--global-font-scale`
 * (that double scaling made tabs balloon while everything else stayed 1x).
 * Bible/study text keeps its own size setting: only `.pane-content-*` and
 * `.study-verse-text` still read `--global-font-scale`.
 *
 * Text-level checks, because jsdom does not apply the real cascade.
 */
const here = dirname(fileURLToPath(import.meta.url));
const globalsCss = readFileSync(join(here, 'globals.css'), 'utf8');
const themesCss = readFileSync(join(here, 'themes.css'), 'utf8');
const dockviewCss = readFileSync(join(here, 'dockview-overrides.css'), 'utf8');
const tabRendererSource = readFileSync(join(here, '..', 'components', 'DockviewTabRenderer.tsx'), 'utf8');

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  expect(body, `rule for \`${selector}\``).toBeDefined();
  return body ?? '';
}

/** Split a stylesheet into [selector, body] rules (flat; good enough for these files). */
function rules(css: string): Array<[string, string]> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<[string, string]> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) out.push([m[1].trim(), m[2]]);
  return out;
}

describe('UI size scales the root font size', () => {
  it('html font-size is 16px x --ui-scale', () => {
    const body = ruleBody(globalsCss, 'html');
    expect(body).toContain('calc(16px * var(--ui-scale, 1))');
  });

  it('body keeps the 13px UI text baseline as rem x --ui-font-scale, without the global scale', () => {
    const body = ruleBody(globalsCss, 'body');
    expect(body).toContain('0.8125rem');
    expect(body).toContain('var(--ui-font-scale');
    expect(body).not.toContain('--global-font-scale');
  });
});

describe('chrome rules do not scale a second time', () => {
  it.each([
    ['globals.css', globalsCss],
    ['themes.css', themesCss],
    ['dockview-overrides.css', dockviewCss],
  ])('%s: only Bible/study text rules read the scale variables', (_name, css) => {
    const offenders = rules(css)
      .filter(([, body]) => /--ui-control-font-size|--global-font-scale/.test(body))
      .map(([sel]) => sel)
      .filter((sel) => !/\.pane-content-|\.study-verse-text|:root|^html$/.test(sel));
    expect(offenders).toEqual([]);
  });

  it('pane header and tab rules are plain rem', () => {
    for (const sel of ['.pane-header-title', '.pane-tab', '.pane-tab-compact', '.pane-header-subtitle']) {
      const body = ruleBody(globalsCss, sel);
      expect(body, sel).toMatch(/font-size:\s*[\d.]+rem/);
    }
  });

  it('the tab renderer sizes its chrome in rem, not from --ui-control-font-size', () => {
    expect(tabRendererSource).not.toContain('--ui-control-font-size');
    expect(tabRendererSource).not.toContain('--global-font-scale');
    expect(tabRendererSource).not.toMatch(/fontSize:\s*'\d+px'/);
  });
});

describe('Bible text stays on its own size', () => {
  it.each(['bible', 'commentary', 'book', 'dictionary'])('.pane-content-%s still multiplies --global-font-scale', (pane) => {
    expect(ruleBody(globalsCss, `.pane-content-${pane}`)).toContain('var(--global-font-scale');
  });

  it('verse numbers are sized relative to their text (em), not in chrome units', () => {
    expect(ruleBody(globalsCss, '.verse-number')).toMatch(/font-size:\s*[\d.]+em/);
  });
});
