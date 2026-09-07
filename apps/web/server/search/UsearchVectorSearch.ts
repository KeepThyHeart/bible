/**
 * usearch HNSW vector search — sub-millisecond approximate nearest neighbor.
 *
 * Uses a pre-built HNSW index (via usearch) for O(log n) search instead of
 * brute-force O(n). Metadata (level, verse IDs, text) is loaded from SQLite.
 *
 * Memory usage: ~260 MB total, measured — the HNSW index itself is mmap-backed
 * (~50-60 MB), but the metadata Map is not: 388K rows carrying ~58 MB of
 * text_content cost ~207 MB of heap once boxed into JS objects.
 * Search latency: <1 ms.
 */

import { existsSync } from 'fs';
import Database from 'better-sqlite3-web';
import { Index } from 'usearch';
import type { IVectorSearch, SearchCandidate, VectorSearchOptions, UsearchVectorSearchConfig } from '@bible/core';

interface MetadataEntry {
  level: string;
  startVerseId: number;
  endVerseId: number;
  textContent: string;
  title: string;
}

export class UsearchVectorSearch implements IVectorSearch {
  private indexPath: string;
  private dbPath: string;
  private index: Index | null = null;
  private metadata: Map<number, MetadataEntry> | null = null;
  private dims: number = 128;

  constructor(config: UsearchVectorSearchConfig) {
    this.indexPath = config.indexPath;
    this.dbPath = config.dbPath;
  }

  async initialize(): Promise<void> {
    if (this.index) return;

    if (!existsSync(this.indexPath)) {
      throw new Error(`usearch index not found: ${this.indexPath}`);
    }
    if (!existsSync(this.dbPath)) {
      throw new Error(`Metadata database not found: ${this.dbPath}`);
    }

    // Load metadata from SQLite
    console.log('[UsearchVectorSearch] Loading metadata from database...');
    const db = new Database(this.dbPath, { readonly: true });

    // Read dimensions from index_metadata
    const metaRows = db.prepare('SELECT key, value FROM index_metadata').all() as Array<{ key: string; value: string }>;
    const meta = new Map(metaRows.map(r => [r.key, r.value]));
    this.dims = parseInt(meta.get('embedding_dim') || '128', 10);

    const rows = db.prepare(
      'SELECT rowid, level, start_verse_id, end_verse_id, text_content, title FROM semantic_embeddings'
    ).all() as Array<{
      rowid: number;
      level: string;
      start_verse_id: number;
      end_verse_id: number;
      text_content: string;
      title: string | null;
    }>;

    this.metadata = new Map();
    for (const row of rows) {
      this.metadata.set(row.rowid, {
        level: row.level,
        startVerseId: row.start_verse_id,
        endVerseId: row.end_verse_id,
        textContent: row.text_content || '',
        title: row.title || '',
      });
    }
    db.close();

    // Load usearch HNSW index
    console.log('[UsearchVectorSearch] Loading HNSW index...');
    this.index = new Index({
      metric: 'cos',
      connectivity: 16,
      dimensions: this.dims,
      dtype: 'i8',
    });
    this.index.load(this.indexPath);

    console.log(`[UsearchVectorSearch] Ready: ${this.metadata.size} embeddings, ${this.dims}d HNSW index.`);
  }

  async search(queryVector: Float32Array, options: VectorSearchOptions): Promise<SearchCandidate[]> {
    if (!this.index || !this.metadata) {
      throw new Error('UsearchVectorSearch not initialized. Call initialize() first.');
    }

    const { topN, minScore = 0.0, levels } = options;

    // Quantize float32 query to int8 (same as SqliteVectorSearch)
    const queryInt8 = new Int8Array(queryVector.length);
    for (let i = 0; i < queryVector.length; i++) {
      queryInt8[i] = Math.round(Math.max(-127, Math.min(127, queryVector[i] * 127)));
    }

    // Request extra candidates to allow for level filtering
    const requestN = levels && levels.length > 0 ? topN * 3 : topN;
    const { keys, distances } = this.index.search(queryInt8, requestN);

    const results: SearchCandidate[] = [];
    for (let i = 0; i < keys.length; i++) {
      const rowid = Number(keys[i]);
      const meta = this.metadata.get(rowid);
      if (!meta) continue;

      if (levels && levels.length > 0 && !levels.includes(meta.level)) continue;

      // usearch cosine distance = 1 - similarity
      const score = 1 - distances[i];
      if (score < minScore) continue;

      results.push({
        index: rowid,
        score,
        level: meta.level,
        startVerseId: meta.startVerseId,
        endVerseId: meta.endVerseId,
        text: meta.textContent,
        title: meta.title || undefined,
      });

      if (results.length >= topN) break;
    }

    return results;
  }

  async dispose(): Promise<void> {
    this.index = null;
    this.metadata = null;
  }
}
