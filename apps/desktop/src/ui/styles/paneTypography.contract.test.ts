import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Source-level contracts for styling bugs that jsdom cannot observe.
 *
 * These are all "a declared value silently beat the value we meant to cascade"
 * or "a flex item's min-content floor blew past its container" - both are pure
 * layout/cascade outcomes, and neither is reproducible in a component test:
 * jsdom does not resolve `var()`/`calc()`, does not inherit computed values
 * down the tree, and reports every element as 0x0. A real computed-style
 * assertion needs a browser (Playwright/Electron), which is a separate, much
 * slower pass. Until then these assertions pin the *mechanism* of each fix in
 * the source, so a future edit that reintroduces the bug fails here rather than
 * in a bug report.
 */

// `import.meta.url` is an http:// URL under the jsdom environment, so anchor
// on the vitest root (apps/desktop) instead.
const uiDir = resolve(process.cwd(), 'src/ui');
const read = (relative: string): string => readFileSync(join(uiDir, relative), 'utf-8');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (full.endsWith('.tsx') && !full.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

describe('pane typography cascade', () => {
  const globals = read('styles/globals.css');

  it('neutralizes @tailwindcss/typography sizing inside every pane wrapper', () => {
    // `.prose` declares `font-size: 1rem; line-height: 1.75` (and `.prose-lg`
    // 1.125rem / 1.7778) DIRECTLY on the element it is applied to. A declared
    // value always wins over an inherited one, so the pane's own
    // `--pane-font-size-*` / `--pane-line-height-*` - and the Global Font Scale
    // folded into them - never reached the commentary text at all. The Fonts
    // preferences for the commentary pane looked completely dead.
    const rule = globals.match(
      /\.pane-content-bible \.prose,\s*\.pane-content-commentary \.prose,\s*\.pane-content-book \.prose,\s*\.pane-content-dictionary \.prose\s*\{([^}]*)\}/,
    );
    expect(rule, 'globals.css must neutralize .prose sizing under the pane wrappers').not.toBeNull();
    expect(rule![1]).toMatch(/font-size:\s*inherit/);
    expect(rule![1]).toMatch(/line-height:\s*inherit/);
  });

  it('keeps the pane font-size expressed through --global-font-scale', () => {
    // Inheriting is only useful if the wrapper itself still multiplies by the
    // Global Font Scale slider - that is where the value being inherited comes
    // from.
    expect(globals).toMatch(
      /\.pane-content-commentary\s*\{[^}]*font-size:\s*calc\([^;]*--global-font-scale/,
    );
  });

  it('never puts `prose` and a pane wrapper on the same element', () => {
    // Same-element is the one arrangement the rule above cannot fix: the
    // element would then inherit from its *parent* instead of using the pane
    // rule, and the outcome would fall back to emitted source order. It also
    // silently misses `.pane-content-commentary .prose a` link styling, which
    // needs `prose` to be a genuine descendant. Nest instead - see
    // components/study/StudyRichText.tsx.
    const offenders: string[] = [];
    for (const file of tsxFiles(uiDir)) {
      const source = readFileSync(file, 'utf-8');
      // Only look at className string literals, so prose mentioned in a comment
      // (as StudyRichText does, explaining this very rule) is not a false hit.
      for (const [, value] of source.matchAll(/className=(?:\{`|")([^"`]*)(?:`\}|")/g)) {
        const classes = value.split(/\s+/);
        const hasProse = classes.includes('prose');
        const hasPane = classes.some(c => c.startsWith('pane-content-'));
        if (hasProse && hasPane) offenders.push(`${file}: ${value.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('dockview tab strip drop target', () => {
  const overrides = read('styles/dockview-overrides.css');

  it('leaves the void container hoverable', () => {
    // `.dv-void-container` is the only drop target that yields an insertion
    // index past the last tab (`index: tabs.size`). An app override set
    // `flex-grow: 0` to pull the "+" button next to the last tab, which - with
    // no content of its own - measured the void at 0px, so it could never be
    // hovered and appending a tab at the end was impossible.
    const rule = overrides.match(/\.dv-tabs-and-actions-container \.dv-void-container\s*\{([^}]*)\}/);
    expect(rule, 'the void container needs an explicit, non-zero size').not.toBeNull();
    expect(rule![1]).not.toMatch(/flex-grow:\s*0/);
    expect(rule![1]).toMatch(/flex-grow:\s*1/);
    expect(rule![1]).toMatch(/min-width:\s*\d+px/);
  });

  it('keeps the "+" button next to the last tab by ordering, not by starving the void', () => {
    expect(overrides).toMatch(
      /\.dv-tabs-and-actions-container \.dv-right-actions-container\s*\{[^}]*order:\s*0/,
    );
  });
});

describe('parallel version picker sizing', () => {
  const source = read('components/BiblePaneOverlays.tsx');
  const panel = source.match(/className="bg-surface rounded-lg shadow-xl ([^"]*)"/);
  const select = source.match(/className="(flex-1[^"]*border border-border rounded text-sm)"/);

  it('caps the popup and clips anything that would paint past it', () => {
    expect(panel).not.toBeNull();
    expect(panel![1]).toContain('max-w-[90vw]');
    expect(panel![1]).toContain('overflow-hidden');
  });

  it('lets the version selects shrink below their widest option label', () => {
    // A flex item's default `min-width: auto` resolves, for a <select>, to its
    // min-content width - the widest <option>, here
    // "KJV - King James Version (Authorized)". `flex-shrink` cannot go below
    // that, so without `min-w-0` the selects rendered at min-content width and
    // jutted straight through the popup border.
    expect(select).not.toBeNull();
    expect(select![1]).toContain('min-w-0');
    expect(select![1]).toContain('truncate');
  });
});
