#!/usr/bin/env node
/**
 * Test for `check-logical-css.js`, using fixtures written to a temp dir.
 *
 * Usage:  node scripts/check-logical-css.test.js
 */

'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'check-logical-css.js');
const { scan, scanTailwindString } = require('./check-logical-css.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logical-css-'));
function write(rel, content) {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const ROOTS = {
  css: ['web', 'desktop', 'ui-css'],
  tailwind: ['desktop'],
  inlineStyle: ['web', 'desktop'],
};

try {
  // ----- (a) CSS / SCSS -----
  write(
    'web/bad.css',
    [
      '.a { margin-left: 4px; }', // 1
      '.b { padding-right: 2px; border-left: 1px solid red; }', // 2
      '.c { border-top-left-radius: 3px; }', // 3
      '.d { position: absolute; left: 0; }', // 4
      '.e { text-align: right; float: left; clear: right; }', // 5
      '.f { margin-inline-start: 4px; inset-inline-end: 0; text-align: start; }', // fine
      '/* margin-left: 1px; */', // comment
      '.g { background-position: left center; transform-origin: left; }', // fine
      '.h { --margin-left: 1px; scroll-margin-left-x: 2px; }', // custom prop fine
      '.i { /* rtl-physical: measured overlay */ left: 10px; }', // allowed
      '/* rtl-physical: anchored to the scrollbar */',
      '.j { right: 0; }', // allowed (line above)
    ].join('\n'),
  );
  write(
    'desktop/styles.scss',
    ['// margin-left: 4px;', '.k { &:hover { margin-right: 1px; } }', '.l { url: "//left: 1"; }'].join('\n'),
  );
  write('ui-css/rtl.css', '.m { padding-left: 1px }\n');
  write('web/App.test.css', '.n { margin-left: 1px; }\n');
  write('web/generated/gen.css', '.o { margin-left: 1px; }\n');
  write('web/node_modules/pkg/x.css', '.p { margin-left: 1px; }\n');

  // ----- (b) Tailwind + (c) inline style -----
  write(
    'desktop/Comp.tsx',
    [
      "export const A = () => <div className=\"flex ml-2 text-left\">x</div>;", // 1: 2 findings, 1 line
      'export const B = () => <div className={clsx("px-2", cond && \'pr-4\')} />;', // 2
      'export const C = () => (',
      '  <div className={`flex ${open ? "left-0" : "-left-2"} border-l`} />', // 4: 3 hits same line
      ');',
      'export const D = () => <div className="space-x-2 rtl:space-x-reverse" />;', // fine
      'export const E = () => <div className="space-x-2" />;', // 7
      'export const F = () => <div className="ms-2 me-2 ps-1 pe-1 text-start border-s rounded-s start-0" />;', // fine
      'export const G = () => <div className="rtl:ml-2 ltr:mr-2 hover:rtl:pl-1" />;', // fine
      "export const H = () => <p>Don't use the right-click menu</p>;", // fine
      "const msg = 'Click the left-hand button';", // fine
      "// className=\"ml-2\"", // comment
      'export const I = () => <div className="rounded-tl-lg rounded-br" />;', // 12
      'export const J = () => (',
      '  <div className={cn(',
      '    "flex",',
      '    "pl-3",', // 16
      '  )} />',
      ');',
      '// rtl-physical: viewport-measured popup',
      'export const K = () => <div className="left-0" />;', // allowed
    ].join('\n'),
  );
  write(
    'web/Style.tsx',
    [
      'export const A = () => <div style={{ left: 5, top: 1 }} />;', // 1
      'export const B = () => <div style={{ marginLeft: 4, paddingRight: "1px" }} />;', // 2
      'export const C = () => <div style={{ borderLeft: "1px solid", borderTopRightRadius: 2 }} />;', // 3
      "export const D = () => <div style={{ textAlign: 'right' }} />;", // 4
      "export const E = () => <div style={{ textAlign: 'center', marginInlineStart: 4, insetInlineStart: 0 }} />;", // fine
      'interface Rect { left: number; right: number }', // fine (type)
      '// style={{ left: 1 }}', // comment
      'const r = { left: x.left, right: x.right }; // rtl-physical: DOMRect copy', // allowed
    ].join('\n'),
  );
  write('web/Skip.test.tsx', 'export const T = () => <div style={{ left: 1 }} className="ml-2" />;\n');

  const results = scan(tmp, ROOTS);
  const at = (file) => results.filter((r) => r.file === file);
  const lines = (file, rule) =>
    at(file)
      .filter((r) => !rule || r.rule === rule)
      .map((r) => r.line);

  // CSS
  assert.deepEqual(lines('web/bad.css'), [1, 2, 3, 4, 5], 'css physical lines');
  assert.deepEqual(
    at('web/bad.css').map((r) => r.rule),
    ['margin-physical', 'padding-physical', 'border-radius-physical', 'inset-physical', 'text-align-physical'],
  );
  assert.deepEqual(lines('desktop/styles.scss'), [2], 'scss: // comments skipped, nested rule found');
  assert.deepEqual(lines('ui-css/rtl.css'), [1]);
  assert.equal(results.some((r) => r.file.includes('.test.') || r.file.includes('generated') || r.file.includes('node_modules')), false);

  // Tailwind (tsx)
  const tw = at('desktop/Comp.tsx');
  assert.deepEqual([...new Set(tw.map((r) => r.line))], [1, 2, 4, 7, 13, 17], 'tailwind lines: ' + JSON.stringify(tw));
  assert.deepEqual(tw.filter((r) => r.line === 4).map((r) => r.rule), ['tailwind-inset', 'tailwind-border'], 'inset (deduped) + border-l');
  assert.equal(tw.filter((r) => r.line === 1).length, 2, 'ml-2 + text-left');
  assert.equal(tw.filter((r) => r.line === 7)[0].rule, 'tailwind-space-x');

  // Inline style (tsx)
  assert.deepEqual([...new Set(lines('web/Style.tsx'))], [1, 2, 3, 4], 'inline style lines: ' + JSON.stringify(at('web/Style.tsx')));
  assert.equal(at('web/Style.tsx').some((r) => r.line === 8), false, 'rtl-physical comment allows');

  // scanTailwindString unit checks
  assert.deepEqual(scanTailwindString('flex gap-2 items-center'), []);
  assert.deepEqual(scanTailwindString('md:hover:ml-2').map((h) => h.token), ['md:hover:ml-2']);
  assert.deepEqual(scanTailwindString('rtl:space-x-reverse space-x-1'), []);
  assert.deepEqual(scanTailwindString('Right-click to open the menu.'), []);
  assert.deepEqual(scanTailwindString('rtl:ml-2 ltr:mr-2'), []);
  assert.deepEqual(scanTailwindString('text-lg text-red-500 text-center'), []);

  // CLI: exits 1 on findings, 0 with --report. (Runs against the real repo, so
  // only the exit-code contract is checked, via a clean temp repo layout.)
  const cleanRepo = path.join(tmp, 'clean');
  fs.mkdirSync(path.join(cleanRepo, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(cleanRepo, 'scripts', 'check-logical-css.js'));
  write('clean/apps/web/src/ok.css', '.a { margin-inline-start: 1px; }\n');
  const ok = spawnSync(process.execPath, [path.join(cleanRepo, 'scripts', 'check-logical-css.js')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /0 physical-direction finding/);

  write('clean/apps/web/src/bad.css', '.a { margin-left: 1px; }\n');
  const bad = spawnSync(process.execPath, [path.join(cleanRepo, 'scripts', 'check-logical-css.js')], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /apps\/web\/src\/bad\.css:1: margin-physical: \.a \{ margin-left: 1px; \}/);
  assert.match(bad.stdout, /1 physical-direction finding/);
  const rep = spawnSync(process.execPath, [path.join(cleanRepo, 'scripts', 'check-logical-css.js'), '--report'], { encoding: 'utf8' });
  assert.equal(rep.status, 0);
  assert.match(rep.stdout, /bad\.css:1/);

  console.log('check-logical-css.test.js: all assertions passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
