/**
 * SQLite-based vector search — loads all embeddings into memory.
 *
 * Supports both float32 (legacy) and int8 (compact centered) embeddings.
 * Auto-detects precision from index_metadata table.
 *
 * Memory usage:
 *   - float32 768d: ~1.1 GB for 388K embeddings
 *   - int8 128d:    ~48 MB for 388K embeddings
 */

import type { IVectorSearch, SearchCandidate, VectorSearchOptions, SqliteVectorSearchConfig, ScoringConfig } from '@bible/core';
import { applyMainFacetPreference, resolveScoringConfig } from '../core.js';
import Database from 'better-sqlite3-web';

interface EmbeddingEntryFloat32 {
  rowid: number;
  id: string;
  level: string;
  startVerseId: number;
  endVerseId: number;
  textContent: string;
  title: string;
  vector: Float32Array;
}

interface EmbeddingEntryInt8 {
  rowid: number;
  id: string;
  level: string;
  startVerseId: number;
  endVerseId: number;
  textContent: string;
  title: string;
  vector: Int8Array;
}

export interface TopicEntry {
  embeddingId: string;
  tagName: string;
  tagType: string;
  verseCount: number;
  avgStrength: number;
  naveTopicId: number | null;
  torreyTopicId: number | null;
}

export class SqliteVectorSearch implements IVectorSearch {
  private dbPath: string;
  private scoringConfig: ReturnType<typeof resolveScoringConfig>;
  private precision: 'float32' | 'int8' = 'float32';
  private dims: number = 768;
  private entriesFloat32: EmbeddingEntryFloat32[] | null = null;
  private entriesInt8: EmbeddingEntryInt8[] | null = null;

  /** Topic entries loaded from companion table (available for search route to use) */
  topicEntries: Map<string, TopicEntry> = new Map();

  constructor(config: SqliteVectorSearchConfig, scoring?: ScoringConfig) {
    this.dbPath = config.dbPath;
    this.scoringConfig = resolveScoringConfig(scoring);
  }

  async initialize(): Promise<void> {
    if (this.entriesFloat32 || this.entriesInt8) return;

    console.log('[SqliteVectorSearch] Loading embeddings from database...');
    const db = new Database(this.dbPath, { readonly: true });

    // Auto-detect precision and dimensions from metadata
    const metaRows = db.prepare('SELECT key, value FROM index_metadata').all() as Array<{ key: string; value: string }>;
    const meta = new Map(metaRows.map(r => [r.key, r.value]));

    this.precision = (meta.get('precision') as 'float32' | 'int8') || 'float32';
    this.dims = parseInt(meta.get('embedding_dim') || '768', 10);

    console.log(`[SqliteVectorSearch] Detected: ${this.dims}d ${this.precision}, centered=${meta.get('centered') || 'false'}`);

    const rows = db.prepare(
      'SELECT rowid, id, level, start_verse_id, end_verse_id, text_content, title, embedding_blob FROM semantic_embeddings'
    ).all() as Array<{
      rowid: number;
      id: string;
      level: string;
      start_verse_id: number;
      end_verse_id: number;
      text_content: string;
      title: string | null;
      embedding_blob: Buffer;
    }>;

    if (this.precision === 'int8') {
      this.entriesInt8 = rows.map(row => ({
        rowid: row.rowid,
        id: row.id,
        level: row.level,
        startVerseId: row.start_verse_id,
        endVerseId: row.end_verse_id,
        textContent: row.text_content || '',
        title: row.title || '',
        vector: new Int8Array(
          row.embedding_blob.buffer,
          row.embedding_blob.byteOffset,
          row.embedding_blob.byteLength
        ),
      }));
      console.log(`[SqliteVectorSearch] Loaded ${this.entriesInt8.length} int8 embeddings (${(this.entriesInt8.length * this.dims / 1024 / 1024).toFixed(1)} MB vectors).`);
    } else {
      this.entriesFloat32 = rows.map(row => ({
        rowid: row.rowid,
        id: row.id,
        level: row.level,
        startVerseId: row.start_verse_id,
        endVerseId: row.end_verse_id,
        textContent: row.text_content || '',
        title: row.title || '',
        vector: new Float32Array(
          row.embedding_blob.buffer,
          row.embedding_blob.byteOffset,
          row.embedding_blob.byteLength / 4
        ),
      }));
      console.log(`[SqliteVectorSearch] Loaded ${this.entriesFloat32.length} float32 embeddings.`);
    }

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

    db.close();
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
    if (!this.entriesFloat32) {
      throw new Error('SqliteVectorSearch not initialized. Call initialize() first.');
    }

    const { topN, minScore = 0.0, levels } = options;
    const results: SearchCandidate[] = [];

    for (let i = 0; i < this.entriesFloat32.length; i++) {
      const entry = this.entriesFloat32[i];
      if (levels && levels.length > 0 && !levels.includes(entry.level)) continue;

      const score = dotProductFloat32(queryVector, entry.vector);
      if (score >= minScore) {
        results.push({
          index: entry.rowid,
          score,
          level: entry.level,
          startVerseId: entry.startVerseId,
          endVerseId: entry.endVerseId,
          title: entry.title || undefined,
          text: entry.textContent,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topN);
  }

  private searchInt8(queryVector: Float32Array, options: VectorSearchOptions): SearchCandidate[] {
    if (!this.entriesInt8) {
      throw new Error('SqliteVectorSearch not initialized. Call initialize() first.');
    }

    const { topN, minScore = 0.0, levels } = options;

    // Quantize the float32 query to int8 for fast integer dot product
    const queryInt8 = quantizeFloat32ToInt8(queryVector);

    const results: SearchCandidate[] = [];

    for (let i = 0; i < this.entriesInt8.length; i++) {
      const entry = this.entriesInt8[i];
      if (levels && levels.length > 0 && !levels.includes(entry.level)) continue;

      const score = dotProductInt8Normalized(queryInt8, entry.vector);
      if (score >= minScore) {
        results.push({
          index: entry.rowid,
          score,
          level: entry.level,
          startVerseId: entry.startVerseId,
          endVerseId: entry.endVerseId,
          title: entry.title || undefined,
          text: entry.textContent,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topN);
  }

  async dispose(): Promise<void> {
    this.entriesFloat32 = null;
    this.entriesInt8 = null;
  }
}

/** Dot product for two Float32Arrays (assumes L2-normalized). */
function dotProductFloat32(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/** Quantize a normalized float32 vector to int8 [-127, 127]. */
function quantizeFloat32ToInt8(vec: Float32Array): Int8Array {
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.round(Math.max(-127, Math.min(127, vec[i] * 127)));
  }
  return out;
}

/**
 * Dot product for two Int8Arrays, normalized to [-1, 1].
 * Integer dot product divided by 127² to get cosine similarity.
 */
function dotProductInt8Normalized(a: Int8Array, b: Int8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  // Both vectors were quantized by multiplying by 127, so divide by 127²
  return sum / (127 * 127);
}
