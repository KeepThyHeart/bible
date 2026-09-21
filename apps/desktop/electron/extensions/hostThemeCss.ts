/**
 * Host design tokens, rendered as a stylesheet for extension panel iframes.
 *
 * ## The problem this solves
 *
 * A panel renders in a sandboxed iframe on its own `ext-ui://<extensionId>`
 * origin. That origin shares nothing with the app's renderer - no stylesheet,
 * no `<html data-theme>` attribute, no CSS custom properties. All the panel
 * ever received about the app's appearance was the small `ThemeInfo` blob from
 * `ui.getTheme` (an id and a light/dark polarity), so every panel author had to
 * re-invent the app's visual language from two or three colours and guesswork.
 * The result was permanently, subtly wrong: right-ish backgrounds with wrong
 * borders, accent blues that were not the app's accent blue, focus rings that
 * did not match anything, and nothing that tracked a theme switch.
 *
 * Meanwhile the app already has a real token system - roughly 143 `--theme-*`
 * custom properties across fifteen themes in `src/ui/styles/themes.css`,
 * checked against `admin/brand/theme-palettes.json` by `themePalette.test.ts`.
 * This module makes that same token set reachable from the iframe as plain CSS
 * on `:root`, served from the reserved `ext-ui://host/theme.css` URL.
 *
 * ## Why the stylesheet is parsed rather than re-declared
 *
 * The obvious alternative - a hand-written table of tokens in TypeScript - is
 * exactly the duplication `themePalette.test.ts` exists to prevent, and it
 * would rot the first time somebody tunes a colour in `themes.css`. Parsing the
 * real stylesheet means there is still ONE place the desktop palette is
 * written down, and a token added there reaches extension panels with no
 * follow-up edit here.
 *
 * The stylesheet text is inlined at build time via Vite's `?raw` suffix (see
 * `cssRaw.d.ts` for why that, and not an `fs.readFileSync`).
 *
 * ## Why the output is a flattened `:root` block
 *
 * `themes.css` relies on the cascade: each `[data-theme="<id>"]` block declares
 * only the `*-rgb` triplets, and a later shared `:root` block derives every
 * consumable token from them (`--theme-bg-primary: rgb(var(--theme-bg-primary-rgb))`).
 * The iframe has no `data-theme` attribute to select on, so we replay that
 * cascade ourselves: take every top-level rule whose selector list contains
 * `:root` or the active theme's `[data-theme="..."]`, in SOURCE ORDER, and
 * concatenate their custom-property declarations into a single `:root` block.
 *
 * Source order is the whole trick. `:root` and `[data-theme="x"]` have
 * identical specificity (0,1,0), so in the real app later declarations already
 * win; flattening into one block preserves that, because within a block the
 * last declaration of a property wins too. A panel therefore sees byte-for-byte
 * the values the app itself resolves for that theme. Declarations that are
 * `var()`/`color-mix()` references are passed through untouched and resolve in
 * the iframe exactly as they do in the renderer.
 *
 * Only `--`-prefixed declarations survive the filter. `themes.css` is not
 * purely tokens - its tail holds real rules for `.verse-row`, scrollbars,
 * range inputs and so on - and none of that is the host's business to impose
 * on an extension's layout. Tokens are an offer; component CSS would be a
 * takeover.
 */

import log from 'electron-log';

import themesCss from '../../src/ui/styles/themes.css?raw';

/**
 * The theme served when nothing has told us otherwise. Matches the renderer's
 * own initial state (`usePreferencesStore`'s `theme: 'light'`) and the
 * fallback `loadFromSession` uses for a corrupt session file, so a panel that
 * loads before the first theme notification arrives is merely early, never
 * wrong in a different direction than the app.
 */
export const DEFAULT_HOST_THEME_ID = 'light';

interface StyleRule {
  selectors: string[];
  declarations: string[];
}

/** `[data-theme="sunset"]` -> `sunset`. Anchored: nothing fuzzy matches. */
const THEME_SELECTOR = /^\[data-theme="([a-z0-9-]+)"\]$/;

/**
 * Drop `/* ... *\/` comments before parsing.
 *
 * `themes.css` is heavily commented - the comments are most of its value - and
 * a comment can sit anywhere, including between a property and its colon. This
 * is a lexical strip rather than a real tokenizer, so a `/*` sequence inside a
 * string literal would be mis-read; `themes.css` contains no string literals
 * (it is custom properties and colour functions), and the token filter below
 * would discard the damage anyway since the result would not start with `--`.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Split a declaration block on `;` at paren depth zero.
 *
 * Depth tracking is not decoration: `themes.css` uses
 * `color-mix(in srgb, rgb(var(--x)) 12%, var(--y))`, and a naive `split(';')`
 * is fine for that but a naive split on `,` would not be - keeping one
 * depth-aware splitter avoids the temptation to add a fragile second one.
 */
function splitDeclarations(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) {
      out.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out.filter((d) => d.length > 0);
}

/**
 * Collect the top-level rules of the stylesheet.
 *
 * At-rules are skipped wholesale. `themes.css` has three (`@media (hover:
 * hover)`, `@keyframes verse-arrival-flash`, `@media (prefers-reduced-motion:
 * reduce)`) and none of them declares a `--theme-*` token; they carry component
 * behaviour, which this module deliberately does not export. Skipping them by
 * prelude rather than by name means a future at-rule cannot silently leak
 * component CSS into panels.
 */
function parseTopLevelRules(css: string): StyleRule[] {
  const rules: StyleRule[] = [];
  let depth = 0;
  let preludeStart = 0;
  let blockStart = 0;
  let prelude = '';

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) {
        prelude = css.slice(preludeStart, i).trim();
        blockStart = i + 1;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        if (!prelude.startsWith('@')) {
          rules.push({
            selectors: prelude
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
            declarations: splitDeclarations(css.slice(blockStart, i)),
          });
        }
        preludeStart = i + 1;
      }
    }
  }
  return rules;
}

