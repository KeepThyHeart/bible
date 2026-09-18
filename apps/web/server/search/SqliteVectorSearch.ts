/**
 * SQLite-based vector search — vectors in memory, passage text on disk.
 *
 * Supports both float32 (legacy) and int8 (compact centered) embeddings.
 * Auto-detects precision from index_metadata table.
 *
 * Memory layout: every vector lives in one contiguous typed array, next to
 * compact per-row metadata (verse range and level). Passage text and titles
 * stay in the database and are read only for the candidates a search returns.
 * Holding the text of all ~400K passages as JS objects used to be most of the
 * server's heap, and it was swapped out between visits.
 *
 * Memory usage (vectors):
 *   - float32 768d: ~1.1 GB for 388K embeddings
 *   - int8 384d:    ~150 MB for 403K embeddings
 */

import type { IVectorSearch, SearchCandidate, VectorSearchOptions, SqliteVectorSearchConfig, ScoringConfig } from '@bible/core';
import { applyMainFacetPreference, resolveScoringConfig } from '../core.js';
import Database from 'better-sqlite3-web';

export interface TopicEntry {
  embeddingId: string;
  tagName: string;
  tagType: string;
  verseCount: number;
  avgStrength: number;
  naveTopicId: number | null;
  torreyTopicId: number | null;
}

/** Row positions (into the in-memory arrays) and scores, best first. */
interface Ranked {
  rows: number[];
  scores: number[];
}

export class SqliteVectorSearch implements IVectorSearch {
  private dbPath: string;
  private scoringConfig: ReturnType<typeof resolveScoringConfig>;
  private precision: 'float32' | 'int8' = 'float32';
  private dims: number = 768;
  private count = 0;
  private vectorsInt8: Int8Array | null = null;
  private vectorsFloat32: Float32Array | null = null;
  private rowids = new Int32Array(0);
  private startVerseIds = new Int32Array(0);
  private endVerseIds = new Int32Array(0);
  private levelCodes = new Uint8Array(0);
  private levelNames: string[] = [];
  /** Read-only handle kept open to look up text and titles for results. */
  private db: Database.Database | null = null;
  private detailsStmt: Database.Statement | null = null;

  /** Topic entries loaded from companion table (available for search route to use) */
  topicEntries: Map<string, TopicEntry> = new Map();

  constructor(config: SqliteVectorSearchConfig, scoring?: ScoringConfig) {
    this.dbPath = config.dbPath;
    this.scoringConfig = resolveScoringConfig(scoring);
  }

