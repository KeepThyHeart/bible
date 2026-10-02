#!/usr/bin/env node
/**
 * Builds the "similar passages" neighbour table (format SNB1) from a semantic index (task 0070).
 *
 * For every verse key and every paragraph key it takes the key's own stored index rows as queries
 * (as the live service does: rows inside the key range, capped at maxQueryVectors by closeness to
 * their centroid, keeping one row per kind), scans ALL rows, aggregates with the core ranking
 * (`aggregateHits`), drops the key itself and +-2 verses around it, and keeps the top K.
 *
 * Usage:
 *   pnpm build:core   # the script imports ranking and the table encoder from packages/core/dist
 *   node scripts/semantic/build-neighbour-table.mjs --source=<semantic index .db>
 *     [--text-source=<db>]        same schema; every row is kind 'text' whatever its id (raw-text experiment)
 *     [--dims=768]                vector dims used (truncate + renormalise; int8 sources are dequantised)
 *     [--weights=<json file>]     SimilarWeights override (see core SimilarWeights.ts)
 *     [--k=30] [--floor=<n>]      neighbours per key; neighbourFloor (default: 20th percentile of rank-20 scores)
 *     [--out=data/semantic-build/similar/table.bin]   also writes <out>.gz
 *     [--asset-dir=<assets root> --version=1.YYYYMMDD --license=<text>]
 *                                 also writes <root>/v1/data/similar-neighbours/<version>/{table.bin.gz,asset.json}
 *     [--inspect]                 print row kinds per level (id shapes, samples) and exit
 *     [--limit=<n keys>]          build an evenly spaced sample of n keys (quick runs)
 *     [--workers=N]               accepted but ignored: the scan is single-threaded
 *
 * Memory: the (level verse|paragraph) vectors of the source (and text source) are held once as a
 * Float32Array of rows x dims (768 dims ~ 1.2 GB for 388K rows; use --dims=256 to shrink). Queries
 * are processed in batches and the matrix is scanned in cache-sized row blocks. Cost is
 * rows x queries x dims multiply-adds: a full 768-d build is an overnight job; use --limit first.
 * Keys come from the distinct verse/paragraph row ranges of --source (paragraph_divisions is not needed).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { blobToFloat32, mb, parseArgs, transformVector } from './lib/vector-transform.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = parseArgs(process.argv.slice(2));
if (!args.source) throw new Error('--source=<semantic index .db> is required');
const sourcePath = path.resolve(args.source);
const textSourcePath = args['text-source'] ? path.resolve(args['text-source']) : null;
const dims = Number(args.dims ?? 768);
const K = Number(args.k ?? 30);
const outPath = path.resolve(args.out ?? path.join(REPO_ROOT, 'data', 'semantic-build', 'similar', 'table.bin'));
const limit = args.limit ? Number(args.limit) : Infinity;
const assetDir = args['asset-dir'] ? path.resolve(args['asset-dir']) : null;
const EXCLUDE_WINDOW = 2;
const LEVELS = ['verse', 'paragraph'];
const TEXT_PREFIX = 'txt|';
const SCAN_BLOCK = 512;
const KEY_BATCH = 64; // keys per scan pass (<= 64 x maxQueryVectors queries)

if (!Number.isInteger(dims) || dims < 16) throw new Error('--dims must be an integer >= 16');
if (!Number.isInteger(K) || K < 1 || K > 255) throw new Error('--k must be an integer 1..255');
if (args.workers && Number(args.workers) > 1) console.warn('Note: --workers is ignored; the scan is single-threaded.');
if (assetDir && !args.license) throw new Error('--license=<text> is required with --asset-dir (no default)');
for (const p of [sourcePath, textSourcePath].filter(Boolean)) {
  if (!fs.existsSync(p)) throw new Error(`Database not found: ${p}`);
}

let core;
try {
  core = createRequire(import.meta.url)(path.join(REPO_ROOT, 'packages', 'core', 'dist', 'index.js'));
} catch (error) {
  throw new Error(`Cannot load packages/core/dist (run \`pnpm build:core\` first): ${error.message}`);
}
const { aggregateHits, resolveSimilarWeights, compileKindClassifier, similarWeightsHash, encodeNeighbourTable } = core;
for (const [name, fn] of Object.entries({ aggregateHits, resolveSimilarWeights, compileKindClassifier, similarWeightsHash, encodeNeighbourTable })) {
  if (typeof fn !== 'function') throw new Error(`core dist does not export ${name} (rebuild core)`);
}

const weightsOverride = args.weights ? JSON.parse(fs.readFileSync(path.resolve(args.weights), 'utf8')) : undefined;
const weights = resolveSimilarWeights(weightsOverride);
const baseClassify = compileKindClassifier(weights);
const classify = (id) => (id.startsWith(TEXT_PREFIX) ? 'text' : baseClassify(id));

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
const levelPlaceholders = LEVELS.map(() => '?').join(',');

// --- --inspect --------------------------------------------------------------------

function inspectDb(label, dbPath, forceText) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  console.log(`\n== ${label}: ${dbPath}`);
  for (const r of db.prepare('SELECT key, value FROM index_metadata').all()) {
    console.log(`  meta ${r.key} = ${String(r.value).slice(0, 60)}`);
  }
  const shape = (id) => id.replace(/\d+/g, '#').replace(/[A-Za-z]+/g, 'a');
  for (const level of ['verse', 'paragraph', 'chapter']) {
    const hist = new Map();
    let total = 0;
    for (const row of db.prepare('SELECT id, text_preview FROM semantic_embeddings WHERE level = ?').iterate(level)) {
      total++;
      const kind = forceText ? 'text' : baseClassify(String(row.id));
      const key = `${kind} ${shape(String(row.id))}`;
      let e = hist.get(key);
      if (!e) hist.set(key, (e = { n: 0, samples: [] }));
      e.n++;
      if (e.samples.length < 5) e.samples.push(`${row.id} | ${String(row.text_preview ?? '').replace(/\s+/g, ' ').slice(0, 70)}`);
    }
    console.log(`  level ${level}: ${total.toLocaleString()} rows`);
    for (const [key, e] of [...hist].sort((a, b) => b[1].n - a[1].n).slice(0, 12)) {
      console.log(`    [${key}] x${e.n.toLocaleString()}`);
      for (const s of e.samples) console.log(`       ${s}`);
    }
  }
  db.close();
}

if (args.inspect) {
  console.log(`weights hash ${similarWeightsHash(weights)}; kind rules: ${JSON.stringify(weights.kindRules)}`);
  inspectDb('source', sourcePath, false);
  if (textSourcePath) inspectDb('text source (all rows kind text)', textSourcePath, true);
  process.exit(0);
}

// --- Load vectors -----------------------------------------------------------------

function metaValue(db, key) {
  return db.prepare('SELECT value FROM index_metadata WHERE key = ?').get(key)?.value;
}

function countRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const n = db.prepare(`SELECT COUNT(*) AS c FROM semantic_embeddings WHERE level IN (${levelPlaceholders})`).get(...LEVELS).c;
  db.close();
  return n;
}

const sourceRows = countRows(sourcePath);
const textRows = textSourcePath ? countRows(textSourcePath) : 0;
const total = sourceRows + textRows;
console.log(`${sourceRows.toLocaleString()} source rows${textSourcePath ? ` + ${textRows.toLocaleString()} text rows` : ''}; ` +
  `matrix ${mb(total * dims * 4)} at ${dims} dims`);

const matrix = new Float32Array(total * dims);
const rowId = new Array(total);
const rowLevel = new Uint8Array(total); // 0 verse, 1 paragraph
const rowStart = new Int32Array(total);
const rowEnd = new Int32Array(total);
let loaded = 0;
let sourceDimsSeen = 0;

function loadDb(dbPath, prefix) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const encoding = metaValue(db, 'vector_encoding') ?? 'float32';
  const int8 = encoding === 'int8';
  const scale = Number(metaValue(db, 'vector_scale') ?? 127);
  const out = new Float64Array(dims);
  const tmp = int8 ? new Float32Array(dims) : null;
  const stmt = db.prepare(
    `SELECT id, level, start_verse_id, end_verse_id, embedding_blob FROM semantic_embeddings WHERE level IN (${levelPlaceholders}) ORDER BY start_verse_id, end_verse_id, rowid`
  );
  for (const row of stmt.iterate(...LEVELS)) {
    let vec;
    if (int8) {
      const i8 = new Int8Array(row.embedding_blob.buffer, row.embedding_blob.byteOffset, row.embedding_blob.byteLength);
      if (i8.length < dims) throw new Error(`${dbPath}: row has ${i8.length} dims, --dims=${dims}`);
      for (let i = 0; i < dims; i++) tmp[i] = i8[i] / scale;
      vec = tmp;
      sourceDimsSeen = i8.length;
    } else {
      vec = blobToFloat32(row.embedding_blob);
      if (vec.length < dims) throw new Error(`${dbPath}: row has ${vec.length} dims, --dims=${dims}`);
      sourceDimsSeen = vec.length;
    }
    transformVector(vec, out, null);
    matrix.set(out, loaded * dims);
    rowId[loaded] = prefix + row.id;
    rowLevel[loaded] = row.level === 'verse' ? 0 : 1;
    rowStart[loaded] = row.start_verse_id;
    rowEnd[loaded] = row.end_verse_id;
    loaded++;
    if (loaded % 20000 === 0) process.stdout.write(`\r  loaded ${loaded.toLocaleString()} / ${total.toLocaleString()} (${elapsed()})`);
  }
  db.close();
}
loadDb(sourcePath, '');
if (textSourcePath) loadDb(textSourcePath, TEXT_PREFIX);
process.stdout.write(`\r  loaded ${loaded.toLocaleString()} / ${total.toLocaleString()} (${elapsed()})\n`);
if (loaded !== total) throw new Error(`Loaded ${loaded} rows, expected ${total}`);

// Row order for range lookup: indices sorted by start verse.
const byStart = Int32Array.from({ length: total }, (_, i) => i).sort((a, b) => rowStart[a] - rowStart[b] || rowEnd[a] - rowEnd[b]);
const sortedStarts = Int32Array.from(byStart, (i) => rowStart[i]);

// --- Keys -------------------------------------------------------------------------

const keyMap = new Map();
for (let i = 0; i < sourceRows; i++) {
  const k = `${rowLevel[i]}|${rowStart[i]}|${rowEnd[i]}`;
  if (!keyMap.has(k)) keyMap.set(k, { level: rowLevel[i] === 0 ? 'verse' : 'paragraph', start: rowStart[i], end: rowEnd[i] });
}
let keys = [...keyMap.values()].sort((a, b) => a.start - b.start || a.end - b.end || (a.level < b.level ? 1 : -1));
const keyCountAll = keys.length;
if (keys.length > limit) {
  const stride = keys.length / limit;
  keys = Array.from({ length: limit }, (_, i) => keys[Math.floor(i * stride)]);
}
console.log(`${keyCountAll.toLocaleString()} keys (${keys.filter((k) => k.level === 'verse').length} verse, ` +
  `${keys.filter((k) => k.level === 'paragraph').length} paragraph in this run)`);

function lowerBound(arr, value) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Rows whose range lies inside the key, capped like the runtime: by closeness to the centroid, one row per kind kept. */
function queryRowsFor(key) {
  const inside = [];
  for (let p = lowerBound(sortedStarts, key.start); p < total && sortedStarts[p] <= key.end; p++) {
    const r = byStart[p];
    if (rowEnd[r] <= key.end) inside.push(r);
  }
  const cap = weights.maxQueryVectors;
  if (inside.length <= cap) return inside;
  const centroid = new Float64Array(dims);
  for (const r of inside) for (let d = 0; d < dims; d++) centroid[d] += matrix[r * dims + d];
  const closeness = new Map();
  for (const r of inside) {
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += matrix[r * dims + d] * centroid[d];
    closeness.set(r, dot);
  }
  inside.sort((a, b) => closeness.get(b) - closeness.get(a));
  const chosen = new Set();
  const seenKinds = new Set();
  for (const r of inside) {
    const kind = classify(rowId[r]);
    if (!seenKinds.has(kind)) {
      seenKinds.add(kind);
      chosen.add(r);
    }
  }
  for (const r of inside) {
    if (chosen.size >= cap) break;
    chosen.add(r);
  }
  return [...chosen];
}

