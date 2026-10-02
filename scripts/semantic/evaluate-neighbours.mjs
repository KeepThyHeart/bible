#!/usr/bin/env node
/**
 * Evaluates a neighbour table (SNB1) against the golden set (task 0070, design section 8).
 * No model or index needed: it reads the table only.
 *
 * Usage:
 *   pnpm build:core
 *   node scripts/semantic/evaluate-neighbours.mjs --table=<table.bin|table.bin.gz>
 *     [--golden=scripts/semantic/lib/golden-neighbours.json] [--top=10]
 *
 * Prints per golden source: the expected ranges found in the top 10 (after rankNeighbours with
 * default options), same-chapter noise (share of the raw table top 10 in the source's chapter,
 * before filtering), and the top 10 for review; then recall@10 overall and the score
 * distribution by rank with how many results survive candidate floors (to choose --floor).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/vector-transform.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const args = parseArgs(process.argv.slice(2));
if (!args.table) throw new Error('--table=<table.bin|table.bin.gz> is required');
const goldenPath = path.resolve(args.golden ?? path.join(HERE, 'lib', 'golden-neighbours.json'));
const TOP = Number(args.top ?? 10);

let core;
try {
  core = createRequire(import.meta.url)(path.join(REPO_ROOT, 'packages', 'core', 'dist', 'index.js'));
} catch (error) {
  throw new Error(`Cannot load packages/core/dist (run \`pnpm build:core\` first): ${error.message}`);
}
const { NeighbourTable, rankNeighbours, DEFAULT_SIMILAR_OPTIONS } = core;
for (const [name, v] of Object.entries({ NeighbourTable, rankNeighbours, DEFAULT_SIMILAR_OPTIONS })) {
  if (!v) throw new Error(`core dist does not export ${name} (rebuild core)`);
}

let bytes = fs.readFileSync(path.resolve(args.table));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = zlib.gunzipSync(bytes);
const table = NeighbourTable.fromBytes(new Uint8Array(bytes));
const floor = table.neighbourFloor();
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8')).sources;

const chapterOf = (id) => Math.floor(id / 1000) % 1000;
const bookOf = (id) => Math.floor(id / 1_000_000);
const overlaps = (a, b) => a.startVerseId <= b.end && a.endVerseId >= b.start;
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');
const label = (r) => {
  const ref = (id) => `${bookOf(id)} ${chapterOf(id)}:${id % 1000}`;
  return r.startVerseId === r.endVerseId ? ref(r.startVerseId) : `${ref(r.startVerseId)}-${r.endVerseId % 1000}`;
};

console.log(`table meta: k=${table.meta.k} floor=${fmt(floor)} dims=${table.meta.sourceDims} weights=${table.meta.weightsHash}`);
let expectedTotal = 0;
let expectedFound = 0;
let noiseSum = 0;
let noiseN = 0;
let missingKeys = 0;
const byRank = new Map();
const allScores = [];

for (const g of golden) {
  const src = { startVerseId: g.source.start, endVerseId: g.source.end };
  const raw = table.lookup(src);
  console.log(`\n${g.source.label} [${g.kind}]`);
  if (!raw) {
    console.log('  (no table key)');
    missingKeys++;
    continue;
  }
  const rawTop = raw.slice(0, TOP);
  const noise = rawTop.filter((h) => bookOf(h.startVerseId) === bookOf(src.startVerseId) && chapterOf(h.startVerseId) === chapterOf(src.startVerseId)).length / Math.max(1, rawTop.length);
  noiseSum += noise;
  noiseN++;
  const ranked = rankNeighbours(src, raw, { ...DEFAULT_SIMILAR_OPTIONS, maxResults: TOP }, { crossRefs: [], floor, via: 'table' });
  ranked.forEach((p, i) => {
    if (!byRank.has(i + 1)) byRank.set(i + 1, []);
    byRank.get(i + 1).push(p.similarity);
  });
  for (const h of raw) allScores.push(h.score);
  const found = g.expected.map((e) => {
    const rank = ranked.findIndex((p) => overlaps(p, e)) + 1;
    return { e, rank };
  });
  expectedTotal += found.length;
  expectedFound += found.filter((f) => f.rank > 0).length;
  for (const f of found) console.log(`  expected ${f.e.label}: ${f.rank ? `found at rank ${f.rank}` : 'MISSING'}`);
  console.log(`  same-chapter noise in raw top ${rawTop.length}: ${(noise * 100).toFixed(0)}%`);
  ranked.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmt(p.similarity)} ${p.level.padEnd(9)} ${label(p)}${p.isCrossReference ? ' [xref]' : ''}${found.some((f) => f.rank === i + 1) ? '  <== expected' : ''}`));
}

console.log('\n== Summary');
console.log(`recall@${TOP}: ${expectedFound}/${expectedTotal} = ${expectedTotal ? ((expectedFound / expectedTotal) * 100).toFixed(0) : 'n/a'}%`);
console.log(`mean same-chapter noise (raw top ${TOP}): ${noiseN ? ((noiseSum / noiseN) * 100).toFixed(0) : 'n/a'}%${missingKeys ? `; ${missingKeys} golden sources had no key` : ''}`);
console.log('score by rank (golden sources, after ranking): rank  min / mean / max');
for (const [rank, scores] of [...byRank].sort((a, b) => a[0] - b[0])) {
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  console.log(`  ${String(rank).padStart(2)}  ${fmt(Math.min(...scores))} / ${fmt(mean)} / ${fmt(Math.max(...scores))}`);
}
allScores.sort((a, b) => a - b);
console.log('raw table scores across golden lists, candidate floors (pick where judged precision drops below ~70%):');
for (const f of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8].concat([floor]).sort((a, b) => a - b)) {
  const n = allScores.filter((s) => s >= f).length;
  console.log(`  floor ${fmt(f)}${f === floor ? ' (table neighbourFloor)' : ''}: ${n}/${allScores.length} results kept`);
}
