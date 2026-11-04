// Builds release/verse-hover-<version>.zip: everything a site owner needs, with no Node or this repo required.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
execFileSync('node', ['build.mjs'], { stdio: 'inherit' });
const name = `verse-hover-${version}`;
const dir = `release/${name}`;
rmSync('release', { recursive: true, force: true });
mkdirSync(`${dir}/locales`, { recursive: true });
for (const f of ['verse-hover.min.js', 'verse-hover-ui.min.js', 'verse-hover.all.min.js', 'verse-hover-plus.min.js', 'verse-hover.css', 'verse-hover.php']) copyFileSync(`dist/${f}`, `${dir}/${f}`);
cpSync('dist/locales', `${dir}/locales`, { recursive: true });
copyFileSync('php/verse-hover.config.sample.php', `${dir}/verse-hover.config.sample.php`);
copyFileSync('README.md', `${dir}/README.md`);
copyFileSync('../../LICENSE', `${dir}/LICENSE`);
execFileSync('zip', ['-r', '-q', `${name}.zip`, name], { cwd: 'release', stdio: 'inherit' });
console.log(`release/${name}.zip`);