// --- Scan -------------------------------------------------------------------------

const topN = weights.perQueryTopK;
const LEVEL_NAMES = ['verse', 'paragraph'];

/** Top `topN` rows per query vector over all rows; `qm` holds nq unit vectors row-major. */
function scanBatch(qm, nq) {
  const scores = Array.from({ length: nq }, () => new Float32Array(topN).fill(-2));
  const idxs = Array.from({ length: nq }, () => new Int32Array(topN));
  const minScore = new Float32Array(nq).fill(-2);
  const minPos = new Int32Array(nq);
  for (let b0 = 0; b0 < total; b0 += SCAN_BLOCK) {
    const b1 = Math.min(total, b0 + SCAN_BLOCK);
    for (let q = 0; q < nq; q++) {
      const qo = q * dims;
      const sc = scores[q];
      let thr = minScore[q];
      for (let r = b0; r < b1; r++) {
        const ro = r * dims;
        let dot = 0;
        for (let d = 0; d < dims; d++) dot += qm[qo + d] * matrix[ro + d];
        if (dot > thr) {
          const pos = minPos[q];
          sc[pos] = dot;
          idxs[q][pos] = r;
          let m = 0;
          for (let i = 1; i < topN; i++) if (sc[i] < sc[m]) m = i;
          minPos[q] = m;
          thr = sc[m];
          minScore[q] = thr;
        }
      }
    }
  }
  return scores.map((sc, q) => {
    const order = Array.from({ length: topN }, (_, i) => i).filter((i) => sc[i] > -2).sort((a, b) => sc[b] - sc[a]);
    return order.map((i) => {
      const r = idxs[q][i];
      return { id: rowId[r], level: LEVEL_NAMES[rowLevel[r]], startVerseId: rowStart[r], endVerseId: rowEnd[r], similarity: sc[i] };
    });
  });
}

