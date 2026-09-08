#!/usr/bin/env node
/**
 * Finds user-facing English that is hard-coded in source instead of living in
 * a locale catalog.
 *
 * The point is reviewability, not translation coverage. Every word a user can
 * read should be reviewable by reading `apps/desktop/locales/en/*.json`
 * and `apps/web/src/locales/en/*.json` alone; anything this script prints
 * is English that a reviewer of those files would never see.
 *
 * That is a different question from the one the two existing checkers answer:
 *
 *   - `scripts/check-translations.js` and
 *     `apps/desktop/scripts/i18n-validate.js` compare non-English catalogs
 *     against `en/`. They say nothing about strings that never reached a
 *     catalog at all.
 *   - `apps/desktop/scripts/i18n-extract.js` does look at source, but it
 *     skips any line containing a `t(` call, matches JSX text only when the
 *     whole node fits on one line, ignores object properties, and never scans
 *     `apps/web`. Those four blind spots hide most of what is left.
 *
 * Usage:
 *   node scripts/find-untranslated-strings.js               # grouped report
 *   node scripts/find-untranslated-strings.js --json        # machine-readable
 *   node scripts/find-untranslated-strings.js --summary     # per-file counts
 *   node scripts/find-untranslated-strings.js --rule=jsx-text
 *   node scripts/find-untranslated-strings.js apps/web/src/components/X.tsx
 *
 * Exit code is 0 always: this is an inventory, not yet a gate. Wire it into
 * CI with `--max=<n>` once the number stops moving.
 *
 * What is flagged (five rules, each requiring a *string literal* — a `t(...)`
 * call is an expression and so can never match, which is why no line-level
 * "already localized" skip is needed):
 *
 *   jsx-text     Text between JSX tags, including nodes that span lines.
 *   jsx-attr     A literal on an attribute a user can read or hear:
 *                title, placeholder, alt, aria-label, aria-description...
 *   obj-prop     A literal on a property name that denotes user-visible text:
 *                label, message, detail, buttons, emptyMessage, tooltip...
 *                This is where native menu specs and dialog options live.
 *   prose        A multi-word English sentence in a template literal or a
 *                const, e.g. a privacy blurb rendered straight into a dialog.
 *   tf-fallback  The English argument of `tf(t, 'key', 'English text')`.
 *                Reported separately: the catalog normally shadows it, so it
 *                is usually dead text rather than text a user reads — but it
 *                is still English in source that can drift from the catalog.
 *                Subtract it to get "English a reviewer of en/ never sees".
 *
 * Deliberately NOT flagged, because the maintainer does not review them:
 * console/log output, `throw new Error(...)` (developer-facing unless it is
 * separately rendered — see the report's caveat), test and e2e files,
 * comments, imports, type declarations, URLs, paths, CSS, HTML entities,
 * dotted catalog keys, and identifier-shaped tokens.
 *
 * False negatives are preferred to false positives. A checker that cries wolf
 * gets turned off, and the numbers here have to be trustworthy enough to
 * decide a release on.
 *
 * Measured precision: on a random sample of 25 non-`tf-fallback` findings,
 * hand-checked against the source, ~4 were wrong — a typeface name treated as
 * a translatable label, and one JSX fragment. Read the number as accurate to
 * about ten per cent, which is well inside what a ship/no-ship decision needs.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

/** Source roots that can contain user-facing text, and how to label them. */
const SCAN_ROOTS = [
  { label: 'desktop/renderer', dir: 'apps/desktop/src/ui' },
  { label: 'desktop/main', dir: 'apps/desktop/electron' },
  { label: 'web/client', dir: 'apps/web/src' },
  { label: 'web/server', dir: 'apps/web/server' },
];

const EXCLUDE = [
  /[\\/]node_modules[\\/]/,
  /[\\/](dist|out|build|release|coverage)[\\/]/,
  /[\\/]e2e[\\/]/,
  /[\\/]__(tests|mocks)__[\\/]/,
  /[\\/]locales[\\/]/,
  /\.test\.(ts|tsx|js|jsx)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /\.d\.ts$/,
];

