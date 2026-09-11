#!/usr/bin/env node
/**
 * Evaluates compact semantic-index configurations against today's full index.
 *
 * Baseline = the desktop reader's current behaviour: fp32 768-dim query vs
 * fp32 768-dim documents, raw cosine, levels verse + paragraph.
 *
 * Each configuration's ranking is collapsed to passages (level + start +
 * end, keeping the best row score, which is how facet rows fold together)
 * and compared with the baseline's passages:
 *   - overlap@10 / @20: shared passages in the top K divided by K.
 *   - Judged hit-rate on the benchmark set (expected verse ranges): recall of a
 *     primary answer in the top 10 / 20, primary MRR@20, and any-tier
 *     (primary or acceptable) recall@10. Overlap with the baseline cannot
 *     reward a change that improves on the baseline (e.g. centering); the
 *     judged set can.
 *   - Score scale and min_similarity calibration: top-1 / 20th passage score
 *     percentiles for real and off-topic queries, and how many of the 20
 *     results survive each candidate threshold.
 *
 * Query embedding and the corpus means run on the main thread; scoring is
 * split by query across worker threads, each streaming the source in row
 * blocks, so the 1.2 GB fp32 matrix is never held in memory.
 *
 * Usage:
 *   node scripts/semantic/evaluate-compact-index.mjs --source=<full-width index .db>
 *     --benchmark=<benchmark-queries.json> --fp32-models=<models root holding the fp32 v1.5 model>
 *     [--q8-models=apps/web/data/models] [--out=data/semantic-build/eval-results.json]
 *     [--workers=6] [--limit=<n judged queries>]
 *
 * The benchmark is a JSON array of { query, category, expected: [{ start, end, tier }] }
 * with tier 'primary' or 'acceptable'. The source index, the benchmark and the
 * fp32 model are not part of this repository.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  SOURCE_DIM,
  VECTOR_SCALE,
  computeCorpusMeans,
  loadQueryEmbedder,
  parseArgs,
  roundMean,
  transformVector,
} from './lib/vector-transform.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = parseArgs(process.argv.slice(2));
for (const required of ['source', 'benchmark', 'fp32-models']) {
  if (!args[required]) throw new Error(`--${required}=<path> is required`);
}
const sourcePath = path.resolve(args.source);
const benchmarkPath = path.resolve(args.benchmark);
const q8ModelsPath = path.resolve(args['q8-models'] ?? path.join(REPO_ROOT, 'apps', 'web', 'data', 'models'));
const fp32ModelsPath = path.resolve(args['fp32-models']);
const resultsPath = path.resolve(args.out ?? path.join(REPO_ROOT, 'data', 'semantic-build', 'eval-results.json'));
const workerCount = Number(args.workers ?? Math.max(1, Math.min(6, os.cpus().length - 2)));
const judgedLimit = args.limit ? Number(args.limit) : Infinity;

const SEARCH_LEVELS = ['verse', 'paragraph'];
const BASELINE_THRESHOLD = 0.3;
const TOP_K = 20;
const BLOCK_ROWS = 4096;

/** Natural-language queries without judged answers: emotional, pastoral and paraphrased phrasings. */
const EXTRA_QUERIES = [
  'anxiety and worry',
  'feeling lonely and abandoned by everyone',
  'grief after losing someone I love',
  'how do I forgive someone who hurt me deeply',
  'David and Goliath',
  'God comforts the brokenhearted',
  'I feel like a failure and God is disappointed in me',
  'money cannot make you happy',
  'what happens to us after we die',
  'raising children to follow God',
  'being patient while waiting for answers to prayer',
  'jealousy between brothers',
  'a woman who showed great courage',
  'God keeps his promises even when it takes a long time',
  'dealing with anger',
  'the tongue is dangerous',
  'fear of the future',
  'serving others instead of seeking to be great',
  'hope in the middle of suffering',
  'temptation and how to resist it',
];