function processBatch(batch) {
  const queryPlans = batch.map((key) => ({ key, rows: queryRowsFor(key) }));
  const nq = queryPlans.reduce((s, p) => s + p.rows.length, 0);
  const qm = new Float32Array(nq * dims);
  let at = 0;
  for (const plan of queryPlans) {
    for (const r of plan.rows) {
      qm.set(matrix.subarray(r * dims, (r + 1) * dims), at * dims);
      at++;
    }
  }
  const hits = nq ? scanBatch(qm, nq) : [];
  const results = [];
  at = 0;
  for (const { key, rows } of queryPlans) {
    if (!rows.length) continue;
    const queries = rows.map((r, i) => ({
      id: rowId[r],
      kind: classify(rowId[r]),
      level: LEVEL_NAMES[rowLevel[r]],
      vector: qm.subarray((at + i) * dims, (at + i + 1) * dims),
    }));
    const agg = aggregateHits(queries, hits.slice(at, at + rows.length), classify, weights);
    at += rows.length;
    const neighbours = agg
      .filter((h) => !(h.startVerseId <= key.end + EXCLUDE_WINDOW && h.endVerseId >= key.start - EXCLUDE_WINDOW))
      .slice(0, K);
    results.push({ key: { startVerseId: key.start, endVerseId: key.end, level: key.level }, neighbours });
  }
  return results;
}

