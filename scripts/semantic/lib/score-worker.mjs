/**
 * Worker for evaluate-compact-index.mjs: streams the source index once and
 * scores a slice of the queries against every configuration, collapsing rows
 * to passages (best row score per level + start + end). Posts back the top-K
 * passage indices and scores for each configuration and query.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { blobToFloat32, quantiseInt8, transformVector } from './vector-transform.mjs';

const { sourcePath, levels, passageKeys, configs, means, queryCount, blockRows, topK, reportProgress } = workerData;

const passageIndex = new Map(passageKeys.map((key, i) => [key, i]));
const nP = passageKeys.length;
const levelSet = new Set(levels);

// One document encoding per distinct (dims, centering, encoding); configs that
// differ only in query model share it.
const encodings = new Map();
for (const config of configs) {
  if (encodings.has(config.docKey)) continue;
  const ArrayType = config.encoding === 'int8' ? Int8Array : Float32Array;
  encodings.set(config.docKey, {
    dims: config.dims,
    mean: config.center ? means[config.dims] : null,
    encoding: config.encoding,
    block: new ArrayType(blockRows * config.dims),
    scratch: new Float64Array(config.dims),
    quantised: new Int8Array(config.dims),
  });
}
const passageMax = configs.map(() => new Float32Array(queryCount * nP).fill(-Infinity));
const blockPassage = new Int32Array(blockRows);

function scoreBlock(rowCount) {
  configs.forEach((config, c) => {
    const { dims, queryVectors } = config;
    const docs = encodings.get(config.docKey).block;
    const best = passageMax[c];
    for (let q = 0; q < queryCount; q++) {
      const qOff = q * dims;
      const pOff = q * nP;
      for (let r = 0; r < rowCount; r++) {
        const dOff = r * dims;
        let dot = 0;
        for (let i = 0; i < dims; i++) dot += queryVectors[qOff + i] * docs[dOff + i];
        const slot = pOff + blockPassage[r];
        if (dot > best[slot]) best[slot] = dot;
      }
    }
  });
}

const db = new DatabaseSync(sourcePath, { readOnly: true });
let inBlock = 0;
let scored = 0;
const rows = db
  .prepare('SELECT level, start_verse_id, end_verse_id, embedding_blob FROM semantic_embeddings ORDER BY rowid')
  .iterate();
for (const row of rows) {
  if (!levelSet.has(row.level)) continue;
  const full = blobToFloat32(row.embedding_blob);
  blockPassage[inBlock] = passageIndex.get(`${row.level}|${row.start_verse_id}|${row.end_verse_id}`);
  for (const enc of encodings.values()) {
    const t = transformVector(full, enc.scratch, enc.mean);
    const offset = inBlock * enc.dims;
    if (enc.encoding === 'int8') enc.block.set(quantiseInt8(t, enc.quantised), offset);
    else for (let i = 0; i < enc.dims; i++) enc.block[offset + i] = t[i];
  }
  inBlock++;
  if (inBlock === blockRows) {
    scoreBlock(inBlock);
    scored += inBlock;
    inBlock = 0;
    if (reportProgress) parentPort.postMessage({ type: 'progress', rows: scored });
  }
}
scoreBlock(inBlock);
db.close();

/** Top-K passages per query, best first, via insertion into a K-slot sorted list. */
const top = passageMax.map((best) => {
  const indices = new Int32Array(queryCount * topK).fill(-1);
  const scores = new Float32Array(queryCount * topK).fill(-Infinity);
  for (let q = 0; q < queryCount; q++) {
    const pOff = q * nP;
    const tOff = q * topK;
    for (let p = 0; p < nP; p++) {
      const s = best[pOff + p];
      if (s <= scores[tOff + topK - 1]) continue;
      let pos = topK - 1;
      while (pos > 0 && scores[tOff + pos - 1] < s) {
        scores[tOff + pos] = scores[tOff + pos - 1];
        indices[tOff + pos] = indices[tOff + pos - 1];
        pos--;
      }
      scores[tOff + pos] = s;
      indices[tOff + pos] = p;
    }
  }
  return { indices, scores };
});

parentPort.postMessage(
  { type: 'done', top },
  top.flatMap((t) => [t.indices.buffer, t.scores.buffer])
);
