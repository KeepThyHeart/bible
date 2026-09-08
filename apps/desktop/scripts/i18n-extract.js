#!/usr/bin/env node
/**
 * i18n-extract.js
 *
 * Heuristic linter that flags likely-user-facing English strings in
 * `apps/desktop/src/ui/` and `apps/desktop/electron/`. The goal is
 * the spec-B acceptance criterion: zero hard-coded user-facing English
 * strings remain in the desktop package - every such string must flow
 * through `i18nService.t()` (or `useI18n().t()` in React).
 *
 * What we flag (best-effort heuristics, biased toward false positives):
 *
 *   - JSX text nodes:        `<button>Hello</button>`
 *   - JSX attribute strings on a small whitelist of attribute names:
 *       title, placeholder, aria-label, aria-description, alt,
 *       label, tooltip, name, header
 *   - Calls to functions whose name suggests user-visible output:
 *       alert(...), confirm(...), prompt(...),
 *       dialog.showMessageBox(...), Notification(...),
 *       toast(...), notify(...), showError(...), showInfo(...)
 *
 * What we deliberately ignore:
 *
 *   - console.* / log.* calls (developer-facing only)
 *   - data-* attributes, className, id, key, ref
 *   - URLs (anything starting with http:// or https:// or mailto:)
 *   - File paths (anything matching /^\.{0,2}\// or /^[a-z]:\\/i)
 *   - CSS-like strings (color codes, px/rem units, var(--*))
 *   - Strings already wrapped in t(...) or i18n.t(...) or i18nService.t(...)
 *   - Strings inside type/interface declarations
 *   - Empty or whitespace-only strings
 *   - Strings shorter than 2 characters
 *   - Strings that look like keys themselves (foo.bar.baz, no spaces)
 *
 * Usage:
 *   node scripts/i18n-extract.js          # scan all
 *   node scripts/i18n-extract.js --json   # JSON output
 *   node scripts/i18n-extract.js path/to/file.tsx  # one file
 *
 * Exit code: 0 if zero violations, 1 otherwise. Suitable for pre-commit
 * hooks and the CI gate that the spec acceptance criterion implies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [
  path.join(ROOT, 'src', 'ui'),
  path.join(ROOT, 'electron'),
];
const EXCLUDE_PATTERNS = [
  /\.test\.(ts|tsx|js)$/,
  /\.d\.ts$/,
  /node_modules/,
  /[\\/]dist[\\/]/,
  /[\\/]out[\\/]/,
];

const ATTR_WHITELIST = new Set([
  'title', 'placeholder', 'alt', 'label', 'tooltip',
  'aria-label', 'ariaLabel', 'aria-description', 'ariaDescription',
  'header', 'heading', 'message', 'description', 'caption',
]);

const USER_FACING_FNS = [
  /\balert\s*\(/,
  /\bconfirm\s*\(/,
  /\bprompt\s*\(/,
  /\bdialog\.showMessageBox\s*\(/,
  /\bdialog\.showErrorBox\s*\(/,
  /\bnew\s+Notification\s*\(/,
  /\btoast\s*\(/,
  /\bnotify\s*\(/,
  /\bshowError\s*\(/,
  /\bshowInfo\s*\(/,
  /\bshowWarning\s*\(/,
];

const T_CALL = /\b(?:i18n(?:Service)?\.)?t\s*\(\s*['"`]/; // already-localized via t('...')

// TypeScript built-in / utility / lib types that frequently appear inside
// generic syntax. The JSX-text rule strips arrow functions via lookbehind,
// but `: Promise<X>` and similar still survive because there's no `=`. We
// skip these literal type-name captures.
const TS_TYPE_WORDS = new Set([
  'Promise', 'Array', 'ReadonlyArray', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude',
  'Extract', 'NonNullable', 'ReturnType', 'Parameters', 'InstanceType',
  'Awaited', 'string', 'number', 'boolean', 'any', 'unknown', 'void', 'never',
  'object', 'symbol', 'bigint', 'null', 'undefined', 'true', 'false',
]);

function shouldExclude(filePath) {
  return EXCLUDE_PATTERNS.some((p) => p.test(filePath));
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (shouldExclude(full)) continue;
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
      yield full;
    }
  }
}

/**
 * Per-line scanner. Not a real parser - that would be hundreds of LOC and
 * brittle. Instead we use focused regexes against each line and rely on
 * the false-positive rate being acceptable for a migration linter.
 *
 * The rules below are intentionally conservative: we'd rather flag a
 * literal that's actually a debug message than miss a real user-facing
 * string. The migration sweep will manually triage any false positives
 * that survive the exclusions list.
 */