/** Parsed once at module load; the stylesheet is a build-time constant. */
const RULES: StyleRule[] = parseTopLevelRules(stripComments(themesCss));

/**
 * Every theme id the stylesheet actually defines, discovered from its
 * `[data-theme="..."]` selectors rather than restated here.
 *
 * This is the allowlist `setActiveHostTheme` validates against. It is derived
 * from the stylesheet, not from `themeTokens.ts`'s `ThemeId` union, on purpose:
 * the question this module has to answer is "can I render tokens for this?",
 * and only the stylesheet knows. A theme added to the union but not to the CSS
 * would otherwise be accepted here and then serve the light palette silently.
 */
export const HOST_THEME_IDS: readonly string[] = (() => {
  const ids = new Set<string>();
  for (const rule of RULES) {
    for (const selector of rule.selectors) {
      const match = THEME_SELECTOR.exec(selector);
      if (match) ids.add(match[1]);
    }
  }
  return Object.freeze([...ids]);
})();

function selectorApplies(selector: string, themeId: string): boolean {
  if (selector === ':root') return true;
  const match = THEME_SELECTOR.exec(selector);
  return match !== null && match[1] === themeId;
}

/**
 * Render the flattened `:root` token block for one theme.
 *
 * Exported for the tests; production code goes through
 * `getActiveHostThemeCss()` so it gets the memoized copy.
 */
export function buildHostThemeCss(themeId: string): string {
  // Insertion-ordered, keyed by property name: a later declaration of the same
  // token REPLACES the earlier one in place rather than being appended after
  // it. That is the cascade collapsed to its result, and it is safe to collapse
  // because a custom property's declaration order inside a block does not
  // affect anything - the cascade picks one winning value per property, and
  // `var()` substitution happens afterwards at computed-value time. Keeping
  // both would still resolve correctly, but it would ship the light palette
  // inside every dark theme's sheet (roughly double the bytes) and make the
  // served file a puzzle to read in devtools, where a token appears twice with
  // different values and only the second one is real.
  const declarations = new Map<string, string>();

  for (const rule of RULES) {
    if (!rule.selectors.some((selector) => selectorApplies(selector, themeId))) continue;
    for (const declaration of rule.declarations) {
      // Tokens only - see the module header on why component rules stay home.
      if (!declaration.startsWith('--')) continue;
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim();
      // Multi-line values (the `color-mix` ones wrap in the source) collapse to
      // one line so the served file stays readable in devtools.
      declarations.set(property, `  ${declaration.replace(/\s+/g, ' ')};`);
    }
  }

  return [
    '/* Host design tokens. Generated from apps/desktop/src/ui/styles/themes.css',
    `   for theme "${themeId}". Served read-only at ext-ui://host/theme.css.`,
    '   Link this instead of guessing the app palette; the values follow the',
    '   user\'s theme automatically. */',
    ':root {',
    ...declarations.values(),
    '}',
    '',
  ].join('\n');
}

/**
 * Rendered CSS per theme. Bounded by `HOST_THEME_IDS` (fifteen entries), so
 * this is a memo, not a cache that needs eviction - `setActiveHostTheme`
 * rejects anything not on the list, and nothing else writes to it.
 */
const renderedByTheme = new Map<string, string>();

let activeThemeId = DEFAULT_HOST_THEME_ID;

/**
 * Point the host stylesheet at a different theme.
 *
 * ## Why a setter and not a lookup
 *
 * The main process does not own the theme and has no cheap way to ask for it.
 * The theme lives in the renderer's `usePreferencesStore`, is applied as a
 * `data-theme` attribute on `<html>`, and is persisted inside the session blob
 * (a renderer-owned document) rather than in any main-process preferences
 * store. Main's only existing knowledge of it is the `menu:update-theme` IPC
 * message the renderer already sends so the View menu's radio buttons can
 * follow along.
 *
 * So the theme-change path already crosses into main; this hooks onto it
 * instead of inventing a second channel, and certainly instead of polling. The
 * cost is that the panel palette is only as fresh as that notification, which
 * is why `usePreferencesStore.loadFromSession` now sends it too (it previously
 * did not, and the View menu's radio was equally stale after a restore).
 *
 * Returns false for an id the stylesheet cannot render. The value arrives over
 * IPC from the renderer, so it is validated rather than trusted; a bad value
 * leaves the previous theme in place, because serving the light palette to a
 * dark-theme user is a worse failure than serving a slightly stale one.
 */
export function setActiveHostTheme(themeId: string): boolean {
  if (typeof themeId !== 'string' || !HOST_THEME_IDS.includes(themeId)) {
    log.warn(`[ext-ui] ignoring unknown theme id for host tokens: ${String(themeId)}`);
    return false;
  }
  activeThemeId = themeId;
  return true;
}

/** The theme id `ext-ui://host/theme.css` is currently rendering. */
export function getActiveHostTheme(): string {
  return activeThemeId;
}

/** The token stylesheet for the active theme, rendered at most once per theme. */
export function getActiveHostThemeCss(): string {
  const cached = renderedByTheme.get(activeThemeId);
  if (cached !== undefined) return cached;
  const css = buildHostThemeCss(activeThemeId);
  renderedByTheme.set(activeThemeId, css);
  return css;
}

/**
 * Test seam. Resets the module back to its load-time state so one test's theme
 * switch cannot leak into the next.
 */
export function resetActiveHostThemeForTests(): void {
  activeThemeId = DEFAULT_HOST_THEME_ID;
}
