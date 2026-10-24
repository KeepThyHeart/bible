#!/usr/bin/env node
// Pins Whisper model files: reads the Hugging Face tree API for a revision and prints the
// TS table for packages/speech/src/models/whisperModels.ts (LFS oid = sha256; small non-LFS
// files are downloaded and hashed). Run by hand; the output is committed.
// Usage: node scripts/speech/pin-whisper-models.mjs [repo@rev ...]
import { createHash } from 'node:crypto';

const DEFAULTS = [
  'onnx-community/whisper-base@1846881b6b3a3024392c1eea3ad983695bc23925',
  'onnx-community/whisper-tiny@ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
];
const ROOT_FILES = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json'];
const ONNX = /^onnx\/(encoder_model|decoder_model_merged)(_quantized|_fp16)\.onnx$/;

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function pin(repo, rev) {
  const entries = [
    ...(await json(`https://huggingface.co/api/models/${repo}/tree/${rev}`)),
    ...(await json(`https://huggingface.co/api/models/${repo}/tree/${rev}/onnx`)),
  ].filter((e) => e.type === 'file');
  const out = {};
  for (const e of entries) {
    if (!ROOT_FILES.includes(e.path) && !ONNX.test(e.path)) continue;
    let sha256 = e.lfs?.oid;
    let size = e.lfs?.size ?? e.size;
    if (!sha256) {
      const r = await fetch(`https://huggingface.co/${repo}/resolve/${rev}/${e.path}`);
      if (!r.ok) throw new Error(`${r.status} ${e.path}`);
      const buf = Buffer.from(await r.arrayBuffer());
      sha256 = createHash('sha256').update(buf).digest('hex');
      size = buf.length;
    }
    out[e.path] = { size, sha256 };
  }
  return out;
}

const specs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;
for (const spec of specs) {
  const [repo, rev] = spec.split('@');
  const files = await pin(repo, rev);
  console.log(`  // ${repo} @ ${rev}`);
  console.log(`  '${repo}': {`);
  for (const [p, f] of Object.entries(files).sort()) {
    console.log(`    '${p}': { size: ${f.size}, sha256: '${f.sha256}' },`);
  }
  console.log('  },');
}
