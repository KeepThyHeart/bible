#!/usr/bin/env node
/**
 * Validates that every repository path referenced by the per-package developer
 * docs still exists.
 *
 * The feature docs under packages/<pkg>/docs/ and apps/<app>/docs/ are file maps first and prose
 * second: their value is telling a developer (or Claude) exactly which files
 * implement a feature, so that nobody has to grep the tree to get oriented. A
 * path that no longer resolves is the failure mode that silently destroys that
 * value, and it is the one kind of rot a machine can catch, so catch it here.
 *
 * Usage:
 *   node scripts/check-doc-paths.js            # report and exit non-zero on failure
 *   node scripts/check-doc-paths.js --quiet    # only print failures
 *
 * What counts as a path reference:
 *   - Markdown links whose target is not a URL or a bare anchor: [text](../foo.ts)
 *   - Inline code spans that look like repo paths: `src/ui/App.tsx`
 *
 * Inline code spans are the noisier of the two, so a span only counts when it
 * has a slash or a known source extension, and shell/SQL/prose lookalikes are
 * filtered out below. False negatives are preferable to false positives: a
 * checker that cries wolf gets disabled.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const quiet = process.argv.includes('--quiet');

/** Docs roots to scan. Add new packages here as they grow docs. */
const DOC_ROOTS = [
  'packages/core/docs',
  'apps/desktop/docs',
  'apps/web/docs',
];

/** A code span must end in one of these to be treated as a file reference. */
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|sql|yml|yaml|html)$/;

/**
 * Code spans that look path-ish but are not paths. Globs and directory-ish
 * references are legitimate documentation and cannot be resolved literally.
 */
function isNotAPathReference(spec) {
  return (
    spec.includes('*') ||            // globs: src/**/*.test.ts
    spec.includes(' ') ||            // shell commands, prose
    spec.includes('://') ||          // URLs
    spec.startsWith('@') ||          // package specifiers: @bible/core
    spec.startsWith('#') ||          // anchors
    spec.includes('{') ||            // template strings and placeholders
    spec.includes('<') ||            // placeholders: data/modules/<name>.db
    /^[A-Z]:/.test(spec) ||          // absolute Windows paths in examples
    spec.startsWith('/') ||          // HTTP routes: /api/config
    spec.endsWith('/')               // directory shorthand, checked separately
  );
}

function collectMarkdownFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMarkdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Strips fenced code blocks so that shell examples do not generate noise. */
function stripFencedBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '));
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Resolves a documented path. Doc references come in two flavors: relative to
 * the doc itself (markdown links, `../src/foo.ts`) and relative to the repo
 * root (code spans, `apps/web/src/foo.ts`). Accept either, because both
 * are used throughout the existing docs and both are unambiguous in practice.
 */
function resolves(spec, docFile) {
  const cleaned = spec.split('#')[0].trim();
  if (!cleaned) return true;
  const candidates = [
    path.resolve(path.dirname(docFile), cleaned),
    path.resolve(repoRoot, cleaned),
  ];
  // Most feature docs write paths relative to their own package root, e.g.
  // `src/ui/App.tsx` inside apps/desktop/docs. Resolve that too.
  const pkgRoot = packageRootFor(docFile);
  if (pkgRoot) candidates.push(path.resolve(pkgRoot, cleaned));
  return candidates.some((candidate) => fs.existsSync(candidate));
}