const results = [];
let batch = [];
let done = 0;
const flush = () => {
  if (!batch.length) return;
  results.push(...processBatch(batch));
  done += batch.length;
  batch = [];
  process.stdout.write(`\r  ${done.toLocaleString()} / ${keys.length.toLocaleString()} keys (${elapsed()})`);
};
for (const key of keys) {
  batch.push(key);
  if (batch.length >= KEY_BATCH) flush();
}
flush();
process.stdout.write('\n');

// --- Table ------------------------------------------------------------------------

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
}
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(4) : 'n/a');

let scoreMin = Infinity;
let scoreMax = -Infinity;
const rank1 = [];
const rank20 = [];
for (const r of results) {
  for (const n of r.neighbours) {
    if (n.score < scoreMin) scoreMin = n.score;
    if (n.score > scoreMax) scoreMax = n.score;
  }
  if (r.neighbours.length) rank1.push(r.neighbours[0].score);
  if (r.neighbours.length >= 20) rank20.push(r.neighbours[19].score);
}
if (!Number.isFinite(scoreMin)) throw new Error('No neighbours produced (empty index or no rows inside any key)');
if (scoreMax - scoreMin < 1e-6) scoreMax = scoreMin + 1e-6;
rank1.sort((a, b) => a - b);
rank20.sort((a, b) => a - b);
const floor = args.floor !== undefined ? Number(args.floor) : percentile(rank20, 20);
if (!Number.isFinite(floor)) throw new Error('Cannot derive neighbourFloor (fewer than 20 neighbours for every key); pass --floor');