/** Off-topic queries: nothing in scripture should rank as a strong match. */
const JUNK_QUERIES = [
  'best pepperoni pizza recipe',
  'how to change a flat car tire',
  'javascript async await tutorial',
  'stock market forecast for next quarter',
  'cheap flights to Paris in June',
  'iPhone battery replacement cost',
  'asdfghjkl qwerty zxcvbnm',
  'lorem ipsum dolor sit amet',
  'minecraft redstone door tutorial',
  'how many calories are in a banana',
  'best gaming laptop under 1000 dollars',
  'home office tax deduction rules',
  'premier league football results',
  'configure a wifi router password',
  'quantum chromodynamics lattice gauge theory',
];

/**
 * Configurations to compare. Each has a query model ('fp32' | 'q8'), a
 * dimension, centering and document encoding. The first entry is the baseline.
 */
const CONFIGS = [
  { name: 'base 768 fp32 / fp32q', query: 'fp32', dims: 768, center: false, encoding: 'fp32' },
  { name: '768 fp32 / q8q', query: 'q8', dims: 768, center: false, encoding: 'fp32' },
  { name: '256 fp32 / q8q', query: 'q8', dims: 256, center: false, encoding: 'fp32' },
  { name: '256 int8 / q8q', query: 'q8', dims: 256, center: false, encoding: 'int8' },
  { name: '256 int8 ctr / q8q', query: 'q8', dims: 256, center: true, encoding: 'int8' },
  { name: '128 int8 / q8q', query: 'q8', dims: 128, center: false, encoding: 'int8' },
  { name: '128 int8 ctr / q8q', query: 'q8', dims: 128, center: true, encoding: 'int8' },
  { name: '256 int8 / fp32q', query: 'fp32', dims: 256, center: false, encoding: 'int8' },
  { name: '256 int8 ctr / fp32q', query: 'fp32', dims: 256, center: true, encoding: 'int8' },
];
for (const config of CONFIGS) config.docKey = `${config.dims}|${config.center}|${config.encoding}`;

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;

// ── Queries ─────────────────────────────────────────────────────────────────

const judged = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8')).slice(0, judgedLimit);
const queries = [
  ...judged.map((q) => ({ text: q.query, kind: 'judged', expected: q.expected, category: q.category })),
  ...EXTRA_QUERIES.map((text) => ({ text, kind: 'extra' })),
  ...JUNK_QUERIES.map((text) => ({ text, kind: 'junk' })),
];
const nQ = queries.length;
console.log(`${nQ} queries (${judged.length} judged, ${EXTRA_QUERIES.length} extra, ${JUNK_QUERIES.length} off-topic)`);

async function embedAll(modelsPath, dtype) {
  const embed = await loadQueryEmbedder(modelsPath, dtype);
  const matrix = new Float32Array(nQ * SOURCE_DIM);
  const t0 = Date.now();
  for (let q = 0; q < nQ; q++) matrix.set(await embed(queries[q].text), q * SOURCE_DIM);
  await embed.dispose();
  console.log(`  ${dtype}: embedded ${nQ} queries in ${((Date.now() - t0) / 1000).toFixed(1)}s (${elapsed()})`);
  return matrix;
}

console.log('Embedding queries...');
const rawQueries = { fp32: await embedAll(fp32ModelsPath, 'fp32'), q8: await embedAll(q8ModelsPath, 'q8') };

const modelCosines = queries.map((_, q) => {
  let dot = 0;
  for (let i = 0; i < SOURCE_DIM; i++) dot += rawQueries.fp32[q * SOURCE_DIM + i] * rawQueries.q8[q * SOURCE_DIM + i];
  return dot;
});

// ── Corpus means and passage keys ───────────────────────────────────────────

const centeredDims = [...new Set(CONFIGS.filter((c) => c.center).map((c) => c.dims))];
console.log(`Corpus means for ${centeredDims.join(', ')} dims...`);
// Rounded exactly as the builder stores them, so the evaluation matches the shipped index.
const means = Object.fromEntries(
  [...computeCorpusMeans(sourcePath, centeredDims)].map(([d, m]) => [d, Float64Array.from(roundMean(m))])
);
for (const [d, m] of Object.entries(means)) {
  console.log(`  ${d}d mean norm ${Math.sqrt(m.reduce((s, v) => s + v * v, 0)).toFixed(4)} (${elapsed()})`);
}

