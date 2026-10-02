#!/usr/bin/env node
/**
 * Fetch what the on-device voice engine (Piper) needs and lay it out under the
 * audio directory, so the app serves it from its own origin. The strict
 * Content-Security-Policy blocks the CDNs the upstream library would use, so
 * nothing here is loaded from a third party at run time; this script is the only
 * place that talks to one, and only when an operator runs it.
 *
 *   <audio dir>/tts/piper/runtime/ort.wasm.min.mjs            ONNX Runtime (onnxruntime-web, MIT)
 *   <audio dir>/tts/piper/runtime/ort-wasm-simd-threaded.mjs
 *   <audio dir>/tts/piper/runtime/ort-wasm-simd-threaded.wasm
 *   <audio dir>/tts/piper/runtime/piper_phonemize.js          espeak-ng phonemizer, wrapped as an ES module
 *   <audio dir>/tts/piper/runtime/piper_phonemize.wasm|.data  (@diffusionstudio/piper-wasm, MIT; espeak-ng is GPL-3.0)
 *   <audio dir>/tts/piper/voices/<voice>.onnx|.onnx.json      voices from rhasspy/piper-voices
 *
 * The audio directory is `<data dir>/audio` (or the `audio.dir` of site.json);
 * the server serves it at `/audio`. Voices have their own licences, listed in
 * each voice's MODEL_CARD in the voices repository: check them before you ship.
 *
 * Usage:
 *   node scripts/fetch-piper-assets.mjs --voice=en_US-amy-medium [--voice=es_ES-davefx-medium ...]
 *   node scripts/fetch-piper-assets.mjs --runtime-only
 *   node scripts/fetch-piper-assets.mjs --index-only      (no download: rebuild sidecars and tts/piper/index.json)
 *   node scripts/fetch-piper-assets.mjs --dest=/srv/bible/data/audio --voice=en_US-hfc_female-medium
 *
 * Environment: BIBLE_DATA_DIR (as the server), FORCE_PIPER_FETCH=1 to re-download,
 * PIPER_VOICES_BASE to use another voices repository or mirror.
 *
 * Every file also gets a `<file>.sha256` sidecar, and `tts/piper/index.json` is written in the
 * asset-index schema (kth-asset-index/1, urls relative to that file) so the in-app asset manager
 * can verify and list the runtime and voices.
 *
 * It ends by printing the `audio` block to merge into the site configuration.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { hashFile, writeSidecar, INDEX_SCHEMA } from './build-asset-index.mjs';

const ORT_VERSION = '1.22.0';
const PHONEMIZE_VERSION = '1.0.0';
const JSDELIVR = 'https://cdn.jsdelivr.net/npm';
const VOICES_BASE = process.env.PIPER_VOICES_BASE || 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
const force = process.env.FORCE_PIPER_FETCH === '1';

const RUNTIME = [
  { to: 'ort.wasm.min.mjs', from: `${JSDELIVR}/onnxruntime-web@${ORT_VERSION}/dist/ort.wasm.min.mjs` },
  { to: 'ort-wasm-simd-threaded.mjs', from: `${JSDELIVR}/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.mjs` },
  { to: 'ort-wasm-simd-threaded.wasm', from: `${JSDELIVR}/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.wasm` },
  { to: 'piper_phonemize.js', from: `${JSDELIVR}/@diffusionstudio/piper-wasm@${PHONEMIZE_VERSION}/build/piper_phonemize.js`, transform: toEsModule },
  { to: 'piper_phonemize.wasm', from: `${JSDELIVR}/@diffusionstudio/piper-wasm@${PHONEMIZE_VERSION}/build/piper_phonemize.wasm` },
  { to: 'piper_phonemize.data', from: `${JSDELIVR}/@diffusionstudio/piper-wasm@${PHONEMIZE_VERSION}/build/piper_phonemize.data` },
];

const log = msg => process.stdout.write(`[fetch-piper] ${msg}\n`);

/** The build is CommonJS/AMD; the worker imports it as a module. Replace the tail with an ES export. */
export function toEsModule(source) {
  const tail = source.lastIndexOf("if (typeof exports === 'object'");
  if (tail < 0) throw new Error('piper_phonemize.js has an unexpected shape (no CommonJS tail); the wrapper needs updating');
  return `${source.slice(0, tail)}\nexport default createPiperPhonemize;\n`;
}

