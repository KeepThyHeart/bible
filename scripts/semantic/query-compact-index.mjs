#!/usr/bin/env node
/**
 * Runs queries end-to-end against a built compact semantic index, the way the
 * reader will: every transform parameter comes from index_metadata, the query
 * is embedded with the q8 model, and each row scores dot(query, int8) / scale.
 * Rows are collapsed to passages (level + start + end, best score) and the top
 * results are printed with their references and previews.
 *
 * The transform is written out here from the metadata rather than imported
 * from the builder, so this doubles as a check that the stored metadata alone
 * is enough to reproduce the builder's scoring.
 *
 * Usage:
 *   node scripts/semantic/query-compact-index.mjs [--index=data/semantic-build/semantic_index.db]
 *     [--models=apps/web/data/models] [--top=5] [--levels=verse,paragraph] "query one" "query two" ...
 */

import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOOKS = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1 Sam', '2 Sam', '1 Kgs', '2 Kgs', '1 Chr', '2 Chr',
  'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel',
  'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal', 'Matt', 'Mark', 'Luke', 'John',
  'Acts', 'Rom', '1 Cor', '2 Cor', 'Gal', 'Eph', 'Phil', 'Col', '1 Thess', '2 Thess', '1 Tim', '2 Tim', 'Titus',
  'Phlm', 'Heb', 'Jas', '1 Pet', '2 Pet', '1 John', '2 John', '3 John', 'Jude', 'Rev',
];

const options = {};
const texts = [];
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(arg);
  if (match) options[match[1]] = match[2];
  else texts.push(arg);
}
const indexPath = path.resolve(options.index ?? path.join(REPO_ROOT, 'data', 'semantic-build', 'semantic_index.db'));
const modelsPath = path.resolve(options.models ?? path.join(REPO_ROOT, 'apps', 'web', 'data', 'models'));
const topN = Number(options.top ?? 5);
const levels = new Set((options.levels ?? 'verse,paragraph').split(','));
if (texts.length === 0) texts.push('God so loved the world', 'anxiety and worry', 'David and Goliath', 'forgiving those who wrong us');

function reference(start, end) {
  const split = (id) => ({ book: Math.floor(id / 1000000), chapter: Math.floor(id / 1000) % 1000, verse: id % 1000 });
  const a = split(start);
  const b = split(end);
  const head = `${BOOKS[a.book - 1]} ${a.chapter}:${a.verse}`;
  if (start === end) return head;
  if (a.book === b.book && a.chapter === b.chapter) return `${head}-${b.verse}`;
  return `${head}-${b.chapter}:${b.verse}`;
}

const db = new DatabaseSync(indexPath, { readOnly: true });
const meta = Object.fromEntries(db.prepare('SELECT key, value FROM index_metadata').all().map((r) => [r.key, r.value]));
const dims = Number(meta.embedding_dim);
const scale = Number(meta.vector_scale);
const mean = meta.mean_vector ? JSON.parse(meta.mean_vector) : null;
const minSimilarity = Number(meta.min_similarity);
if (meta.vector_encoding !== 'int8') throw new Error(`Unexpected vector_encoding ${meta.vector_encoding}`);
console.log(`Index: ${dims}d int8, scale ${scale}, centered ${mean !== null}, min_similarity ${minSimilarity}`);

const loadStart = Date.now();
const rows = db.prepare('SELECT level, start_verse_id, end_verse_id, text_preview, embedding_blob FROM semantic_embeddings').all();
db.close();
const vectors = new Int8Array(rows.length * dims);
rows.forEach((row, r) => {
  if (row.embedding_blob.byteLength !== dims) throw new Error(`Row ${r} has a ${row.embedding_blob.byteLength}-byte vector`);
  vectors.set(new Int8Array(row.embedding_blob.buffer, row.embedding_blob.byteOffset, dims), r * dims);
});
console.log(`Loaded ${rows.length.toLocaleString()} rows in ${Date.now() - loadStart} ms`);

const { pipeline, env } = await import('@huggingface/transformers');
env.allowRemoteModels = false;
env.localModelPath = modelsPath;
const extractor = await pipeline('feature-extraction', meta.query_model, { dtype: meta.query_model_dtype });

for (const text of texts) {
  const output = await extractor(meta.query_prefix + text, { pooling: 'mean', normalize: true });
  // first D dims -> L2-normalise -> subtract mean -> L2-normalise
  const q = Array.from(output.data.slice(0, dims));
  let norm = Math.hypot(...q);
  for (let i = 0; i < dims; i++) q[i] /= norm;
  if (mean) {
    for (let i = 0; i < dims; i++) q[i] -= mean[i];
    norm = Math.hypot(...q);
    for (let i = 0; i < dims; i++) q[i] /= norm;
  }

  const best = new Map();
  for (let r = 0; r < rows.length; r++) {
    if (!levels.has(rows[r].level)) continue;
    let dot = 0;
    const off = r * dims;
    for (let i = 0; i < dims; i++) dot += q[i] * vectors[off + i];
    const score = dot / scale;
    const key = `${rows[r].level}|${rows[r].start_verse_id}|${rows[r].end_verse_id}`;
    const current = best.get(key);
    if (!current || score > current.score) best.set(key, { score, row: rows[r] });
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  const kept = ranked.filter((r) => r.score >= minSimilarity).length;
  console.log(`\n"${text}"  (${kept.toLocaleString()} passages >= min_similarity)`);
  for (const { score, row } of ranked.slice(0, topN)) {
    const preview = (row.text_preview ?? '').slice(0, 90);
    console.log(`  ${score.toFixed(3)}  ${row.level.padEnd(9)} ${reference(row.start_verse_id, row.end_verse_id).padEnd(16)} ${preview}`);
  }
}
await extractor.dispose();