const db = new DatabaseSync(sourcePath, { readOnly: true });
const passageKeys = [
  ...new Set(
    db
      .prepare(`SELECT level, start_verse_id, end_verse_id FROM semantic_embeddings WHERE level IN (${SEARCH_LEVELS.map(() => '?').join(',')})`)
      .all(...SEARCH_LEVELS)
      .map((r) => `${r.level}|${r.start_verse_id}|${r.end_verse_id}`)
  ),
];
const searchRowCount = db
  .prepare(`SELECT COUNT(*) AS c FROM semantic_embeddings WHERE level IN (${SEARCH_LEVELS.map(() => '?').join(',')})`)
  .get(...SEARCH_LEVELS).c;
db.close();
const passages = passageKeys.map((key) => {
  const [level, start, end] = key.split('|');
  return { level, start: Number(start), end: Number(end) };
});
const nP = passages.length;
console.log(`  ${nP} verse/paragraph passages over ${searchRowCount.toLocaleString()} rows (${elapsed()})`);

// ── Per-config query vectors ────────────────────────────────────────────────

for (const config of CONFIGS) {
  const mean = config.center ? means[config.dims] : null;
  config.queryVectors = new Float32Array(nQ * config.dims);
  const scratch = new Float64Array(config.dims);
  for (let q = 0; q < nQ; q++) {
    const raw = rawQueries[config.query].subarray(q * SOURCE_DIM, (q + 1) * SOURCE_DIM);
    config.queryVectors.set(transformVector(raw, scratch, mean), q * config.dims);
  }
  // int8 documents are scored as dot(q, v) / 127: fold the scale into the query.
  if (config.encoding === 'int8') {
    for (let i = 0; i < config.queryVectors.length; i++) config.queryVectors[i] /= VECTOR_SCALE;
  }
}

// ── Scoring across workers ──────────────────────────────────────────────────

console.log(`Scoring with ${workerCount} workers...`);
const chunkSize = Math.ceil(nQ / workerCount);
const chunks = [];
for (let first = 0; first < nQ; first += chunkSize) chunks.push([first, Math.min(nQ, first + chunkSize)]);

