#!/usr/bin/env node
/**
 * Exports the semantic facet DB to a bibsearch corpus.jsonl (+ optional raw vectors).
 *
 * Usage:
 *   node scripts/semantic/export-bibsearch-corpus.mjs --db=<semantic_nomic-v1.5.db> --out=corpus.jsonl \
 *     [--levels=verse,paragraph,chapter,topic] [--vectors=<raw-dir>] [--enrichments=<enrichments_*.db>] [--force]
 *
 * Output: <out> (one JSON object per line), <out minus .jsonl>.manifest.json beside it, and with
 * --vectors the raw float32 file vectors.f32 plus vectors.manifest.json in that directory.
 *
 * Line fields: id, text, passage, level, facet, start, end, ref, title, tags, book, testament,
 * translation, lang. See the "Format" notes in buildRecord() and docs in the manifest.
 *
 *   id        KJV.<USFM>.<c>.<v>[-<v2>|-<c2>.<v2>]#<n>   (verse/paragraph/chapter)
 *             topic.<embedding id>#<n>                   (topic)
 *             <n> counts rows sharing the same base id, in source order, starting at 0, so every
 *             facet of a passage gets a unique id. Strip "#<n>" to map to a passage.
 *   passage   <level>:<start>-<end>   (BBCCCVVV integers; topic rows: topic:0-0)
 *   facet     main | sub | text | topic   (packages/core/src/Services/Search/FacetClassifier.ts)
 *   topic rows: no range (start = end = 0), no ref/book/testament; `tags` from topic_entries.
 *
 * The facet rule lives in FacetClassifier.ts and is loaded here through Node's type stripping.
 * The source DB is never modified. Rows with empty text are skipped and counted in the manifest.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MODEL_ID, QUERY_PREFIX, SOURCE_DIM, blobToFloat32, parseArgs } from './lib/vector-transform.mjs';
import { classifyFacet } from '../../packages/core/src/Services/Search/FacetClassifier.ts';
import { USFM_BOOKS } from '../../packages/core/src/Export/UsfmBookCodes.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EN_LOCALE = path.join(REPO_ROOT, 'packages', 'core', 'src', 'Reference', 'locales', 'en.json');
const MAX_LINE_BYTES = 1024 * 1024;
const ALL_LEVELS = ['verse', 'paragraph', 'chapter', 'topic'];

// --- Pure helpers (exported for tests) ----------------------------------------------

let longNames = null;
/** English long book name (core's getBookName(n, 'long'), read from the same en.json). */
export function bookName(n) {
  if (!longNames) longNames = JSON.parse(fs.readFileSync(EN_LOCALE, 'utf8')).books;
  return longNames[String(n)]?.long ?? `Book ${n}`;
}

export function splitVerseId(id) {
  return { book: Math.floor(id / 1000000), chapter: Math.floor(id / 1000) % 1000, verse: id % 1000 };
}

function usfm(book) {
  const b = USFM_BOOKS.find((x) => x.bookNumber === book);
  if (!b) throw new Error(`Unknown book number ${book}`);
  return b.code;
}

/** Base id (without the facet suffix) for a verse range. */
export function baseId(start, end) {
  const a = splitVerseId(start);
  const b = splitVerseId(end);
  const head = `KJV.${usfm(a.book)}.${a.chapter}.${a.verse}`;
  if (start === end) return head;
  if (a.book !== b.book) return `${head}-${usfm(b.book)}.${b.chapter}.${b.verse}`;
  if (a.chapter === b.chapter) return `${head}-${b.verse}`;
  return `${head}-${b.chapter}.${b.verse}`;
}

/** English reference, formatted like core's buildPassageReference (cross-chapter aware). */
export function formatRef(start, end) {
  const a = splitVerseId(start);
  const b = splitVerseId(end);
  const head = `${bookName(a.book)} ${a.chapter}:${a.verse}`;
  if (start === end) return head;
  if (a.book !== b.book) return `${head}-${bookName(b.book)} ${b.chapter}:${b.verse}`;
  if (a.chapter === b.chapter) return `${head}-${b.verse}`;
  return `${head}-${b.chapter}:${b.verse}`;
}