  async initialize(): Promise<void> {
    if (this.db) return;

    console.log('[SqliteVectorSearch] Loading embeddings from database...');
    const db = new Database(this.dbPath, { readonly: true });
    db.pragma('cache_size = -2000');
    db.pragma('mmap_size = 268435456');

    // Auto-detect precision and dimensions from metadata
    const metaRows = db.prepare('SELECT key, value FROM index_metadata').all() as Array<{ key: string; value: string }>;
    const meta = new Map(metaRows.map(r => [r.key, r.value]));

    this.precision = (meta.get('precision') as 'float32' | 'int8') || 'float32';
    this.dims = parseInt(meta.get('embedding_dim') || '768', 10);

    console.log(`[SqliteVectorSearch] Detected: ${this.dims}d ${this.precision}, centered=${meta.get('centered') || 'false'}`);

    const total = (db.prepare('SELECT COUNT(*) AS n FROM semantic_embeddings').get() as { n: number }).n;
    const bytesPerVector = this.precision === 'int8' ? this.dims : this.dims * 4;
    const vectorBytes = new Uint8Array(total * bytesPerVector);
    this.rowids = new Int32Array(total);
    this.startVerseIds = new Int32Array(total);
    this.endVerseIds = new Int32Array(total);
    this.levelCodes = new Uint8Array(total);
    const levelIndex = new Map<string, number>();

    // Stream the rows (no text) straight into the typed arrays, so loading
    // never materializes every row at once.
    const rows = db.prepare(
      'SELECT rowid, level, start_verse_id, end_verse_id, embedding_blob FROM semantic_embeddings ORDER BY rowid'
    ).iterate() as IterableIterator<{
      rowid: number;
      level: string | null;
      start_verse_id: number;
      end_verse_id: number;
      embedding_blob: Buffer;
    }>;
    let n = 0;
    let badRow: string | null = null;
    for (const row of rows) {
      if (n >= total) break;
      if (row.embedding_blob.byteLength !== bytesPerVector) {
        badRow = `row ${row.rowid} has a ${row.embedding_blob.byteLength}-byte embedding, expected ${bytesPerVector}`;
        break;
      }
      vectorBytes.set(row.embedding_blob, n * bytesPerVector);
      this.rowids[n] = row.rowid;
      this.startVerseIds[n] = row.start_verse_id;
      this.endVerseIds[n] = row.end_verse_id;
      const level = row.level ?? '';
      let code = levelIndex.get(level);
      if (code === undefined) {
        code = this.levelNames.length;
        levelIndex.set(level, code);
        this.levelNames.push(level);
      }
      if (code > 255) {
        badRow = 'more than 256 distinct embedding levels';
        break;
      }
      this.levelCodes[n] = code;
      n++;
    }
    if (badRow) {
      db.close();
      throw new Error(`[SqliteVectorSearch] ${this.dbPath}: ${badRow}`);
    }
    this.count = n;

    if (this.precision === 'int8') {
      this.vectorsInt8 = new Int8Array(vectorBytes.buffer, 0, n * this.dims);
    } else {
      this.vectorsFloat32 = new Float32Array(vectorBytes.buffer, 0, n * this.dims);
    }
    console.log(
      `[SqliteVectorSearch] Loaded ${n} ${this.precision} embeddings ` +
      `(${(n * bytesPerVector / 1024 / 1024).toFixed(1)} MB vectors; passage text stays on disk).`
    );

    // Load topic_entries companion table if available
    try {
      const topicRows = db.prepare(
        'SELECT embedding_id, tag_name, tag_type, verse_count, avg_strength, nave_topic_id, torrey_topic_id FROM topic_entries'
      ).all() as Array<{
        embedding_id: string;
        tag_name: string;
        tag_type: string;
        verse_count: number;
        avg_strength: number;
        nave_topic_id: number | null;
        torrey_topic_id: number | null;
      }>;
      for (const r of topicRows) {
        this.topicEntries.set(r.embedding_id, {
          embeddingId: r.embedding_id,
          tagName: r.tag_name,
          tagType: r.tag_type,
          verseCount: r.verse_count,
          avgStrength: r.avg_strength,
          naveTopicId: r.nave_topic_id,
          torreyTopicId: r.torrey_topic_id,
        });
      }
      if (this.topicEntries.size > 0) {
        console.log(`[SqliteVectorSearch] Loaded ${this.topicEntries.size} topic entries.`);
      }
    } catch {
      // topic_entries table may not exist — that's fine
    }

    this.detailsStmt = db.prepare(
      'SELECT rowid, text_content, title FROM semantic_embeddings WHERE rowid IN (SELECT value FROM json_each(?))'
    );
    this.db = db;
  }

  async search(queryVector: Float32Array, options: VectorSearchOptions): Promise<SearchCandidate[]> {
    const { facetScoring, subFacetDamping } = this.scoringConfig;

    // When using main-prefer scoring, request extra candidates so we have
    // enough main+sub facets per verse to compare after grouping.
    const effectiveOptions = facetScoring === 'main-prefer'
      ? { ...options, topN: (options.topN ?? 50) * 5 }
      : options;

    let results: SearchCandidate[];
    if (this.precision === 'int8') {
      results = this.searchInt8(queryVector, effectiveOptions);
    } else {
      results = this.searchFloat32(queryVector, effectiveOptions);
    }

    if (facetScoring === 'main-prefer') {
      return applyMainFacetPreference(results, options.topN ?? 50, subFacetDamping);
    }
    return results;
  }

  private searchFloat32(queryVector: Float32Array, options: VectorSearchOptions): SearchCandidate[] {
    const vectors = this.vectorsFloat32;
    if (!vectors) {
      throw new Error('SqliteVectorSearch not initialized. Call initialize() first.');
    }

    const { topN, minScore = 0.0, levels } = options;
    const dims = this.dims;
    const allowed = this.levelFilter(levels);

    return this.toCandidates(topK(this.count, topN ?? this.count, minScore, row => {
      if (allowed && !allowed[this.levelCodes[row]]) return null;
      const offset = row * dims;
      let sum = 0;
      for (let d = 0; d < dims; d++) {
        sum += queryVector[d] * vectors[offset + d];
      }
      return sum;
    }));
  }

