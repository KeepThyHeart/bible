/**
 * Vector transforms shared by the compact semantic index builder, its
 * evaluator and its query checker.
 *
 * The compact index stores document vectors as int8 at a reduced Matryoshka
 * dimension. Documents and queries go through the same transform:
 *
 *   first D dims -> L2-normalise -> (optionally) subtract mean -> L2-normalise
 *
 * Documents are then quantised to int8 as round(clamp(x * 127, -127, 127)).
 * Queries stay float; the score is dot(query, int8Doc) / 127.
 */

import { DatabaseSync } from 'node:sqlite';

export const VECTOR_SCALE = 127;
export const SOURCE_DIM = 768;
export const QUERY_PREFIX = 'search_query: ';
export const MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5';

/** Scales `out` in place to unit length (a zero vector is left untouched). */
function normaliseInPlace(out) {
  let sumSq = 0;
  for (let i = 0; i < out.length; i++) sumSq += out[i] * out[i];
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < out.length; i++) out[i] /= norm;
  }
  return out;
}

/**
 * Applies the contract transform to `source` (a 768-dim float vector) and
 * writes the D-dim result into `out` (a Float32Array or Float64Array of
 * length D). `mean` is a D-length array, or null for no centering.
 */
export function transformVector(source, out, mean) {
  const dims = out.length;
  for (let i = 0; i < dims; i++) out[i] = source[i];
  normaliseInPlace(out);
  if (mean) {
    for (let i = 0; i < dims; i++) out[i] -= mean[i];
    normaliseInPlace(out);
  }
  return out;
}

/** Quantises a unit vector to int8 in `out` (an Int8Array of the same length). */
export function quantiseInt8(vec, out) {
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.round(Math.max(-VECTOR_SCALE, Math.min(VECTOR_SCALE, vec[i] * VECTOR_SCALE)));
  }
  return out;
}

/** Views a SQLite BLOB (Uint8Array) holding float32 values as a Float32Array without copying. */
export function blobToFloat32(blob) {
  if (blob.byteOffset % 4 === 0) {
    return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  }
  return new Float32Array(blob.slice().buffer);
}

/**
 * Computes the mean of every row's truncated, normalised vector for each of
 * the requested dimensions, streaming the source so the full matrix is never
 * held in memory. Returns a Map of dim -> Float64Array.
 */
export function computeCorpusMeans(sourcePath, dimsList) {
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  const sums = new Map(dimsList.map((d) => [d, new Float64Array(d)]));
  const scratch = new Map(dimsList.map((d) => [d, new Float64Array(d)]));
  let count = 0;
  for (const row of db.prepare('SELECT embedding_blob FROM semantic_embeddings ORDER BY rowid').iterate()) {
    const full = blobToFloat32(row.embedding_blob);
    for (const d of dimsList) {
      const t = transformVector(full, scratch.get(d), null);
      const sum = sums.get(d);
      for (let i = 0; i < d; i++) sum[i] += t[i];
    }
    count++;
  }
  db.close();
  for (const sum of sums.values()) {
    for (let i = 0; i < sum.length; i++) sum[i] /= count;
  }
  return sums;
}

/** Rounds a mean vector to 7 significant decimals for JSON storage, keeping JS numbers. */
export function roundMean(mean) {
  return Array.from(mean, (v) => Math.round(v * 1e7) / 1e7);
}

/**
 * Loads a nomic-embed-text-v1.5 query embedder from a local model directory
 * (never the network). Returns an async function text -> Float32Array(768).
 */
export async function loadQueryEmbedder(localModelPath, dtype) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = localModelPath;
  const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype });
  const embed = async (text) => {
    const output = await extractor(QUERY_PREFIX + text, { pooling: 'mean', normalize: true });
    return Float32Array.from(output.data);
  };
  embed.dispose = () => extractor.dispose();
  return embed;
}

/** Parses `--key=value` / `--flag` arguments into a plain object. */
export function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unrecognised argument: ${arg}`);
    args[match[1]] = match[2] ?? true;
  }
  return args;
}

/** Formats a byte count as MB with one decimal. */
export function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
