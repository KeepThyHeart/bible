#!/usr/bin/env node
/**
 * Builds the compact semantic index shipped in the semantic-search feature pack.
 *
 * Reads the full 768-dim float32 nomic-embed-text-v1.5 index and writes a
 * reduced-dimension int8 copy that keeps every row (facet rows included)
 * in source order, drops the columns the reader never uses, and carries the
 * metadata the reader needs to transform queries the same way.
 *
 * Usage:
 *   node scripts/semantic/build-compact-index.mjs --source=<semantic_nomic-v1.5.db> --min-similarity=0.6 \
 *     [--out=data/semantic-build/semantic_index.db] [--dims=256] [--center=none|corpus] [--force]
 *
 * The shipped pack was built with --dims=256 --center=none --min-similarity=0.6.
 * The full-width source index is not part of this repository.
 *
 * --center=corpus subtracts the mean of all of the index's own D-dim document
 * vectors (computed in a first streaming pass) and stores it as mean_vector.
 * --min-similarity is the threshold calibrated by evaluate-compact-index.mjs
 * for the chosen dims/centering; it is required because it depends on both.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  MODEL_ID,
  QUERY_PREFIX,
  SOURCE_DIM,
  VECTOR_SCALE,
  blobToFloat32,
  computeCorpusMeans,
  mb,
  parseArgs,
  quantiseInt8,
  roundMean,
  transformVector,
} from './lib/vector-transform.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'data', 'semantic-build', 'semantic_index.db');
const INDEX_FORMAT = '2';
const QUERY_MODEL_DTYPE = 'q8';
const BATCH_SIZE = 10000;

const args = parseArgs(process.argv.slice(2));
if (!args.source) throw new Error('--source=<full-width semantic index .db> is required');
const sourcePath = path.resolve(args.source);
const outPath = path.resolve(args.out ?? DEFAULT_OUT);
const dims = Number(args.dims ?? 256);
const center = args.center ?? 'none';
const minSimilarity = args['min-similarity'];

if (!Number.isInteger(dims) || dims < 16 || dims > SOURCE_DIM) {
  throw new Error(`--dims must be an integer between 16 and ${SOURCE_DIM}`);
}
if (center !== 'none' && center !== 'corpus') {
  throw new Error('--center must be "none" or "corpus"');
}
if (minSimilarity === undefined || Number.isNaN(Number(minSimilarity))) {
  throw new Error('--min-similarity=<number> is required (calibrate it with evaluate-compact-index.mjs)');
}
if (!fs.existsSync(sourcePath)) {
  throw new Error(`Source index not found: ${sourcePath}`);
}
if (fs.existsSync(outPath)) {
  if (!args.force) throw new Error(`Output exists: ${outPath} (use --force to overwrite)`);
  fs.rmSync(outPath);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

let mean = null;
if (center === 'corpus') {
  console.log(`Pass 1: computing corpus mean of ${dims}-dim document vectors...`);
  mean = roundMean(computeCorpusMeans(sourcePath, [dims]).get(dims));
  const meanNorm = Math.sqrt(mean.reduce((s, v) => s + v * v, 0));
  console.log(`  mean norm ${meanNorm.toFixed(4)} (${elapsed()})`);
}

const src = new DatabaseSync(sourcePath, { readOnly: true });
const sourceDim = src.prepare("SELECT value FROM index_metadata WHERE key = 'embedding_dim'").get();
if (Number(sourceDim?.value) !== SOURCE_DIM) {
  throw new Error(`Source embedding_dim is ${sourceDim?.value}, expected ${SOURCE_DIM}`);
}
const totalRows = src.prepare('SELECT COUNT(*) AS c FROM semantic_embeddings').get().c;

const out = new DatabaseSync(outPath);
// The output is a disposable build artifact, so durability is irrelevant until
// the final VACUUM rewrites it.
out.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
out.exec(`
  CREATE TABLE semantic_embeddings (
    id TEXT NOT NULL,
    level TEXT NOT NULL CHECK(level IN ('verse', 'paragraph', 'chapter')),
    start_verse_id INTEGER NOT NULL,
    end_verse_id INTEGER NOT NULL,
    text_preview TEXT,
    embedding_blob BLOB NOT NULL
  );
  CREATE TABLE index_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// paragraph_divisions is copied with its original DDL (table and indexes).
const paragraphSchema = src
  .prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'paragraph_divisions' AND sql IS NOT NULL ORDER BY type DESC")
  .all();
for (const { sql } of paragraphSchema) out.exec(sql);
const paragraphRows = src.prepare('SELECT * FROM paragraph_divisions ORDER BY rowid').all();
const paragraphColumns = Object.keys(paragraphRows[0]);
const insertParagraph = out.prepare(
  `INSERT INTO paragraph_divisions (${paragraphColumns.join(', ')}) VALUES (${paragraphColumns.map(() => '?').join(', ')})`
);
out.exec('BEGIN');
for (const row of paragraphRows) insertParagraph.run(...paragraphColumns.map((c) => row[c]));
out.exec('COMMIT');
console.log(`Copied ${paragraphRows.length} paragraph divisions.`);

console.log(`${center === 'corpus' ? 'Pass 2' : 'Pass 1'}: writing ${totalRows.toLocaleString()} rows as ${dims}-dim int8...`);
const insertRow = out.prepare(
  'INSERT INTO semantic_embeddings (id, level, start_verse_id, end_verse_id, text_preview, embedding_blob) VALUES (?, ?, ?, ?, ?, ?)'
);
const transformed = new Float64Array(dims);
const quantised = new Int8Array(dims);
const quantisedBytes = new Uint8Array(quantised.buffer);
let written = 0;
let clipped = 0;
out.exec('BEGIN');
const rows = src
  .prepare('SELECT id, level, start_verse_id, end_verse_id, text_preview, embedding_blob FROM semantic_embeddings ORDER BY rowid')
  .iterate();
for (const row of rows) {
  transformVector(blobToFloat32(row.embedding_blob), transformed, mean);
  quantiseInt8(transformed, quantised);
  for (let i = 0; i < dims; i++) {
    if (Math.abs(transformed[i] * VECTOR_SCALE) > VECTOR_SCALE) clipped++;
  }
  insertRow.run(row.id, row.level, row.start_verse_id, row.end_verse_id, row.text_preview, quantisedBytes);
  written++;
  if (written % BATCH_SIZE === 0) {
    out.exec('COMMIT');
    out.exec('BEGIN');
    process.stdout.write(`\r  ${written.toLocaleString()} / ${totalRows.toLocaleString()} (${elapsed()})`);
  }
}
out.exec('COMMIT');
process.stdout.write(`\r  ${written.toLocaleString()} / ${totalRows.toLocaleString()} (${elapsed()})\n`);
if (written !== totalRows) throw new Error(`Wrote ${written} rows but the source has ${totalRows}`);

const metadata = [
  ['index_format', INDEX_FORMAT],
  ['embedding_model', MODEL_ID],
  ['embedding_dim', String(dims)],
  ['vector_encoding', 'int8'],
  ['vector_scale', String(VECTOR_SCALE)],
  ...(mean ? [['mean_vector', JSON.stringify(mean)]] : []),
  ['query_model', MODEL_ID],
  ['query_model_dtype', QUERY_MODEL_DTYPE],
  ['query_prefix', QUERY_PREFIX],
  ['min_similarity', String(Number(minSimilarity))],
  ['source_index', path.basename(sourcePath)],
  ['source_dim', String(SOURCE_DIM)],
  ['last_build_date', new Date().toISOString()],
];
const insertMeta = out.prepare('INSERT INTO index_metadata (key, value) VALUES (?, ?)');
for (const [key, value] of metadata) insertMeta.run(key, value);
src.close();

console.log(`Vacuuming... (${elapsed()})`);
out.exec('VACUUM');
out.close();

const gzPath = `${outPath}.gz`;
await streamPipeline(fs.createReadStream(outPath), zlib.createGzip({ level: 9 }), fs.createWriteStream(gzPath));

console.log(`\nDone in ${elapsed()}.`);
console.log(`  rows: ${written.toLocaleString()}  dims: ${dims}  center: ${center}  clipped components: ${clipped}`);
console.log(`  ${outPath}: ${mb(fs.statSync(outPath).size)} (${fs.statSync(outPath).size} bytes)`);
console.log(`  ${gzPath} (gzip -9): ${mb(fs.statSync(gzPath).size)} (${fs.statSync(gzPath).size} bytes)`);
console.log('  index_metadata:');
for (const [key, value] of metadata) {
  console.log(`    ${key} = ${value.length > 80 ? `${value.slice(0, 77)}...` : value}`);
}