function scanFile(filePath) {
  let src;
  try {
    src = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const violations = [];
  const lines = src.split('\n');
  // JSX text nodes can only legitimately appear in .tsx/.jsx files. In plain
  // .ts/.js files, the `>...<` pattern is virtually always TypeScript generic
  // syntax (e.g. `Promise<Foo>`), which is not user-facing.
  const allowJsxText = /\.(tsx|jsx)$/.test(filePath);

  // Track simple multi-line state: are we inside a comment block?
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Strip block comments crudely.
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const blockStart = line.indexOf('/*');
    if (blockStart !== -1) {
      const blockEnd = line.indexOf('*/', blockStart + 2);
      if (blockEnd === -1) {
        line = line.slice(0, blockStart);
        inBlockComment = true;
      } else {
        line = line.slice(0, blockStart) + line.slice(blockEnd + 2);
      }
    }

    // Strip single-line comments.
    const lineCommentIdx = line.indexOf('//');
    if (lineCommentIdx !== -1) {
      // Make sure it's not inside a string. Cheap heuristic: if there are
      // an even number of unescaped quotes before the //, we're outside.
      const before = line.slice(0, lineCommentIdx);
      const sq = (before.match(/(?<!\\)'/g) || []).length;
      const dq = (before.match(/(?<!\\)"/g) || []).length;
      const bt = (before.match(/(?<!\\)`/g) || []).length;
      if (sq % 2 === 0 && dq % 2 === 0 && bt % 2 === 0) {
        line = before;
      }
    }

    // Skip console / log / debug lines entirely.
    if (/\b(?:console|log|logger)\.[a-z]+\s*\(/.test(line)) continue;
    // Skip lines that already pass through t(...).
    if (T_CALL.test(line)) continue;
    // Skip lines that import / require / type-only declarations.
    if (/^\s*(?:import|export|type|interface|declare)\b/.test(line)) continue;

    // 1. JSX attributes from the whitelist with literal strings.
    //    e.g.  <Button title="Save" />
    {
      const re = /\b([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(['"])([^'"]+?)\2/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const [, attr, , value] = m;
        if (!ATTR_WHITELIST.has(attr)) continue;
        if (isLikelyNonString(value)) continue;
        violations.push({
          file: filePath,
          line: i + 1,
          col: m.index + 1,
          rule: 'jsx-attr',
          text: value,
          context: attr,
        });
      }
    }

    // 2. JSX text nodes - literal strings between > and <.
    //    Cheap pattern: >Some Text< on one line. Multi-line text nodes
    //    are deferred to manual review. Only .tsx/.jsx files are scanned
    //    since plain .ts files can't host JSX.
    if (allowJsxText) {
      // Negative lookbehind: skip arrow functions (`=>`) so we don't match
      // `): Promise<unknown>` etc.
      const re = /(?<!=)>([^<>{}\n]{2,})</g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const text = m[1].trim();
        if (!text) continue;
        if (isLikelyNonString(text)) continue;
        // Skip TypeScript built-in/utility types (these appear inside generic
        // syntax that survives the lookbehind in some contexts).
        if (TS_TYPE_WORDS.has(text)) continue;
        // Skip pure-symbol/punctuation runs ("->", "-", etc.) - usually icons.
        if (!/[a-zA-Z]/.test(text)) continue;
        // Skip JSX expressions disguised as text (rare but happens).
        if (text.startsWith('{') || text.endsWith('}')) continue;
        violations.push({
          file: filePath,
          line: i + 1,
          col: m.index + 1,
          rule: 'jsx-text',
          text,
          context: 'jsx-text-node',
        });
      }
    }

    // 3. Calls to user-facing functions with a literal string argument.
    for (const re of USER_FACING_FNS) {
      const m = re.exec(line);
      if (!m) continue;
      const after = line.slice(m.index + m[0].length);
      const argMatch = after.match(/^\s*(['"`])([^'"`]+?)\1/);
      if (!argMatch) continue;
      const text = argMatch[2];
      if (isLikelyNonString(text)) continue;
      violations.push({
        file: filePath,
        line: i + 1,
        col: m.index + 1,
        rule: 'user-facing-call',
        text,
        context: m[0].replace(/\s*\($/, ''),
      });
    }
  }

  return violations;
}

/**
 * Returns true if the string is almost certainly NOT a user-facing message:
 * URLs, paths, CSS values, dotted-key names, single chars, etc.
 */
function isLikelyNonString(s) {
  if (s.length < 2) return true;
  if (/^https?:\/\//.test(s)) return true;
  if (/^mailto:/.test(s)) return true;
  if (/^[\.\/\\]/.test(s)) return true;          // path-like
  if (/^[a-z]:\\/i.test(s)) return true;          // windows path
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return true; // color
  if (/^\d+(\.\d+)?(px|rem|em|%|vh|vw|pt)$/.test(s)) return true; // CSS unit
  if (/^var\(--/.test(s)) return true;            // css var
  if (/^[a-z][a-z0-9.]*$/.test(s) && s.includes('.')) return true; // foo.bar.baz key
  if (/^[A-Z_][A-Z0-9_]*$/.test(s)) return true;  // CONSTANT_LIKE
  if (/^[a-z][a-zA-Z0-9]*$/.test(s) && s.length < 6) return true; // camelCase short
  if (/^[\s\W]+$/.test(s)) return true;           // pure punctuation/whitespace
  return false;
}

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const fileArgs = args.filter((a) => !a.startsWith('--'));

  const targets = [];
  if (fileArgs.length > 0) {
    for (const f of fileArgs) {
      const abs = path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
      if (fs.existsSync(abs)) targets.push(abs);
    }
  } else {
    for (const dir of SCAN_DIRS) {
      for (const f of walk(dir)) targets.push(f);
    }
  }

  const all = [];
  for (const f of targets) {
    all.push(...scanFile(f));
  }

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(all, null, 2) + '\n');
  } else if (all.length === 0) {
    process.stdout.write('i18n-extract: no violations.\n');
  } else {
    process.stdout.write(`i18n-extract: ${all.length} violation(s)\n\n`);
    for (const v of all) {
      const rel = path.relative(ROOT, v.file);
      process.stdout.write(
        `  ${rel}:${v.line}:${v.col}  [${v.rule}]  ${JSON.stringify(v.text)}` +
          (v.context ? `  (${v.context})` : '') +
          '\n',
      );
    }
    process.stdout.write('\n');
  }

  process.exit(all.length === 0 ? 0 : 1);
}

main();
