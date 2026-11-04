// Builds dist/: core IIFE, plus ESM, locale IIFEs, the stand-alone CSS and the PHP file.
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

mkdirSync('dist/locales', { recursive: true });
const common = { bundle: true, minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning' };

await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/verse-hover.min.js', format: 'iife', globalName: '__vh' });
await build({ ...common, entryPoints: ['src/ui-entry.ts'], outfile: 'dist/verse-hover-ui.min.js', format: 'iife' });
// Single-file variant: core + interactive half in one script (no second request).
writeFileSync('dist/.all.ts', "import '../src/ui-entry';\nimport '../src/index';\n");
await build({ ...common, entryPoints: ['dist/.all.ts'], outfile: 'dist/verse-hover.all.min.js', format: 'iife' });
if (existsPlus()) await build({ ...common, entryPoints: ['src/plus/reader.ts'], outfile: 'dist/verse-hover-plus.min.js', format: 'esm' });

for (const f of readdirSync('src/locales')) {
  const id = f.split('.')[0];
  if (id === 'en' || !f.endsWith('.generated.ts')) continue;
  const tmp = `dist/.locale-${id}.ts`;
  writeFileSync(tmp, `import { pack } from '../src/locales/${f.replace(/\.ts$/, '')}';\n(window as any).VerseHover.addLocale(pack);\n`);
  await build({ ...common, entryPoints: [tmp], outfile: `dist/locales/vh-locale-${id}.js`, format: 'iife' });
}

await build({ ...common, minify: false, entryPoints: ['src/style.ts'], outfile: 'dist/.style.mjs', format: 'esm' });
const { css } = await import('./dist/.style.mjs');
writeFileSync('dist/verse-hover.css', css('vh-'));
copyFileSync('php/verse-hover.php', 'dist/verse-hover.php');
for (const f of readdirSync('dist')) {
  if (f.endsWith('.js')) console.log(f.padEnd(28), gzipSync(readFileSync('dist/' + f), { level: 9 }).length, 'B gzip');
}

function existsPlus() {
  try { readFileSync('src/plus/reader.ts'); return true; } catch { return false; }
}