const weightsHash = similarWeightsHash(weights);
const meta = {
  neighbourFloor: floor,
  scoreMin,
  scoreMax,
  k: K,
  levels: LEVELS,
  excludeWindow: EXCLUDE_WINDOW,
  weights,
  weightsHash,
  sourceIndex: path.basename(sourcePath),
  sourceDims: dims,
  ...(textSourcePath ? { textSource: path.basename(textSourcePath) } : {}),
  builtAt: new Date().toISOString(),
  builder: 'build-neighbour-table.mjs@1',
};
const bytes = encodeNeighbourTable(meta, results);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, bytes);
const gz = zlib.gzipSync(bytes, { level: 9 });
fs.writeFileSync(`${outPath}.gz`, gz);

console.log(`\nDone in ${elapsed()}.`);
console.log(`  keys ${results.length.toLocaleString()}  K ${K}  dims ${dims}  weights ${weightsHash}`);
console.log(`  ${outPath}: ${mb(bytes.byteLength)} (${bytes.byteLength} bytes)`);
console.log(`  ${outPath}.gz: ${mb(gz.byteLength)} (${gz.byteLength} bytes)`);
console.log(`  score range ${fmt(scoreMin)} .. ${fmt(scoreMax)}`);
console.log(`  rank-1  p10/p50/p90: ${fmt(percentile(rank1, 10))} / ${fmt(percentile(rank1, 50))} / ${fmt(percentile(rank1, 90))}`);
console.log(`  rank-20 p10/p20/p50/p90 (${rank20.length} keys): ${fmt(percentile(rank20, 10))} / ${fmt(percentile(rank20, 20))} / ${fmt(percentile(rank20, 50))} / ${fmt(percentile(rank20, 90))}`);
console.log(`  neighbourFloor ${fmt(floor)} ${args.floor !== undefined ? '(--floor)' : '(20th percentile of rank-20; calibrate with evaluate-neighbours.mjs)'}`);

if (assetDir) {
  const version = String(args.version ?? `1.${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
  const dir = path.join(assetDir, 'v1', 'data', 'similar-neighbours', version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'table.bin.gz'), gz);
  fs.writeFileSync(
    path.join(dir, 'asset.json'),
    JSON.stringify(
      {
        title: 'Similar passages data',
        description: 'Precomputed similar-passage neighbours for every verse and paragraph, derived from the semantic search embeddings.',
        license: String(args.license),
        meta: { format: 'SNB1', weightsHash, sourceDims: dims },
      },
      null,
      2
    ) + '\n'
  );
  console.log(`  asset: ${dir}`);
  console.log(`  next: node apps/web/scripts/build-asset-index.mjs --dir=${assetDir}`);
}