const chunkResults = await Promise.all(
  chunks.map(([first, last], w) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./lib/score-worker.mjs', import.meta.url), {
      workerData: {
        sourcePath,
        levels: SEARCH_LEVELS,
        passageKeys,
        means,
        queryCount: last - first,
        blockRows: BLOCK_ROWS,
        topK: TOP_K,
        reportProgress: w === 0,
        configs: CONFIGS.map((c) => ({
          docKey: c.docKey,
          dims: c.dims,
          center: c.center,
          encoding: c.encoding,
          queryVectors: c.queryVectors.slice(first * c.dims, last * c.dims),
        })),
      },
    });
    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        process.stdout.write(`\r  worker 0: ${msg.rows.toLocaleString()} / ${searchRowCount.toLocaleString()} rows (${elapsed()})`);
      } else {
        resolve({ first, last, top: msg.top });
      }
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker ${w} exited with code ${code}`));
    });
  }))
);
process.stdout.write(`\n  scoring done (${elapsed()})\n`);

// config.top[q] = { idx: passage indices best-first, score: matching scores }
CONFIGS.forEach((config, c) => {
  config.top = new Array(nQ);
  for (const { first, last, top } of chunkResults) {
    for (let q = first; q < last; q++) {
      const off = (q - first) * TOP_K;
      config.top[q] = {
        idx: Array.from(top[c].indices.subarray(off, off + TOP_K)),
        score: Array.from(top[c].scores.subarray(off, off + TOP_K)),
      };
    }
  }
});

// ── Quality metrics ─────────────────────────────────────────────────────────

const overlaps = (expected, passage) => passage.start <= expected.end && expected.start <= passage.end;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const quantile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.round(p * (s.length - 1))];
};

const baseline = CONFIGS[0];
const indicesOf = (kind) => queries.flatMap((q, i) => (kind(q) ? [i] : []));
const realQueries = indicesOf((q) => q.kind !== 'junk');
const junkQueries = indicesOf((q) => q.kind === 'junk');
const judgedQueries = indicesOf((q) => q.kind === 'judged');

const summary = CONFIGS.map((config) => {
  const overlapAt = (k) =>
    realQueries.map((q) => {
      const baseSet = new Set(baseline.top[q].idx.slice(0, k));
      return config.top[q].idx.slice(0, k).filter((p) => baseSet.has(p)).length / k;
    });
  const o10 = overlapAt(10);
  const o20 = overlapAt(20);

  let r10 = 0, r20 = 0, any10 = 0, mrr = 0;
  const perCategory = {};
  for (const q of judgedQueries) {
    const { expected, category } = queries[q];
    const ranked = config.top[q].idx.map((p) => passages[p]);
    const primaryRank = ranked.findIndex((p) => expected.some((e) => e.tier === 'primary' && overlaps(e, p)));
    const anyRank = ranked.findIndex((p) => expected.some((e) => overlaps(e, p)));
    const hit10 = primaryRank >= 0 && primaryRank < 10;
    if (hit10) r10++;
    if (primaryRank >= 0) { r20++; mrr += 1 / (primaryRank + 1); }
    if (anyRank >= 0 && anyRank < 10) any10++;
    perCategory[category] ??= { n: 0, r10: 0 };
    perCategory[category].n++;
    if (hit10) perCategory[category].r10++;
  }
  const nJ = judgedQueries.length;
  const top1 = (qs) => qs.map((q) => config.top[q].score[0]);
  const top20 = (qs) => qs.map((q) => config.top[q].score[TOP_K - 1]);
  return {
    name: config.name,
    overlap10: { mean: mean(o10), min: Math.min(...o10) },
    overlap20: { mean: mean(o20), min: Math.min(...o20) },
    judged: { n: nJ, recall10: r10 / nJ, recall20: r20 / nJ, mrr20: mrr / nJ, anyTierRecall10: any10 / nJ },
    perCategoryRecall10: Object.fromEntries(Object.entries(perCategory).map(([c, v]) => [c, v.r10 / v.n])),
    scores: {
      realTop1: { p05: quantile(top1(realQueries), 0.05), p50: quantile(top1(realQueries), 0.5) },
      real20th: { p05: quantile(top20(realQueries), 0.05), p10: quantile(top20(realQueries), 0.1), p50: quantile(top20(realQueries), 0.5) },
      junkTop1: { p50: quantile(top1(junkQueries), 0.5), max: Math.max(...top1(junkQueries)) },
      junk20th: { p50: quantile(top20(junkQueries), 0.5), max: Math.max(...top20(junkQueries)) },
    },
  };
});

const pct = (x) => (x * 100).toFixed(1).padStart(5);
const f3 = (x) => x.toFixed(3);
console.log(`\nfp32 vs q8 query model: cosine mean ${f3(mean(modelCosines))}, min ${f3(Math.min(...modelCosines))}`);
console.log('\n=== Quality vs baseline (overlap over real queries; judged recall on primary answers) ===');
console.log('config                  ov@10 mean/min   ov@20 mean/min   R@10   R@20  MRR@20  any@10');
for (const s of summary) {
  console.log(
    `${s.name.padEnd(22)} ${pct(s.overlap10.mean)} /${pct(s.overlap10.min)}   ${pct(s.overlap20.mean)} /${pct(s.overlap20.min)}  ` +
    `${pct(s.judged.recall10)}  ${pct(s.judged.recall20)}  ${f3(s.judged.mrr20)}  ${pct(s.judged.anyTierRecall10)}`
  );
}
console.log('\nRecall@10 by category:');
const categories = Object.keys(summary[0].perCategoryRecall10);
console.log(`${''.padEnd(22)} ${categories.map((c) => c.slice(0, 12).padStart(12)).join(' ')}`);
for (const s of summary) {
  console.log(`${s.name.padEnd(22)} ${categories.map((c) => pct(s.perCategoryRecall10[c]).padStart(12)).join(' ')}`);
}

// ── Score scale and threshold calibration ───────────────────────────────────

console.log('\n=== Score scale (passage scores) ===');
console.log('config                 realTop1 p05/p50   real20th p05/p10/p50   junkTop1 p50/max   junk20th p50/max');
for (const s of summary) {
  const { realTop1, real20th, junkTop1, junk20th } = s.scores;
  console.log(
    `${s.name.padEnd(22)} ${f3(realTop1.p05)}/${f3(realTop1.p50)}        ${f3(real20th.p05)}/${f3(real20th.p10)}/${f3(real20th.p50)}      ` +
    `${f3(junkTop1.p50)}/${f3(junkTop1.max)}        ${f3(junk20th.p50)}/${f3(junk20th.max)}`
  );
}

/** Of the 20 results the reader would show, how many clear the threshold. */
const survivors = (config, q, threshold) => config.top[q].score.filter((s) => s >= threshold).length;
const thresholdRow = (config, threshold) => {
  const real = realQueries.map((q) => survivors(config, q, threshold));
  const junk = junkQueries.map((q) => survivors(config, q, threshold));
  return {
    threshold,
    realMean: mean(real),
    realFull: real.filter((n) => n === TOP_K).length / real.length,
    realEmpty: real.filter((n) => n === 0).length / real.length,
    junkMean: mean(junk),
    junkEmpty: junk.filter((n) => n === 0).length / junk.length,
  };
};

const base03 = thresholdRow(baseline, BASELINE_THRESHOLD);
console.log(
  `\nBaseline @${BASELINE_THRESHOLD}: real queries keep ${base03.realMean.toFixed(1)}/20 results (${pct(base03.realFull)}% full), ` +
  `off-topic keep ${base03.junkMean.toFixed(1)}/20 (${pct(base03.junkEmpty)}% empty)`
);
console.log('Suggested threshold = highest value at which real queries still keep >= 19/20 results on average.');

const calibration = {};
for (const config of CONFIGS) {
  const rows = [];
  for (let t = 0; t <= 0.9001; t += 0.005) rows.push(thresholdRow(config, Math.round(t * 1000) / 1000));
  const suggested = rows.filter((r) => r.realMean >= 19).at(-1);
  calibration[config.name] = { suggested: suggested?.threshold ?? null, rows };
  console.log(`\n${config.name}: suggested ${suggested?.threshold}`);
  console.log('  thr    real kept  real full  real empty | junk kept  junk empty');
  for (const r of rows.filter((r) => suggested && Math.abs(r.threshold - suggested.threshold) <= 0.0601 && Math.round(r.threshold * 1000) % 10 === 0)) {
    console.log(
      `  ${r.threshold.toFixed(2)}   ${r.realMean.toFixed(1).padStart(8)}   ${pct(r.realFull)}     ${pct(r.realEmpty)}   | ` +
      `${r.junkMean.toFixed(1).padStart(8)}    ${pct(r.junkEmpty)}`
    );
  }
}

console.log('\nOff-topic queries, top-1 / 20th passage score:');
console.log(`${''.padEnd(38)} ${CONFIGS.map((c) => c.name.slice(0, 13).padStart(13)).join(' ')}`);
for (const q of junkQueries) {
  const cells = CONFIGS.map((c) => `${f3(c.top[q].score[0])}/${f3(c.top[q].score[TOP_K - 1])}`.padStart(13));
  console.log(`${queries[q].text.slice(0, 38).padEnd(38)} ${cells.join(' ')}`);
}

fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
fs.writeFileSync(
  resultsPath,
  JSON.stringify({
    generated: new Date().toISOString(),
    queryCounts: { judged: judged.length, extra: EXTRA_QUERIES.length, junk: JUNK_QUERIES.length },
    queryModelCosine: { mean: mean(modelCosines), min: Math.min(...modelCosines) },
    baselineAt03: base03,
    summary,
    calibration,
    passages: passageKeys,
    perQuery: queries.map((q, i) => ({
      text: q.text,
      kind: q.kind,
      top: Object.fromEntries(CONFIGS.map((c) => [c.name, c.top[i]])),
    })),
  })
);
console.log(`\nResults written to ${resultsPath} (${elapsed()})`);
