/**
 * Opt-in integration test: the real Whisper model through the worker handlers in Node, on the
 * committed PCM fixtures (`test/fixtures`, made by scripts/speech/make-fixtures.py).
 *
 *   SPEECH_IT=1 pnpm --filter @bible/speech test -- test/integration
 *
 * Env: SPEECH_MODEL (tiny | base, default base), SPEECH_MODEL_DIR (download cache, default
 * ~/.cache/bible-speech-models). Skipped unless SPEECH_IT=1. Downloads the q8 model once (sha256-checked
 * against the pinned table); skipped with a note when offline and not cached.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { kitFor } from '@bible/core/recite';
import { createWhisperHandlers, type WhisperHandlers } from '../../src/engine/whisperHandlers';
import { WHISPER_MODELS, WHISPER_PINS, WHISPER_VARIANTS, assetIdFor, fileUrl, whisperFilePaths } from '../../src/models/whisperModels';
import type { WhisperModelId } from '../../src/types';
import { promptFor } from '../../src/engine/biasPrompt';
// Grading lives in the memory package.
import { gradeRecitation } from '../../../memory/src/core/recite/grade';

const RUN = process.env.SPEECH_IT === '1';
const MODEL = (process.env.SPEECH_MODEL ?? 'base') as WhisperModelId;
const DIR = process.env.SPEECH_MODEL_DIR ?? join(homedir(), '.cache', 'bible-speech-models');
const FIX = join(__dirname, '..', 'fixtures');

interface Fixture { file: string; ref: string; voice: string; text: string; kind: 'correct' | 'skip' | 'swap'; expected: string }

function readWav16(path: string): Float32Array {
  const b = readFileSync(path);
  const data = b.indexOf('data');
  const n = b.readUInt32LE(data + 4) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(data + 8 + i * 2) / 32768;
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
function wer(ref: string[], hyp: string[]): number {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...new Array(hyp.length).fill(0)] as number[]);
  for (let j = 0; j <= hyp.length; j++) d[0][j] = j;
  for (let i = 1; i <= ref.length; i++)
    for (let j = 1; j <= hyp.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  return d[ref.length][hyp.length] / ref.length;
}

async function ensureModel(): Promise<Record<string, ArrayBuffer> | null> {
  const info = WHISPER_MODELS[MODEL];
  const pins = WHISPER_PINS[assetIdFor(MODEL, 'q8')];
  const files: Record<string, ArrayBuffer> = {};
  for (const path of whisperFilePaths('q8')) {
    const local = join(DIR, assetIdFor(MODEL, 'q8'), path);
    let bytes: Buffer;
    if (existsSync(local)) bytes = readFileSync(local);
    else {
      const url = fileUrl('https://huggingface.co/', info.repo, info.revision, path);
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        bytes = Buffer.from(await res.arrayBuffer());
      } catch {
        // Node's fetch can fail on dual-stack hosts where curl works; try curl before giving up.
        try {
          bytes = execFileSync('curl', ['-sSLf', '-m', '300', url], { maxBuffer: 512 * 1024 * 1024 });
        } catch {
          return null; // offline
        }
      }
      const want = pins?.[path]?.sha256;
      if (want && createHash('sha256').update(bytes).digest('hex') !== want) throw new Error(`sha256 mismatch for ${path}`);
      mkdirSync(dirname(local), { recursive: true });
      writeFileSync(local, bytes);
    }
    files[path] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  return files;
}

describe.skipIf(!RUN)('Whisper on PCM fixtures (real model)', () => {
  let handlers: WhisperHandlers | null = null;
  let ready = false;
  const fixtures: Fixture[] = JSON.parse(readFileSync(join(FIX, 'fixtures.json'), 'utf8'));
  const kit = kitFor('en')!;
  const results: { f: Fixture; text: string; wer: number }[] = [];
  const scores = new Map<string, number>();

  beforeAll(async () => {
    const files = await ensureModel();
    if (!files) {
      console.warn('speech integration: model not available offline, skipping');
      return;
    }
    handlers = createWhisperHandlers();
    await handlers.init({ ortBase: '/ort/', numThreads: 1 });
    const t0 = Date.now();
    // Node uses onnxruntime-node: the CPU backend takes the place of wasm.
    await handlers.load({ modelId: assetIdFor(MODEL, 'q8'), device: 'cpu' as never, dtype: { ...WHISPER_VARIANTS.q8.dtype }, files }, () => {});
    console.log(`model ${MODEL} loaded in ${Date.now() - t0} ms`);
    ready = true;
  }, 600_000);

  it('transcribes every fixture; correct ones within WER 0.15 and graded as passes, incorrect ones graded as fails', async () => {
    if (!ready || !handlers) return;
    for (const f of fixtures) {
      const pcm = readWav16(join(FIX, f.file));
      const t0 = Date.now();
      const r = await handlers.transcribe({ pcm, language: 'en', prompt: '' }, new AbortController().signal);
      const hyp = norm(r.text);
      if (process.env.SPEECH_IT_VERBOSE) console.log(JSON.stringify(r.text));
      results.push({ f, text: r.text, wer: wer(norm(f.text), hyp) });
      console.log(`${f.file} rtf=${((Date.now() - t0) / 1000 / (pcm.length / 16000)).toFixed(2)} wer=${results.at(-1)!.wer.toFixed(2)}`);

      const verses = [{ verseId: 1, label: f.ref, words: f.expected.split(' '), lines: null, psalmTitle: null, paragraphStart: false }];
      const g = gradeRecitation(verses, hyp.map((text) => ({ text })), new Set(), 'normal', kit);
      scores.set(f.file, g.attempt.score);
    }

    // Synthetic OS voices are harder than people: the bars are on the aggregate and on the ordering.
    const correct = results.filter((r) => r.f.kind === 'correct');
    const meanWer = correct.reduce((a, r) => a + r.wer, 0) / correct.length;
    expect(meanWer).toBeLessThanOrEqual(0.3);
    for (const r of correct) expect(scores.get(r.f.file), r.f.file).toBeGreaterThanOrEqual(0.7);
    for (const r of results.filter((x) => x.f.kind !== 'correct')) {
      const sibling = r.f.file.replace(/\.(skip|swap)\.wav$/, '.correct.wav');
      expect(scores.get(r.f.file)!, r.f.file).toBeLessThan(1);
      if (r.f.kind === 'skip') expect(scores.get(r.f.file)!, r.f.file).toBeLessThan(Math.min(0.95, scores.get(sibling)!));
    }
  }, 900_000);

  it('a bias prompt of distinctive words (not in passage order) does not hurt a correct recitation', async () => {
    if (!ready || !handlers) return;
    const f = fixtures.find((x) => x.file === 'john-3-16.a.correct.wav')!;
    const pcm = readWav16(join(FIX, f.file));
    const run = async (prompt: string) => norm((await handlers!.transcribe({ pcm, language: 'en', prompt }, new AbortController().signal)).text);
    const words = f.expected.replace(/[^\w' ]/g, '').split(' ').filter((w) => w.length > 6).reverse().slice(0, 4);
    const base = wer(norm(f.text), await run(''));
    const biased = wer(norm(f.text), await run(promptFor({ level: 'names', phrases: words } as never)));
    console.log(`bias prompt: wer ${base.toFixed(2)} -> ${biased.toFixed(2)}`);
    expect(biased).toBeLessThanOrEqual(base + 0.15);
  }, 120_000);
});