/** `en_US-amy-medium` -> `en/en_US/amy/medium/en_US-amy-medium`. Names may contain underscores. */
export function voicePath(id) {
  const m = /^([a-z]{2,3})_([A-Za-z]+)-(.+)-(x_low|low|medium|high)$/.exec(id);
  if (!m) throw new Error(`"${id}" is not a Piper voice id (expected e.g. en_US-amy-medium)`);
  const [, lang, region, name, quality] = m;
  return `${lang}/${lang}_${region}/${name}/${quality}/${id}`;
}

async function fetchTo(url, dest, transform) {
  if (!force && existsSync(dest) && statSync(dest).size > 0) {
    log(`skip (exists): ${dest}`);
    return;
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  try {
    if (transform) writeFileSync(tmp, transform(await res.text()));
    else await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    rmSync(dest, { force: true });
    renameSync(tmp, dest);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  log(`downloaded: ${dest} (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
}


const RUNTIME_LICENSE = 'MIT (ONNX Runtime, piper-wasm); GPL-3.0 (espeak-ng)';

/** Files of `dir` (flat), excluding sidecars and temp files, sorted. */
function flatFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.') && !/\.(sha256|part|tmp)$/.test(e.name))
    .map(e => e.name).sort();
}

async function indexFile(piperDir, sub, name) {
  const full = join(piperDir, sub, name);
  const { sha256, size } = await hashFile(full);
  writeSidecar(full, sha256);
  const f = { path: name, url: `${sub}/${encodeURIComponent(name)}`, size, sha256 };
  if (name.endsWith('.json')) f.contentType = 'application/json';
  else if (name.endsWith('.wasm')) f.contentType = 'application/wasm';
  else if (name.endsWith('.mjs') || name.endsWith('.js')) f.contentType = 'text/javascript';
  return f;
}

/**
 * Write sidecars for everything under `piperDir` and `piperDir/index.json` (asset-index schema,
 * urls relative to the index): one `piper-runtime` (`runtime/*`) and one `tts-voice` per
 * `voices/<id>.onnx` (+ `.onnx.json`). Works from what is on disk, so it serves `--index-only`.
 */
export async function buildPiperIndex(piperDir) {
  const assets = [];
  const runtimeNames = flatFiles(join(piperDir, 'runtime'));
  if (runtimeNames.length > 0) {
    const files = [];
    for (const n of runtimeNames) files.push(await indexFile(piperDir, 'runtime', n));
    assets.push({
      id: 'piper-runtime', kind: 'tts-runtime', version: `${ORT_VERSION}-${PHONEMIZE_VERSION}`,
      title: 'Piper speech runtime', license: RUNTIME_LICENSE,
      size: files.reduce((n, f) => n + f.size, 0), files,
    });
  }
  const voiceNames = flatFiles(join(piperDir, 'voices'));
  for (const n of voiceNames.filter(v => v.endsWith('.onnx'))) {
    const id = n.slice(0, -'.onnx'.length);
    const names = [n, `${id}.onnx.json`].filter(x => voiceNames.includes(x));
    const files = [];
    for (const x of names) files.push(await indexFile(piperDir, 'voices', x));
    let cfg = {};
    try { cfg = JSON.parse(readFileSync(join(piperDir, 'voices', `${id}.onnx.json`), 'utf8')); } catch { /* no config */ }
    const license = typeof cfg.license === 'string' && cfg.license ? cfg.license
      : typeof cfg.dataset === 'string' && cfg.dataset ? `dataset: ${cfg.dataset} (see MODEL_CARD)` : 'see MODEL_CARD';
    const lang = (cfg.language?.code ?? id.split('-')[0]).replace('_', '-');
    const meta = {};
    if (['x_low', 'low', 'medium', 'high'].includes(cfg.audio?.quality)) meta.quality = cfg.audio.quality;
    if (cfg.audio?.sample_rate) meta.sampleRate = cfg.audio.sample_rate;
    const m = {
      id, kind: 'tts-voice', version: '1', title: id.split('-').slice(1, -1).join(' ').replace(/_/g, ' ') || id,
      license, languages: [lang], size: files.reduce((s, f) => s + f.size, 0), files,
    };
    if (Object.keys(meta).length) m.meta = meta;
    assets.push(m);
  }
  assets.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const index = { schema: INDEX_SCHEMA, generatedAt: new Date().toISOString(), assets };
  const dest = join(piperDir, 'index.json');
  mkdirSync(piperDir, { recursive: true });
  writeFileSync(`${dest}.tmp`, `${JSON.stringify(index, null, 2)}\n`);
  renameSync(`${dest}.tmp`, dest);
  return index;
}

function parseArgs(argv) {
  const opts = { voices: [], dest: null, runtimeOnly: false, indexOnly: false };
  for (const a of argv) {
    if (a.startsWith('--voice=')) opts.voices.push(...a.slice(8).split(',').filter(Boolean));
    else if (a.startsWith('--dest=')) opts.dest = a.slice(7);
    else if (a === '--runtime-only') opts.runtimeOnly = true;
    else if (a === '--index-only') opts.indexOnly = true;
    else if (a === '-h' || a === '--help') { opts.help = true; }
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

function languageOf(id) {
  return id.split('_')[0];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { log('see the header of scripts/fetch-piper-assets.mjs'); return; }
  if (opts.voices.length === 0 && !opts.runtimeOnly && !opts.indexOnly) throw new Error('Name at least one --voice=<id> (or use --runtime-only).');
  for (const id of opts.voices) voicePath(id); // validate before downloading anything

  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = process.env.BIBLE_DATA_DIR || resolve(webRoot, '../../data');
  const audioDir = opts.dest ? resolve(opts.dest) : join(dataDir, 'audio');
  const piperDir = join(audioDir, 'tts', 'piper');
  log(`target: ${piperDir}`);

  if (opts.indexOnly) {
    const idx = await buildPiperIndex(piperDir);
    log(`index rebuilt: ${idx.assets.length} asset(s) in ${join(piperDir, 'index.json')}`);
    return;
  }

  for (const f of RUNTIME) await fetchTo(f.from, join(piperDir, 'runtime', f.to), f.transform);

  const voices = [];
  for (const id of opts.voices) {
    const path = voicePath(id);
    await fetchTo(`${VOICES_BASE}/${path}.onnx`, join(piperDir, 'voices', `${id}.onnx`));
    await fetchTo(`${VOICES_BASE}/${path}.onnx.json`, join(piperDir, 'voices', `${id}.onnx.json`));
    const onnx = statSync(join(piperDir, 'voices', `${id}.onnx`)).size;
    const cfg = JSON.parse(readFileSync(join(piperDir, 'voices', `${id}.onnx.json`), 'utf8'));
    const quality = cfg.audio?.quality;
    voices.push({
      id,
      label: id.split('-').slice(1, -1).join(' ').replace(/_/g, ' '),
      language: cfg.language?.code?.replace('_', '-') ?? id.split('-')[0].replace('_', '-'),
      quality: ['low', 'medium', 'high'].includes(quality) ? quality : undefined,
      downloadBytes: onnx,
      files: [`voices/${id}.onnx`, `voices/${id}.onnx.json`],
    });
  }

  const idx = await buildPiperIndex(piperDir);
  log(`sidecars and index written: ${idx.assets.length} asset(s)`);

  if (voices.length > 0) {
    const defaultVoices = {};
    for (const v of voices) defaultVoices[languageOf(v.id)] ??= v.id;
    log('');
    log('Merge this into your site configuration (features.audio must be true):');
    process.stdout.write(`${JSON.stringify({
      features: { audio: true },
      audio: { tts: { engines: [{ id: 'piper', enabled: true, defaultVoices, voices }] } },
    }, null, 2)}\n`);
  }
  log('done.');
}

// Only when run directly, so the pure helpers can be imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`[fetch-piper] ERROR: ${err.message}`);
    process.exit(1);
  });
}
