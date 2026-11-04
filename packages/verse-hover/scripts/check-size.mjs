// CI size gate: node scripts/check-size.mjs (after `node build.mjs`). Sizes are min+gzip level 9.
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// target = design goal, cap = hard CI failure
const budgets = [
  ['dist/verse-hover.min.js', 9, 10, 'core (scan, detect, link, config)'],
  ['dist/verse-hover-ui.min.js', 9, 10, 'interactive half (popup, data, CSS)'],
  ['dist/verse-hover.all.min.js', 13, 14, 'single-file variant (core + ui)'],
  ['dist/verse-hover-plus.min.js', 20, 24, 'optional chapter reader'],
];
let fail = false;
for (const [file, target, cap, what] of budgets) {
  if (!existsSync(file)) { console.log(`MISSING ${file}`); fail = true; continue; }
  const kb = gzipSync(readFileSync(file), { level: 9 }).length / 1024;
  const state = kb > cap ? 'FAIL' : kb > target ? 'warn' : 'ok  ';
  if (kb > cap) fail = true;
  console.log(`${state} ${file.padEnd(34)} ${kb.toFixed(2)} KB gzip (target ${target}, cap ${cap})  ${what}`);
}
process.exit(fail ? 1 : 0);