/** packages/<pkg>/docs/... or apps/<app>/docs/... -> that package's absolute root. */
function packageRootFor(docFile) {
  const rel = path.relative(repoRoot, docFile).split(path.sep).join('/');
  const match = rel.match(/^((?:packages|apps)\/[^/]+)\//);
  return match ? path.resolve(repoRoot, match[1]) : null;
}

/**
 * Index of every source basename in a package, so that a reference which does
 * not resolve literally can still be classified. Docs routinely write a path
 * relative to the section they sit under (`services/AppInitService.ts` under a
 * "src/ui" heading), which is untidy but not wrong. That is a different problem
 * from a file that has been renamed or deleted, and only the latter misleads a
 * reader, so the two are reported separately.
 */
const basenameIndexCache = new Map();

function basenameIndex(pkgRoot) {
  if (basenameIndexCache.has(pkgRoot)) return basenameIndexCache.get(pkgRoot);
  const index = new Map();
  const skip = new Set(['node_modules', 'dist', 'out', 'build', '.git', 'release']);
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(path.join(dir, entry.name));
      } else {
        const rel = path.relative(pkgRoot, path.join(dir, entry.name)).split(path.sep).join('/');
        if (!index.has(entry.name)) index.set(entry.name, []);
        index.get(entry.name).push(rel);
      }
    }
  };
  walk(pkgRoot);
  basenameIndexCache.set(pkgRoot, index);
  return index;
}

/**
 * Classifies an unresolved reference as 'missing' (no file by that name exists
 * anywhere in the package -- the doc is wrong) or 'relative' (the file exists
 * elsewhere, so the reference is merely written against an implied directory).
 */
function classify(spec, docFile) {
  const pkgRoot = packageRootFor(docFile);
  if (!pkgRoot) return { kind: 'missing' };
  const base = spec.split('#')[0].trim().split('/').pop();
  const hits = basenameIndex(pkgRoot).get(base);
  if (!hits || hits.length === 0) {
    // Cross-package references (`../../core/src/...`) live in a sibling package.
    const coreHits = basenameIndex(path.resolve(repoRoot, 'packages/core')).get(base);
    if (coreHits && coreHits.length > 0) return { kind: 'relative', actual: `core: ${coreHits[0]}` };
    return { kind: 'missing' };
  }
  return { kind: 'relative', actual: hits[0] };
}

function checkFile(docFile) {
  const raw = fs.readFileSync(docFile, 'utf8');
  const text = stripFencedBlocks(raw);
  const problems = [];

  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    const target = match[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    if (!resolves(target, docFile)) {
      problems.push({ line: lineNumberAt(text, match.index), spec: target, ...classify(target, docFile) });
    }
  }

  const codePattern = /`([^`\n]+)`/g;
  while ((match = codePattern.exec(text)) !== null) {
    const spec = match[1].trim();
    if (isNotAPathReference(spec)) continue;
    // Require both a slash and a source extension. A slash-free name
    // (`App.tsx`) is prose, and an extension-free slashed token is almost
    // always an HTTP route or a topic path, not a file.
    if (!spec.includes('/') || !SOURCE_EXTENSIONS.test(spec)) continue;
    if (!resolves(spec, docFile)) {
      problems.push({ line: lineNumberAt(text, match.index), spec, ...classify(spec, docFile) });
    }
  }

  return problems;
}

let totalDocs = 0;
let missingCount = 0;
let relativeCount = 0;

for (const root of DOC_ROOTS) {
  const docs = collectMarkdownFiles(path.join(repoRoot, root));
  for (const docFile of docs) {
    totalDocs++;
    const problems = checkFile(docFile);
    if (problems.length === 0) continue;
    const rel = path.relative(repoRoot, docFile).split(path.sep).join('/');
    const missing = problems.filter((p) => p.kind === 'missing');
    const relative = problems.filter((p) => p.kind === 'relative');
    missingCount += missing.length;
    relativeCount += relative.length;
    if (missing.length > 0) {
      console.log(`\n${rel}`);
      for (const problem of missing) {
        console.log(`  MISSING  line ${problem.line}: ${problem.spec}`);
      }
    }
    if (!quiet && relative.length > 0) {
      if (missing.length === 0) console.log(`\n${rel}`);
      for (const problem of relative) {
        console.log(`  relative line ${problem.line}: ${problem.spec}  -> ${problem.actual}`);
      }
    }
  }
}

console.log(
  `\nChecked ${totalDocs} docs: ${missingCount} missing, ` +
    `${relativeCount} written relative to an implied directory.`
);
process.exit(missingCount === 0 ? 0 : 1);