/** Builds one corpus record (without the `#n` id suffix, which the caller adds). */
export function buildRecord(row, tags) {
  const text = row.text;
  const facet = classifyFacet({ id: String(row.id), level: row.level, text });
  const common = { translation: 'KJV', lang: 'en' };
  if (row.level === 'topic') {
    return {
      baseId: `topic.${row.id}`,
      rec: {
        text,
        passage: 'topic:0-0',
        level: 'topic',
        facet,
        start: 0,
        end: 0,
        title: row.title ?? '',
        tags,
        ...common,
      },
    };
  }
  const { book } = splitVerseId(row.start);
  return {
    baseId: baseId(row.start, row.end),
    rec: {
      text,
      passage: `${row.level}:${row.start}-${row.end}`,
      level: row.level,
      facet,
      start: row.start,
      end: row.end,
      ref: formatRef(row.start, row.end),
      title: row.title ?? '',
      tags: [],
      book: usfm(book),
      testament: book <= 39 ? 'OT' : 'NT',
      ...common,
    },
  };
}

// --- Main ---------------------------------------------------------------------------

export function exportCorpus(opts) {
  const dbPath = path.resolve(opts.db);
  const outPath = path.resolve(opts.out);
  const levels = (opts.levels ?? ALL_LEVELS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  for (const l of levels) if (!ALL_LEVELS.includes(l)) throw new Error(`Unknown level "${l}"`);
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
  if (fs.existsSync(outPath) && !opts.force) throw new Error(`Output exists: ${outPath} (use --force to overwrite)`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const vectorsDir = opts.vectors ? path.resolve(opts.vectors) : null;
  if (vectorsDir) fs.mkdirSync(vectorsDir, { recursive: true });

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM index_metadata').all().map((r) => [r.key, r.value]));
  const columns = new Set(db.prepare('PRAGMA table_info(semantic_embeddings)').all().map((c) => c.name));
  const textCol = columns.has('text_content') ? 'text_content' : 'text_preview';
  const titleExpr = columns.has('title') ? 'title' : 'NULL';

  // Topic tags.
  const tagsById = new Map();
  try {
    for (const r of db.prepare('SELECT embedding_id, tag_name FROM topic_entries ORDER BY rowid').iterate()) {
      const list = tagsById.get(r.embedding_id) ?? [];
      list.push(r.tag_name);
      tagsById.set(r.embedding_id, list);
    }
  } catch { /* no topic_entries table */ }

  // Titles from an enrichments DB, only for rows whose own title is empty.
  const enrichTitles = new Map();
  if (opts.enrichments) {
    const edb = new DatabaseSync(path.resolve(opts.enrichments), { readOnly: true });
    for (const r of edb.prepare('SELECT title, level, start_verse_id, end_verse_id FROM enrichment_units WHERE title IS NOT NULL').iterate()) {
      enrichTitles.set(`${r.level}|${r.start_verse_id}|${r.end_verse_id}`, r.title);
    }
    edb.close();
  }

  const sha256 = crypto.createHash('sha256');
  const fd = fs.openSync(dbPath, 'r');
  const buf = Buffer.alloc(1 << 20);
  for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) sha256.update(buf.subarray(0, n));
  fs.closeSync(fd);

  const outFd = fs.openSync(outPath, 'w');
  const vecFd = vectorsDir ? fs.openSync(path.join(vectorsDir, 'vectors.f32'), 'w') : null;
  const seen = new Set();
  const counters = new Map();
  const counts = {};
  let total = 0;
  let skippedEmpty = 0;
  let dims = null;
  const placeholders = levels.map(() => '?').join(',');
  const stmt = db.prepare(
    `SELECT id, level, start_verse_id AS start, end_verse_id AS end, ${textCol} AS text, ${titleExpr} AS title, embedding_blob AS blob
     FROM semantic_embeddings WHERE level IN (${placeholders}) ORDER BY rowid`
  );
  try {
    for (const row of stmt.iterate(...levels)) {
      const text = String(row.text ?? '').trim();
      if (!text) { skippedEmpty++; continue; }
      const title = (row.title && String(row.title).trim()) || enrichTitles.get(`${row.level}|${row.start}|${row.end}`) || '';
      const { baseId: base, rec } = buildRecord({ ...row, id: String(row.id), text, title }, tagsById.get(row.id) ?? []);
      const n = counters.get(base) ?? 0;
      counters.set(base, n + 1);
      const id = `${base}#${n}`;
      if (seen.has(id)) throw new Error(`Duplicate id ${id}`);
      seen.add(id);
      const line = JSON.stringify({ id, ...rec });
      if (Buffer.byteLength(line) >= MAX_LINE_BYTES) throw new Error(`Line for ${id} is ${Buffer.byteLength(line)} bytes (limit 1 MiB)`);
      fs.writeSync(outFd, `${line}\n`);
      if (vecFd !== null) {
        const v = blobToFloat32(row.blob);
        if (dims === null) dims = v.length;
        if (v.length !== dims) throw new Error(`Row ${id} has ${v.length} dims, expected ${dims}`);
        fs.writeSync(vecFd, Buffer.from(v.buffer, v.byteOffset, v.byteLength));
      }
      const key = `${rec.level}/${rec.facet}`;
      counts[key] = (counts[key] ?? 0) + 1;
      total++;
    }
  } finally {
    fs.closeSync(outFd);
    if (vecFd !== null) fs.closeSync(vecFd);
    db.close();
  }

  const byLevel = {};
  for (const [k, v] of Object.entries(counts)) byLevel[k.split('/')[0]] = (byLevel[k.split('/')[0]] ?? 0) + v;
  const manifest = {
    format: 'bibsearch-corpus-jsonl/1',
    created: new Date().toISOString(),
    source_db: path.basename(dbPath),
    source_db_sha256: sha256.digest('hex'),
    corpus: path.basename(outPath),
    rows: total,
    skipped_empty_text: skippedEmpty,
    counts_by_level: byLevel,
    counts_by_level_facet: counts,
    levels,
    model: meta.embedding_model ?? meta.model ?? MODEL_ID,
    dims: Number(meta.embedding_dim ?? dims ?? SOURCE_DIM),
    min_similarity: meta.min_similarity !== undefined ? Number(meta.min_similarity) : null,
    id_scheme: 'KJV.<USFM>.<c>.<v>[-range]#<n> ; topic.<embedding id>#<n>; strip #<n> to get the passage',
    facet_rule: 'topic level -> topic; id starts txt| -> text; id ends _s<N> or text < 80 chars -> sub; else main',
  };
  const manifestPath = outPath.replace(/\.jsonl$/, '') + '.manifest.json';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  let vectorsManifest = null;
  if (vectorsDir) {
    const sourcePrefix = meta.document_prefix ?? meta.index_prefix ?? null;
    vectorsManifest = {
      format: 'raw-float32-rowmajor/1',
      file: 'vectors.f32',
      corpus: path.basename(outPath),
      note: 'Row i is the vector of line i of the corpus. Little-endian float32, dims values per row, as stored in the source DB (not re-normalised).',
      rows: total,
      dims,
      dtype: 'float32',
      model: manifest.model,
      query_prefix: meta.query_prefix ?? QUERY_PREFIX,
      query_prefix_source: meta.query_prefix !== undefined ? 'index_metadata.query_prefix' : 'assumed: server/desktop default (not stored in this source DB)',
      source_document_prefix: sourcePrefix,
      prefix_notes: [
        'Server (LocalOnnxEmbedder/ApiEmbedder) and desktop apply "search_query: " to queries; the browser worker (searchWorker.ts) applies none ("No prefix for centered search").',
        'The source DB metadata does not record how the 768-d document vectors were built' + (sourcePrefix ? '' : ' (no document prefix key found)') + '; confirm with the generator before relying on prefixed queries.',
      ],
      index_metadata: meta,
    };
    fs.writeFileSync(path.join(vectorsDir, 'vectors.manifest.json'), `${JSON.stringify(vectorsManifest, null, 2)}\n`);
  }
  return { manifest, manifestPath, vectorsManifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db || !args.out) throw new Error('--db=<semantic db> and --out=<corpus.jsonl> are required');
  const { manifest, manifestPath } = exportCorpus(args);
  console.log(`Wrote ${manifest.rows.toLocaleString()} rows to ${args.out} (skipped ${manifest.skipped_empty_text} empty)`);
  for (const [k, v] of Object.entries(manifest.counts_by_level_facet)) console.log(`  ${k}: ${v.toLocaleString()}`);
  console.log(`Manifest: ${manifestPath}`);
}