  private searchInt8(queryVector: Float32Array, options: VectorSearchOptions): SearchCandidate[] {
    const vectors = this.vectorsInt8;
    if (!vectors) {
      throw new Error('SqliteVectorSearch not initialized. Call initialize() first.');
    }

    const { topN, minScore = 0.0, levels } = options;
    const dims = this.dims;
    const allowed = this.levelFilter(levels);

    // Quantize the float32 query to int8 for fast integer dot product
    const queryInt8 = quantizeFloat32ToInt8(queryVector);

    return this.toCandidates(topK(this.count, topN ?? this.count, minScore, row => {
      if (allowed && !allowed[this.levelCodes[row]]) return null;
      const offset = row * dims;
      let sum = 0;
      for (let d = 0; d < dims; d++) {
        sum += queryInt8[d] * vectors[offset + d];
      }
      // Both vectors were quantized by multiplying by 127, so divide by 127²
      return sum / (127 * 127);
    }));
  }

  /** Per-level-code allow list for a `levels` filter (null = every level). */
  private levelFilter(levels?: string[]): Uint8Array | null {
    if (!levels || levels.length === 0) return null;
    const allowed = new Uint8Array(this.levelNames.length);
    this.levelNames.forEach((name, code) => {
      if (levels.includes(name)) allowed[code] = 1;
    });
    return allowed;
  }

  /** Build result candidates, reading text and titles for just these rows. */
  private toCandidates({ rows, scores }: Ranked): SearchCandidate[] {
    const details = new Map<number, { text: string; title: string | null }>();
    if (rows.length > 0 && this.detailsStmt) {
      const rowids = rows.map(row => this.rowids[row]);
      const found = this.detailsStmt.all(JSON.stringify(rowids)) as Array<{
        rowid: number;
        text_content: string | null;
        title: string | null;
      }>;
      for (const d of found) {
        details.set(d.rowid, { text: d.text_content || '', title: d.title });
      }
    }

    return rows.map((row, i) => {
      const rowid = this.rowids[row];
      const d = details.get(rowid);
      return {
        index: rowid,
        score: scores[i],
        level: this.levelNames[this.levelCodes[row]],
        startVerseId: this.startVerseIds[row],
        endVerseId: this.endVerseIds[row],
        title: d?.title || undefined,
        text: d?.text ?? '',
      };
    });
  }

  async dispose(): Promise<void> {
    this.db?.close();
    this.db = null;
    this.detailsStmt = null;
    this.vectorsFloat32 = null;
    this.vectorsInt8 = null;
    this.count = 0;
  }
}

/**
 * The `k` best-scoring rows with score >= minScore, best first. `scoreAt`
 * returns null to skip a row. A bounded min-heap keeps this O(n log k)
 * instead of building and sorting a candidate object for every row.
 */
function topK(count: number, k: number, minScore: number, scoreAt: (row: number) => number | null): Ranked {
  k = Math.max(0, Math.min(k, count));
  const heapRows = new Int32Array(k);
  const heapScores = new Float64Array(k);
  let size = 0;

  for (let row = 0; row < count; row++) {
    const score = scoreAt(row);
    if (score === null || score < minScore) continue;

    if (size < k) {
      // Sift the new entry up from the end.
      let c = size++;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heapScores[p] <= score) break;
        heapScores[c] = heapScores[p];
        heapRows[c] = heapRows[p];
        c = p;
      }
      heapScores[c] = score;
      heapRows[c] = row;
    } else if (k > 0 && score > heapScores[0]) {
      // Replace the current worst (the root) and sift it down.
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        if (l >= size) break;
        const r = l + 1;
        const m = r < size && heapScores[r] < heapScores[l] ? r : l;
        if (heapScores[m] >= score) break;
        heapScores[c] = heapScores[m];
        heapRows[c] = heapRows[m];
        c = m;
      }
      heapScores[c] = score;
      heapRows[c] = row;
    }
  }

  const order = Array.from({ length: size }, (_, i) => i).sort((a, b) => heapScores[b] - heapScores[a]);
  return { rows: order.map(i => heapRows[i]), scores: order.map(i => heapScores[i]) };
}

/** Quantize a normalized float32 vector to int8 [-127, 127]. */
function quantizeFloat32ToInt8(vec: Float32Array): Int8Array {
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.round(Math.max(-127, Math.min(127, vec[i] * 127)));
  }
  return out;
}
