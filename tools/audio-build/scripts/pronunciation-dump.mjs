#!/usr/bin/env node
/**
 * Pronunciation dump: every distinct word of a Bible module as espeak-ng says it, for review.
 *
 * Uses the same TextPreparer and the same espeak-ng build (piper-wasm) as on-device speech,
 * so the IPA here is what the voice is fed. System `espeak-ng -X` (if installed) adds whether
 * each word was found in espeak's dictionary or guessed from spelling rules (the main signal
 * for likely mispronunciations, mostly names).
 *
 * Needs a built core and audio-build:
 *   pnpm build:core && pnpm --filter @bible/audio-build run build
 *   node tools/audio-build/scripts/pronunciation-dump.mjs --module-file=PATH --out=DIR [--voice=en-us]
 *
 * Writes to DIR:
 *   words.jsonl   one line per distinct lower-case word: counts, capitalisation, IPA, dict flag, sample refs
 *   verses.jsonl  one line per verse: ref, spoken text, phonemes per sentence (the full dump)
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const dist = resolve(import.meta.dirname, '../dist');
const { openModuleText } = require(join(dist, 'moduleSource.js'));
const { loadPhonemizerAssets } = require(join(dist, 'engines/piper.js'));
const { TextPreparer } = require(join(dist, 'core.js'));

const { values: v } = parseArgs({ options: { 'module-file': { type: 'string' }, out: { type: 'string' }, voice: { type: 'string' } } });
if (!v['module-file'] || !v.out) { console.error('usage: --module-file=PATH --out=DIR [--voice=en-us]'); process.exit(2); }
const espeakVoice = v.voice ?? 'en-us';
const outDir = resolve(v.out);
mkdirSync(outDir, { recursive: true });

const BOOK_CODES = ['GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL','MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV'];

// ---- 1. Spoken text of every verse (and chapter intros) ----
const mod = openModuleText(resolve(v['module-file']));
const prep = new TextPreparer();
const verses = []; // { ref, text }
for (const [book, chapters] of mod.chapters()) {
  for (const chapter of chapters) {
    const intro = prep.chapterIntro({ moduleAbbr: mod.abbreviation, book, chapter }, mod.bookName(book), mod.language);
    if (intro) verses.push({ ref: `${BOOK_CODES[book - 1]}.${chapter}.intro`, text: intro });
    for (const raw of mod.verses(book, chapter)) {
      const text = prep.verse(raw, mod.language).trim();
      if (text) verses.push({ ref: `${BOOK_CODES[book - 1]}.${chapter}.${raw.verse}`, text });
    }
  }
}
mod.close();
console.error(`${verses.length} verses/intros`);

// ---- 2. Word types ----
const WORD = /\p{L}+(?:'\p{L}+)*/gu;
const types = new Map();
for (const { ref, text } of verses) {
  let m;
  WORD.lastIndex = 0;
  let index = 0;
  while ((m = WORD.exec(text))) {
    const w = m[0];
    const key = w.toLowerCase();
    const before = text.slice(0, m.index).trimEnd();
    const initial = before === '' || /[.!?"'(]$/.test(before);
    let t = types.get(key);
    if (!t) { t = { word: key, count: 0, capMid: 0, lowerCount: 0, initialCap: 0, forms: {}, refs: [] }; types.set(key, t); }
    t.count++;
    t.forms[w] = (t.forms[w] ?? 0) + 1;
    if (w[0] === w[0].toLowerCase()) t.lowerCount++;
    else if (initial) t.initialCap++;
    else t.capMid++;
    if (t.refs.length < 3) t.refs.push(`${ref}#${index}`);
    index++;
  }
}
console.error(`${types.size} distinct words`);

// ---- 3. Phonemize with the shipped espeak build ----
const assets = await loadPhonemizerAssets();
function phonemizeEntries(entries) {
  return new Promise((res, rej) => {
    const lines = [];
    const errs = [];
    assets.create({
      print: l => lines.push(l), printErr: l => errs.push(l),
      locateFile: f => join(assets.dir, f), wasmBinary: assets.wasm,
      getPreloadedPackage: n => (n.endsWith('.data') ? assets.data : null),
    }).then(m => {
      m.callMain(['-l', espeakVoice, '--input', JSON.stringify(entries.map(text => ({ text }))), '--espeak_data', '/espeak-ng-data']);
      const out = [];
      for (const l of lines) { try { const j = JSON.parse(l); if (Array.isArray(j.phonemes)) out.push(j.phonemes.join('')); } catch { /* not JSON */ } }
      if (out.length !== entries.length) rej(new Error(`phonemizer returned ${out.length} of ${entries.length}: ${errs.at(-1) ?? ''}`));
      else res(out);
    }).catch(rej);
  });
}
async function phonemizeAll(texts, batch) {
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    const slice = texts.slice(i, i + batch);
    try { out.push(...await phonemizeEntries(slice)); }
    catch (e) {
      // The wasm build can fault on a large input; retry one entry at a time.
      for (const t of slice) {
        try { out.push(...await phonemizeEntries([t])); }
        catch { console.error(`  phonemizer failed on: ${t.slice(0, 60)}`); out.push(null); }
      }
    }
    if ((i / batch) % 20 === 0) console.error(`  ${Math.min(i + batch, texts.length)}/${texts.length}`);
  }
  return out;
}

const list = [...types.values()];
// Phonemize the most common surface form (capitalised names keep their capital).
const surface = list.map(t => Object.entries(t.forms).sort((a, b) => b[1] - a[1])[0][0]);
console.error('phonemizing words');
const wordIpa = await phonemizeAll(surface, 500);
list.forEach((t, i) => { t.ipa = wordIpa[i]; });

// ---- 4. Dictionary or rules (system espeak-ng, optional) ----
const probe = spawnSync('espeak-ng', ['--version'], { encoding: 'utf8' });
if (probe.status === 0) {
  console.error('dictionary flags');
  for (let i = 0; i < list.length; i += 2000) {
    const chunk = list.slice(i, i + 2000);
    const r = spawnSync('espeak-ng', ['-v', espeakVoice, '-q', '-X'], { input: chunk.map(t => t.word).join('\n'), encoding: 'utf8', maxBuffer: 1 << 28 });
    const found = new Set();
    for (const m of r.stdout.matchAll(/^Found: '([^']+)'/gm)) found.add(m[1].toLowerCase());
    // Also "Found: 'word' [...]" lines for words that split into stem + suffix count as found.
    for (const t of chunk) t.dict = found.has(t.word) ? 'found' : 'rules';
  }
}

writeFileSync(join(outDir, 'words.jsonl'), list.sort((a, b) => b.count - a.count).map(t => JSON.stringify(t)).join('\n') + '\n');

// ---- 5. Full verse dump ----
console.error('phonemizing verses');
const verseIpa = await phonemizeAll(verses.map(x => x.text), 40);
writeFileSync(join(outDir, 'verses.jsonl'), verses.map((x, i) => JSON.stringify({ ref: x.ref, text: x.text, ipa: verseIpa[i] })).join('\n') + '\n');
console.error(`wrote ${outDir}`);