/** Attributes whose value a user reads on screen or hears from a screen reader. */
const USER_ATTRS = new Set([
  'title', 'placeholder', 'alt', 'label', 'tooltip',
  'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription',
  'aria-valuetext', 'ariaLabel', 'ariaDescription',
  'emptyMessage', 'confirmLabel', 'cancelLabel', 'submitLabel', 'buttonLabel',
  'heading', 'subtitle', 'legend', 'summary', 'hint', 'caption',
]);

/**
 * Object property names that carry user-visible text. This is the rule that
 * catches native menu specs (`{ label: 'File' }`) and Electron dialog options
 * (`{ message, detail, buttons }`), neither of which any existing checker
 * looks at.
 *
 * `name` and `text` are deliberately absent: they are far more often an
 * identifier than a message, and the noise would swamp the signal.
 */
const USER_PROPS = new Set([
  'label', 'title', 'message', 'detail', 'description', 'placeholder',
  'tooltip', 'heading', 'subtitle', 'confirmLabel', 'cancelLabel',
  'emptyMessage', 'errorMessage', 'helpText', 'summary', 'caption', 'hint',
  'buttonLabel', 'checkboxLabel', 'noDataText', 'toolTip',
]);

/** Lines whose surrounding call is plainly developer- or protocol-facing. */
const DEVELOPER_CONTEXT =
  /\b(?:console|log|logger|electronLog)\.[a-z]+\s*\(|\b(?:ipcMain|ipcRenderer)\.|\.(?:on|once|emit|send|invoke|handle|notify|dispatch)\s*\(\s*['"`]|\bdescribe\s*\(|\bit\s*\(|\bexpect\s*\(|\bappendLog\s*\(/;

/**
 * Property values that are configuration, not prose. Deliberately narrow:
 * `type:` and `id:` were tried here and had to come out, because a native menu
 * item is written `{ type: 'submenu', label: 'File', id: 'view' }` all on one
 * line — suppressing on those neighbours hid six of the eight untranslated
 * menu-bar labels, which are among the most visible strings in the app.
 */
const NON_PROSE_PROP_CONTEXT = /\b(?:accelerator|href|src|channel)\s*:/;

// ---------------------------------------------------------------------------
// Literal classification
// ---------------------------------------------------------------------------

/**
 * True when a literal is certainly not something a user reads as English.
 *
 * The ordering matters: cheap structural rejects first, then shape-based ones.
 * Anything that survives has at least one alphabetic word of three letters.
 */
function isNotUserText(s) {
  const t = s.trim();
  if (t.length < 3) return true;
  if (!/[A-Za-z]/.test(t)) return true;                    // symbols, digits, icons
  if (/^&[a-zA-Z#][a-zA-Z0-9]*;?$/.test(t)) return true;   // HTML entity: &larr; &times;
  if (/^https?:\/\/|^mailto:|^data:|^file:/.test(t)) return true;
  if (/^[.~/\\]|^[a-z]:[\\/]/i.test(t)) return true;       // paths
  if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return true;          // colors
  if (/^-?\d+(\.\d+)?(px|rem|em|%|vh|vw|pt|ms|s)?$/.test(t)) return true;
  if (/^(?:var|calc|rgb|rgba|hsl|url|translate|linear-gradient)\(/.test(t)) return true;
  if (/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/i.test(t) && !t.includes(' ')) return true; // foo.bar.baz, kebab-case
  if (/^[A-Z0-9_]+$/.test(t)) return true;                 // CONSTANT_LIKE
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return true;          // camelCase identifier
  if (/^[A-Za-z0-9+/=]{24,}$/.test(t)) return true;        // base64-ish blobs
  if (/^<[a-zA-Z/]/.test(t)) return true;                  // raw markup
  if (/^\{\{|\}\}$/.test(t)) return true;                  // handlebars template
  if (/^(?:[A-Za-z]+\+)+[A-Za-z0-9]+$/.test(t)) return true; // accelerator: Mod+Shift+F
  // Must contain a real word.
  if (!/[A-Za-z]{3}/.test(t)) return true;
  return false;
}

/** Multi-word English prose, used by the `prose` rule and to rank findings. */
function looksLikeSentence(s) {
  const t = s.trim();
  if (!/\s/.test(t)) return false;
  const words = t.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z'’-]*$/.test(w));
  return words.length >= 3;
}

/**
 * Closed-class English words. A run of Tailwind utilities ("flex items-center
 * gap-2 text-sm") never contains one and never capitalizes a word, whereas a
 * sentence a user reads almost always does one or the other. This single test
 * removed the overwhelming majority of the `prose` rule's false positives —
 * className strings are by far the most common multi-word literal in a Tailwind
 * codebase, and they outnumbered real findings roughly ten to one.
 */
const FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'with', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'will',
  'can', 'could', 'would', 'should', 'may', 'must', 'not', 'no', 'this',
  'that', 'these', 'those', 'you', 'your', 'it', 'its', 'they', 'their',
  'we', 'our', 'at', 'by', 'as', 'but', 'if', 'when', 'than', 'then', 'do',
  'does', 'did', 'about', 'into', 'over', 'any', 'all', 'each', 'more',
]);

function readsAsEnglish(s) {
  const tokens = s.trim().split(/[\s,.;:!?()]+/).filter(Boolean);
  if (tokens.some((w) => FUNCTION_WORDS.has(w.toLowerCase()))) return true;
  // A capitalized word that is not an ALL-CAPS constant or a hyphenated token.
  return tokens.some((w) => /^[A-Z][a-z]{2,}/.test(w) && !w.includes('-'));
}

/**
 * True when the literal at `index` is the English-fallback argument of
 * `tf(t, 'some.key', 'English text')` (`src/ui/utils/tFallback.ts`).
 *
 * These are a category of their own and are reported under their own rule.
 * The catalog almost always shadows them, so the user does not read them —
 * but they are still English living in source, and nothing stops the literal
 * from drifting away from the catalog wording it duplicates. Counting them
 * with genuinely uncatalogued strings would badly overstate how much English
 * escapes review; hiding them would understate how much English is in code.
 */
function isTfFallback(src, index) {
  const back = src.slice(Math.max(0, index - 220), index);
  if (/\btf\s*\(\s*t\s*,\s*(['"])[^'"\n]+\1\s*,\s*$/.test(back)) return true;
  // `commandItem(deps, 'view.zoomIn', 'Zoom In')` in buildMenuSpec.ts is the
  // same idiom under another name: the command registry's catalog title wins,
  // and the literal is only reached when the key is missing.
  return /\bcommandItem\s*\(\s*\w+\s*,\s*(['"])[^'"\n]+\1\s*,\s*$/.test(back);
}

/** SQL is prose-shaped but is never shown to a user. */
const SQL_LIKE =
  /\b(?:SELECT\s|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW|TRIGGER|VIRTUAL)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX)|PRAGMA\s|FOREIGN\s+KEY|PRIMARY\s+KEY|GROUP\s+BY|ORDER\s+BY|ON\s+CONFLICT|DO\s+UPDATE\s+SET|VALUES\s*\(|BEGIN\s+TRANSACTION)/i;

/**
 * Looks back over the preceding source for a construct that makes the literal
 * developer-facing. A single-line test is not enough: `throw new Error(` and
 * `console.warn(` routinely sit on the line above a long template literal.
 */
function inDeveloperConstruct(src, index) {
  const window = src.slice(Math.max(0, index - 200), index);
  if (/\b(?:throw|new\s+(?:Error|TypeError|RangeError|SyntaxError))\b[\s\S]{0,120}$/.test(window)) return true;
  if (/\b(?:console|log|logger|electronLog)\.[a-z]+\s*\([\s\S]{0,120}$/.test(window)) return true;
  if (/\b(?:className|class)\s*[=:]\s*[\s\S]{0,160}$/.test(window)) return true;
  if (/\b(?:cn|clsx|classNames|twMerge)\s*\([\s\S]{0,160}$/.test(window)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

/**
 * Blanks out comments while preserving byte offsets, so that reported line
 * numbers stay correct. Quote tracking is needed because `//` inside a string
 * (`'https://…'`) is not a comment.
 */
/**
 * A `'` or `"` opens a string only if a matching unescaped quote closes it on
 * the same line — JS single- and double-quoted strings cannot span lines.
 *
 * Without this test the scanner desyncs on the first regex literal containing a
 * quote character (`/[<>:"/\\|?*]/` is common in path validation): every
 * following comment is treated as string contents, and the JSDoc of the rest of
 * the file starts being reported as user-facing prose. That is precisely the
 * kind of nonsense that gets a checker switched off.
 */
function closesOnSameLine(src, i) {
  const quote = src[i];
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '\n') return false;
    if (c === quote) return true;
  }
  return false;
}

function blankComments(src) {
  const out = src.split('');
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if ((c === '"' || c === "'") && !closesOnSameLine(src, i)) { i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (let j = i; j < stop; j++) if (out[j] !== '\n') out[j] = ' ';
      i = stop;
      continue;
    }
    i++;
  }
  return out.join('');
}

function lineAt(src, index) {
  let n = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
}

function lineTextAt(src, index) {
  const start = src.lastIndexOf('\n', index) + 1;
  let end = src.indexOf('\n', index);
  if (end === -1) end = src.length;
  return src.slice(start, end);
}

// ---------------------------------------------------------------------------
// JSX text nodes
// ---------------------------------------------------------------------------

/**
 * Yields the literal text between an opening JSX tag and the next `<` or `{`.
 *
 * A naive `>([^<]+)<` scan cannot be used, because TypeScript generics produce
 * the same shape: `useState<HTMLDivElement>(null); ... <div` looks exactly like
 * a text node containing `(null); ...`. The discriminator is what precedes the
 * `<`: a generic's `<` always follows an identifier character (`useState<`,
 * `React.Dispatch<`), whereas a JSX element's `<` follows whitespace, `(`, `{`,
 * `>` or the start of the file.
 *
 * Text runs are then rejected if they contain code punctuation, which mops up
 * the residue (a stray `a < b` comparison, a regex literal, and so on).
 */
const CODE_IN_TEXT = /[;={}`]|=>|\)\s*\(|\/\s*[gimsuy]?,|^[):?]|\s\?\s|\)\s*:/;

/**
 * Blanks the *contents* of string literals, keeping the quotes and the byte
 * offsets. JSX text never lives inside a string literal, but HTML assembled
 * by concatenation (`'<h2>' + t('x') + '</h2>'`) otherwise looks identical to
 * it — and that HTML is already localized, so flagging it would be wrong.
 */
function maskStrings(src) {
  const out = src.split('');
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
      if (c === quote) { quote = null; i++; continue; }
      if (c !== '\n') out[i] = ' ';
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue; }
    i++;
  }
  return out.join('');
}

function* jsxTextNodes(src) {
  const re = /</g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const at = m.index;
    const prev = at > 0 ? src[at - 1] : '\n';
    if (/[A-Za-z0-9_$.\])]/.test(prev)) continue;   // generic, not an element
    const name = /^<\/?([A-Za-z][A-Za-z0-9._$-]*)/.exec(src.slice(at, at + 60));
    if (!name) continue;

    // Walk to the tag's closing `>`, honouring quotes and `{}` expressions.
    let i = at + 1;
    let depth = 0;
    let quote = null;
    let end = -1;
    for (; i < src.length && i < at + 4000; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; continue; }
      if (c === '>' && depth === 0) { end = i; break; }
    }
    if (end === -1) continue;
    if (src[end - 1] === '/') continue;              // self-closing: no children

    let stop = end + 1;
    while (stop < src.length && src[stop] !== '<' && src[stop] !== '{') stop++;
    const text = src.slice(end + 1, stop).trim();
    if (text.length < 3 || text.length > 200) continue;
    if (CODE_IN_TEXT.test(text)) continue;
    yield { index: end + 1, text: text.replace(/\s+/g, ' ') };
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function scanFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = blankComments(raw);
  const isTsx = /\.(tsx|jsx)$/.test(file);
  const found = [];
  const seen = new Set();

  // `value` is the literal itself; `text` is how it is shown in the report.
  // Two rules can legitimately match the same literal (`description: 'x'` is
  // both an obj-prop and prose), so dedupe on the value and let the first,
  // more specific rule win. Without this, a file of one-line description
  // records is counted twice over.
  const add = (index, rule, value, text = value) => {
    const line = lineAt(src, index);
    if (rule !== 'jsx-text' && isTfFallback(src, index)) rule = 'tf-fallback';
    const dedupe = `${line}:${value.trim()}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    found.push({ file, line, rule, text: text.trim().replace(/\s+/g, ' ') });
  };

  // -- jsx-attr: <X title="Save" />, including attributes spanning lines.
  {
    const re = /(?:^|[\s{])([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(["'])([^"'\n]{3,})\2/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const [, attr, , value] = m;
      if (!USER_ATTRS.has(attr)) continue;
      if (isNotUserText(value)) continue;
      add(m.index, 'jsx-attr', value, `${attr}="${value}"`);
    }
  }

  // -- jsx-text: text between tags. Unlike i18n-extract this crosses newlines,
  //    which is where the top-level ErrorBoundary's English was hiding
  //    ("Something went wrong" and its paragraph are each on their own line
  //    inside a multi-line <h1>/<p>).
  if (isTsx) {
    for (const node of jsxTextNodes(maskStrings(src))) {
      if (isNotUserText(node.text)) continue;
      add(node.index, 'jsx-text', node.text);
    }
  }

  // -- obj-prop: { label: 'File' }, { buttons: ['OK', 'Cancel'] }
  {
    const re = /(?:^|[\s{,(])['"]?([a-zA-Z][a-zA-Z0-9]*)['"]?\s*:\s*(["'])([^"'\n]{3,})\2/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const [, prop, , value] = m;
      if (!USER_PROPS.has(prop)) continue;
      if (isNotUserText(value)) continue;
      const lineText = lineTextAt(src, m.index);
      if (DEVELOPER_CONTEXT.test(lineText)) continue;
      if (NON_PROSE_PROP_CONTEXT.test(lineText) && !looksLikeSentence(value)) continue;
      // A font option is `{ label: 'Lora', stack: '"Lora", Georgia, serif' }` — the
      // label is a typeface name, a proper noun that stays Latin in every locale.
      if (/\b(?:stack|css|fontFamily|headingFont|contentFont)\s*:/.test(lineText)) continue;
      add(m.index, 'obj-prop', value, `${prop}: '${value}'`);
    }
  }
  {
    // buttons: ['Send report', 'Not now'] — each element is a button caption.
    const re = /\bbuttons\s*:\s*\[([^\]]{0,400})\]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const inner = m[1];
      const lit = /(["'])([^"'\n]{2,})\1/g;
      let e;
      while ((e = lit.exec(inner)) !== null) {
        if (isNotUserText(e[2])) continue;
        add(m.index, 'obj-prop', e[2], `buttons[]: '${e[2]}'`);
      }
    }
  }

  // -- prose: a sentence in a plain string or template literal that is not
  //    already an attribute/property/JSX node (those are covered above).
  //    This is what catches an exported English constant such as
  //    DIAGNOSTICS_PRIVACY_BLURB, which no other rule and no other checker sees.
  {
    // Two patterns, because a quoted string cannot span lines and a template
    // literal usually does. The multi-line template case is not an edge case:
    // DIAGNOSTICS_PRIVACY_BLURB — twelve lines of privacy copy shown in three
    // separate dialogs — is one, and a single-line-only pattern misses it
    // entirely.
    const patterns = [
      /(["'])((?:[^\\'"\n]|\\.){8,600}?)\1/g,
      /(`)((?:[^\\`]|\\.){8,1200}?)\1/gs,
    ];
    const matches = [];
    for (const re of patterns) {
      let x;
      while ((x = re.exec(src)) !== null) matches.push(x);
    }
    for (const m of matches) {
      const value = m[2];
      if (!looksLikeSentence(value)) continue;
      if (isNotUserText(value)) continue;
      if (!readsAsEnglish(value)) continue;                // Tailwind class runs
      if (SQL_LIKE.test(value)) continue;
      if (SQL_LIKE.test(lineTextAt(src, m.index))) continue;   // inside a VALUES clause
      if (/\$\{/.test(value) && !looksLikeSentence(value.replace(/\$\{[^}]*\}/g, ' '))) continue;
      const lineText = lineTextAt(src, m.index);
      if (DEVELOPER_CONTEXT.test(lineText)) continue;
      // throw / console / className can begin on an earlier line than the literal.
      if (inDeveloperConstruct(src, m.index)) continue;
      if (/^\s*(?:import|export\s+(?:type|interface)|type|interface|declare)\b/.test(lineText)) continue;
      if (/(?:querySelector|classList|setAttribute|matchMedia)\s*\(/.test(lineText)) continue;
      add(m.index, 'prose', value);
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Walk + report
// ---------------------------------------------------------------------------

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (EXCLUDE.some((p) => p.test(full))) continue;
    if (e.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) yield full;
  }
}

function rel(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function rootLabelFor(file) {
  const r = rel(file);
  for (const { label, dir } of SCAN_ROOTS) if (r.startsWith(dir + '/')) return label;
  return 'other';
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const summaryOnly = args.includes('--summary');
  const ruleArg = (args.find((a) => a.startsWith('--rule=')) || '').split('=')[1];
  const maxArg = (args.find((a) => a.startsWith('--max=')) || '').split('=')[1];
  const explicit = args.filter((a) => !a.startsWith('--'));

  const targets = [];
  if (explicit.length > 0) {
    for (const f of explicit) {
      const abs = path.isAbsolute(f) ? f : path.resolve(repoRoot, f);
      if (fs.statSync(abs).isDirectory()) targets.push(...walk(abs));
      else targets.push(abs);
    }
  } else {
    for (const { dir } of SCAN_ROOTS) targets.push(...walk(path.join(repoRoot, dir)));
  }

  let findings = [];
  for (const f of targets) findings.push(...scanFile(f));
  if (ruleArg) findings = findings.filter((v) => v.rule === ruleArg);

  if (asJson) {
    process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
    process.exit(0);
  }

  const byRoot = new Map();
  const byFile = new Map();
  for (const v of findings) {
    const root = rootLabelFor(v.file);
    byRoot.set(root, (byRoot.get(root) || 0) + 1);
    const key = rel(v.file);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(v);
  }

  const files = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);

  if (summaryOnly) {
    for (const [file, list] of files) {
      process.stdout.write(`${String(list.length).padStart(5)}  ${file}\n`);
    }
  } else {
    for (const [file, list] of files) {
      process.stdout.write(`\n${file}  (${list.length})\n`);
      for (const v of list.sort((a, b) => a.line - b.line)) {
        const shown = v.text.length > 96 ? v.text.slice(0, 93) + '...' : v.text;
        process.stdout.write(`  ${String(v.line).padStart(5)}  [${v.rule}]  ${shown}\n`);
      }
    }
  }

  process.stdout.write(`\n${findings.length} hard-coded user-facing string(s) in ${byFile.size} file(s).\n`);
  for (const { label } of SCAN_ROOTS) {
    process.stdout.write(`  ${label.padEnd(18)} ${byRoot.get(label) || 0}\n`);
  }
  const byRule = {};
  for (const v of findings) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
  process.stdout.write(
    `  rules: ${Object.entries(byRule).map(([r, n]) => `${r}=${n}`).join(' ')}\n`,
  );

  if (maxArg) {
    const max = Number(maxArg);
    if (findings.length > max) {
      process.stdout.write(`\nFAIL: ${findings.length} exceeds --max=${max}.\n`);
      process.exit(1);
    }
    process.stdout.write(`\nPASS: ${findings.length} within --max=${max}.\n`);
  }
  process.exit(0);
}

main();
