/**
 * Native CLI vector search — spawns a C binary for brute-force search.
 *
 * The binary uses mmap to read a flat binary file of pre-computed embeddings,
 * keeping resident RAM at ~5-15MB instead of loading all vectors into Node.js.
 *
 * Communication: query vector + topN written to stdin as binary,
 * results returned on stdout as JSON.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import type { IVectorSearch, SearchCandidate, VectorSearchOptions, NativeCliVectorSearchConfig } from '@bible/core';

interface MetadataEntry {
  level: string;
  startVerseId: number;
  endVerseId: number;
  textContent: string;
}

export class NativeCliVectorSearch implements IVectorSearch {
  private binaryPath: string;
  private embeddingsPath: string;
  private dbPath: string;
  private metadata: Map<number, MetadataEntry> | null = null;

  constructor(config: NativeCliVectorSearchConfig) {
    this.binaryPath = config.binaryPath;
    this.embeddingsPath = config.embeddingsPath;
    this.dbPath = config.dbPath;
  }

  async initialize(): Promise<void> {
    // Verify binary exists
    if (!existsSync(this.binaryPath)) {
      throw new Error(`vec-search binary not found: ${this.binaryPath}`);
    }
    if (!existsSync(this.embeddingsPath)) {
      throw new Error(`Binary embeddings file not found: ${this.embeddingsPath}`);
    }

    // Load metadata from SQLite (rowid -> level, verse IDs, text)
    console.log('[NativeCliVectorSearch] Loading metadata from database...');
    const db = new Database(this.dbPath, { readonly: true });

    const rows = db.prepare(
      'SELECT rowid, level, start_verse_id, end_verse_id, text_content FROM semantic_embeddings'
    ).all() as Array<{
      rowid: number;
      level: string;
      start_verse_id: number;
      end_verse_id: number;
      text_content: string;
    }>;

    this.metadata = new Map();
    for (const row of rows) {
      this.metadata.set(row.rowid, {
        level: row.level,
        startVerseId: row.start_verse_id,
        endVerseId: row.end_verse_id,
        textContent: row.text_content || '',
      });
    }

    db.close();
    console.log(`[NativeCliVectorSearch] Loaded metadata for ${this.metadata.size} embeddings.`);
  }

  async search(queryVector: Float32Array, options: VectorSearchOptions): Promise<SearchCandidate[]> {
    if (!this.metadata) {
      throw new Error('NativeCliVectorSearch not initialized. Call initialize() first.');
    }

    const { topN, minScore = 0.0, levels } = options;

    // Build stdin: 4 bytes topN (uint32 LE) + query vector (float32 LE)
    const headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32LE(topN * 3); // Request extra to allow filtering
    const vectorBuf = Buffer.from(queryVector.buffer, queryVector.byteOffset, queryVector.byteLength);
    const stdinData = Buffer.concat([headerBuf, vectorBuf]);

    // Spawn the binary
    const stdout = execFileSync(this.binaryPath, [this.embeddingsPath], {
      input: stdinData,
      maxBuffer: 1024 * 1024,
      timeout: 10000,
    });

    // Parse JSON output: [{index, score}, ...]
    const rawResults = JSON.parse(stdout.toString()) as Array<{ index: number; score: number }>;

    // Map indices to metadata and filter
    const results: SearchCandidate[] = [];
    for (const raw of rawResults) {
      // Binary index is 0-based, rowid is 1-based
      const rowid = raw.index + 1;
      const meta = this.metadata.get(rowid);
      if (!meta) continue;

      if (levels && levels.length > 0 && !levels.includes(meta.level)) {
        continue;
      }

      if (raw.score < minScore) continue;

      results.push({
        index: rowid,
        score: raw.score,
        level: meta.level,
        startVerseId: meta.startVerseId,
        endVerseId: meta.endVerseId,
        text: meta.textContent,
      });

      if (results.length >= topN) break;
    }

    return results;
  }

  async dispose(): Promise<void> {
    this.metadata = null;
  }
}
