#!/usr/bin/env node
/**
 * check-logical-css.js
 *
 * Guard for task 0076 (right-to-left UI): flags physical (left/right) CSS in
 * code that must be written with logical properties, so a mirrored UI does not
 * silently regress.
 *
 * Scans, relative to the repo root:
 *   (a) CSS / SCSS in apps/web/src/**, apps/desktop/src/ui/**, packages/ui/css/**
 *       margin-left/right, padding-left/right, border-left/right(-*),
 *       border-(top|bottom)-(left|right)-radius, `left:` / `right:` properties,
 *       text-align: left|right, float: left|right, clear: left|right.
 *   (b) .tsx in apps/desktop/src/ui/** : physical Tailwind classes inside
 *       string / template literals (ml- mr- pl- pr- left- right- -left-
 *       border-l border-r rounded-l rounded-r rounded-tl/tr/bl/br text-left
 *       text-right float-left/right, and space-x- without
 *       `rtl:space-x-reverse` in the same string). Tokens under an `rtl:` or
 *       `ltr:` variant are intentional and ignored.
 *   (c) .tsx in apps/web/src/** and apps/desktop/src/ui/** : physical inline
 *       style keys (left, right, marginLeft/Right, paddingLeft/Right,
 *       borderLeft*, borderRight*, border(Top|Bottom)(Left|Right)Radius,
 *       textAlign: 'left'|'right', float / clear: 'left'|'right').
 *
 * Skipped: node_modules, dist/build output, generated files (`generated/`,
 * `.generated.`, `.d.ts`), tests and test helpers (`*.test.*`, `*.spec.*`,
 * `__tests__/`, `testing/`).
 *
 * A finding is allowed when its line, or the line above it, contains
 * `rtl-physical:` (followed by the reason the physical value must stay).
 *
 * Output: `file:line: <rule>: <snippet>` per finding and a summary count.
 * Exit 1 when there are findings, unless `--report` is given.
 *
 * Usage:
 *   node scripts/check-logical-css.js [--report] [--json]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const SCAN_ROOTS = {
  css: ['apps/web/src', 'apps/desktop/src/ui', 'packages/ui/css'],
  tailwind: ['apps/desktop/src/ui'],
  inlineStyle: ['apps/web/src', 'apps/desktop/src/ui'],
};

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'generated', '__tests__', 'testing', '.git']);
const ALLOW_MARK = 'rtl-physical:';

function isSkippedFile(name) {
  return (
    /\.(test|spec)\.[a-z]+$/.test(name) ||
    /\.generated\.[a-z]+$/.test(name) ||
    name.endsWith('.d.ts')
  );
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name));
    } else if (e.isFile() && !isSkippedFile(e.name)) {
      yield path.join(dir, e.name);
    }
  }
}

// ---------------------------------------------------------------------------
// (a) CSS / SCSS
// ---------------------------------------------------------------------------

const P = '(?<![\\w$@-])'; // not part of a longer identifier / variable name
const CSS_RULES = [
  ['margin-physical', new RegExp(`${P}margin-(?:left|right)\\s*:`)],
  ['padding-physical', new RegExp(`${P}padding-(?:left|right)\\s*:`)],
  ['border-physical', new RegExp(`${P}border-(?:left|right)(?:-[a-z]+)*\\s*:`)],
  ['border-radius-physical', new RegExp(`${P}border-(?:top|bottom)-(?:left|right)-radius\\s*:`)],
  ['inset-physical', new RegExp(`(?:^|[;{(\\s])(?:left|right)\\s*:(?!:)`)],
  ['text-align-physical', new RegExp(`${P}text-align\\s*:\\s*(?:left|right)\\b`)],
  ['float-physical', new RegExp(`${P}float\\s*:\\s*(?:left|right)\\b`)],
  ['clear-physical', new RegExp(`${P}clear\\s*:\\s*(?:left|right)\\b`)],
];

/** Blank out comments (keeping line structure) so they cannot match. */
function stripCssComments(text, scss) {
  let out = '';
  let i = 0;
  let inStr = null;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === inStr || ch === '\n') inStr = null;
      i++;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      i++;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (scss && ch === '/' && next === '/' && text[i - 1] !== ':') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function scanCss(text, file) {
  const lines = text.split('\n');
  const clean = stripCssComments(text, /\.scss$/.test(file)).split('\n');
  const found = [];
  clean.forEach((line, idx) => {
    for (const [rule, re] of CSS_RULES) {
      if (re.test(line)) {
        found.push({ line: idx + 1, rule, snippet: lines[idx].trim() });
        break;
      }
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Minimal JS/TSX lexer: yields string / template segments with their line.
// Comments are skipped. JSX text apostrophes can open a bogus single-line
// string; quoted strings end at the line break, so the damage stays local.
// ---------------------------------------------------------------------------

function* stringSegments(text) {
  let i = 0;
  let line = 1;
  const stack = []; // 'tpl' | 'code' entries for template literals with ${}
  let braceDepth = []; // brace depth per open ${ }
  let cur = null; // { quote, text, line }

  const pushSeg = () => {
    const seg = cur;
    cur = null;
    return seg;
  };

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    const inTpl = stack.length > 0 && stack[stack.length - 1] === 'tpl';

    if (cur && cur.quote !== '`') {
      // inside '...' or "..."
      if (ch === '\\') {
        cur.text += ch + (next ?? '');
        i += 2;
        continue;
      }
      if (ch === cur.quote) {
        yield pushSeg();
        i++;
        continue;
      }
      if (ch === '\n') {
        pushSeg(); // unterminated: drop
        line++;
        i++;
        continue;
      }
      cur.text += ch;
      i++;
      continue;
    }

    if (inTpl) {
      // inside a template literal's text part
      if (ch === '\\') {
        cur.text += ch + (next ?? '');
        i += 2;
        continue;
      }
      if (ch === '`') {
        stack.pop();
        yield pushSeg();
        i++;
        continue;
      }
      if (ch === '$' && next === '{') {
        yield pushSeg();
        stack.push('code');
        braceDepth.push(0);
        i += 2;
        continue;
      }
      if (ch === '\n') line++;
      cur.text += ch;
      i++;
      continue;
    }

    // code context
    if (ch === '\n') {
      line++;
      i++;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
      i = stop;
    } else if (ch === '"' || ch === "'") {
      cur = { quote: ch, text: '', line };
      i++;
    } else if (ch === '`') {
      stack.push('tpl');
      cur = { quote: '`', text: '', line };
      i++;
    } else if (stack.length && ch === '{') {
      braceDepth[braceDepth.length - 1]++;
      i++;
    } else if (stack.length && ch === '}') {
      if (braceDepth[braceDepth.length - 1] === 0) {
        braceDepth.pop();
        stack.pop(); // back to the template text
        cur = { quote: '`', text: '', line };
      } else {
        braceDepth[braceDepth.length - 1]--;
      }
      i++;
    } else {
      i++;
    }
  }
}

// ---------------------------------------------------------------------------
// (b) physical Tailwind classes
// ---------------------------------------------------------------------------

const TW_CLASSLIKE = /^[!\w:/.[\]%#()&>*=,'+-]+$/;
const TW_RULES = [
  ['tailwind-margin-padding', /^!?-?(?:m|p)[lr]-(?:\d|\[|px\b|auto\b|\()/],
  ['tailwind-inset', /^!?-?(?:left|right)-(?:\d|\[|px\b|full\b|auto\b|\(|1\/|2\/|3\/)/],
  ['tailwind-border', /^!?border-[lr](?:-.+)?$/],
  ['tailwind-rounded', /^!?rounded-(?:l|r|tl|tr|bl|br)(?:-.+)?$/],
  ['tailwind-text-align', /^!?text-(?:left|right)$/],
  ['tailwind-float', /^!?(?:float|clear)-(?:left|right)$/],
  ['tailwind-space-x', /^!?-?space-x-/],
];

function stripVariants(token) {
  // `hover:md:ml-2` -> `ml-2`; keeps `[&>*]:ml-2` handling simple.
  let t = token;
  for (;;) {
    const m = /^(?:\[[^\]]*\]|[^\s:[\]]+):(?=.)/.exec(t);
    if (!m) return { base: t, variants: token.slice(0, token.length - t.length) };
    t = t.slice(m[0].length);
  }
}

function scanTailwindString(str) {
  const tokens = str.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || !tokens.every((t) => TW_CLASSLIKE.test(t) && !/[.,]$/.test(t))) return [];
  const hasReverse = tokens.some((t) => /(?:^|:)rtl:space-x-reverse$/.test(t) || t === 'rtl:space-x-reverse');
  const hits = [];
  for (const token of tokens) {
    const { base, variants } = stripVariants(token);
    if (/(?:^|:)(?:rtl|ltr):/.test(variants)) continue;
    for (const [rule, re] of TW_RULES) {
      if (!re.test(base)) continue;
      if (rule === 'tailwind-space-x' && hasReverse) break;
      hits.push({ rule, token });
      break;
    }
  }
  return hits;
}

function scanTailwind(text) {
  const lines = text.split('\n');
  const found = [];
  for (const seg of stringSegments(text)) {
    if (!seg.text) continue;
    for (const hit of scanTailwindString(seg.text)) {
      // A template/multi-line string: pin the finding to the line of the token.
      const rel = seg.text.indexOf(hit.token);
      const line = seg.line + (rel > 0 ? (seg.text.slice(0, rel).match(/\n/g) || []).length : 0);
      found.push({ line, rule: hit.rule, snippet: (lines[line - 1] || '').trim() });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// (c) physical inline-style keys
// ---------------------------------------------------------------------------

const TYPE_WORDS = '(?:number|string|boolean|undefined|null|unknown|any|never|void|React\\.|CSS|Rect|DOMRect|Property|Length|Pick|Partial)';
const STYLE_KEY_RULES = [
  ['style-inset', new RegExp(`(?:^|[{,(]|\\s)(?:left|right)\\s*:(?!\\s*${TYPE_WORDS})(?!:)`)],
  ['style-margin-padding', /(?:^|[{,(\s])(?:margin|padding)(?:Left|Right)\s*:/],
  ['style-border', /(?:^|[{,(\s])border(?:Left|Right)\w*\s*:/],
  ['style-border-radius', /(?:^|[{,(\s])border(?:Top|Bottom)(?:Left|Right)Radius\s*:/],
  ['style-text-align', /(?:^|[{,(\s])(?:textAlign|float|clear)\s*:\s*['"`](?:left|right)['"`]/],
];

function stripJsComments(text) {
  // Blank comments; keep strings intact (reuse the CSS stripper's string rule).
  let out = '';
  let i = 0;
  let inStr = null;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === inStr || (ch === '\n' && inStr !== '`')) inStr = null;
      i++;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      out += ch;
      i++;
    } else if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function scanInlineStyle(text) {
  const lines = text.split('\n');
  const clean = stripJsComments(text).split('\n');
  const found = [];
  clean.forEach((line, idx) => {
    // Type annotations / interface members: `left: number;` handled by the
    // type-word lookahead; skip import/export type lines outright.
    if (/^\s*(?:import|export\s+type)\b/.test(line)) return;
    for (const [rule, re] of STYLE_KEY_RULES) {
      if (re.test(line)) {
        found.push({ line: idx + 1, rule, snippet: lines[idx].trim() });
        break;
      }
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function isAllowed(lines, line) {
  return (lines[line - 1] || '').includes(ALLOW_MARK) || (lines[line - 2] || '').includes(ALLOW_MARK);
}

/**
 * Scans `root` (default: the repo) and returns `[{ file, line, rule, snippet }]`
 * with `file` relative to `root`. `roots` overrides SCAN_ROOTS (for tests).
 */
function scan(root = REPO_ROOT, roots = SCAN_ROOTS) {
  const results = [];
  const seen = new Set();

  function visit(kind, exts, scanner) {
    for (const rel of roots[kind]) {
      for (const abs of walk(path.join(root, rel))) {
        if (!exts.some((e) => abs.endsWith(e))) continue;
        const key = `${kind}:${abs}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const text = fs.readFileSync(abs, 'utf8');
        const lines = text.split('\n');
        for (const f of scanner(text, abs)) {
          if (isAllowed(lines, f.line)) continue;
          results.push({ file: path.relative(root, abs).split(path.sep).join('/'), ...f });
        }
      }
    }
  }

  visit('css', ['.css', '.scss'], scanCss);
  visit('tailwind', ['.tsx'], (t) => scanTailwind(t));
  visit('inlineStyle', ['.tsx'], (t) => scanInlineStyle(t));

  // De-duplicate (a line can be caught by two scanners) and order.
  const uniq = new Map();
  for (const r of results) uniq.set(`${r.file}:${r.line}:${r.rule}`, r);
  return [...uniq.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function main(argv) {
  const report = argv.includes('--report');
  const json = argv.includes('--json');
  const results = scan();
  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    for (const r of results) {
      const snippet = r.snippet.length > 120 ? `${r.snippet.slice(0, 117)}...` : r.snippet;
      process.stdout.write(`${r.file}:${r.line}: ${r.rule}: ${snippet}\n`);
    }
    const files = new Set(results.map((r) => r.file));
    process.stdout.write(
      `\ncheck-logical-css: ${results.length} physical-direction finding(s) in ${files.size} file(s)` +
        (results.length ? `. Use logical properties, or add "${ALLOW_MARK} <reason>" on the line or the line above.\n` : '.\n'),
    );
  }
  if (results.length > 0 && !report) process.exit(1);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { scan, scanCss, scanTailwind, scanInlineStyle, scanTailwindString, stringSegments };
