/**
 * Native CLI vector search — spawns a C binary for brute-force search.
 *
 * The binary uses mmap to read a flat binary file of pre-computed embeddings,
 * keeping resident RAM at ~5-15MB instead of loading all vectors into Node.js.
 * Only compact per-row metadata (level, verse range) is held in memory;
 * passage text is read from SQLite for just the results a search returns.
 *
 * Communication: query vector + topN written to stdin as binary,
 * results returned on stdout as JSON.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import type { IVectorSearch, SearchCandidate, VectorSearchOptions, NativeCliVectorSearchConfig } from '@bible/core';

export class NativeCliVectorSearch implements IVectorSearch {
  private binaryPath: string;
  private embeddingsPath: string;
  private dbPath: string;
  // Indexed by rowid (the binary's 0-based index + 1).
  private present = new Uint8Array(0);
  private levelCodes = new Uint8Array(0);
  private startVerseIds = new Int32Array(0);
  private endVerseIds = new Int32Array(0);
  private levelNames: string[] = [];
  /** Read-only handle kept open to look up passage text for results. */
  private db: Database.Database | null = null;
  private textStmt: Database.Statement | null = null;

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

    // Load metadata from SQLite (rowid -> level, verse IDs); text stays on disk
    console.log('[NativeCliVectorSearch] Loading metadata from database...');
    const db = new Database(this.dbPath, { readonly: true });
    db.pragma('cache_size = -2000');
    db.pragma('mmap_size = 268435456');

    const maxRowid = (db.prepare('SELECT MAX(rowid) AS m FROM semantic_embeddings').get() as { m: number | null }).m ?? 0;
    this.present = new Uint8Array(maxRowid + 1);
    this.levelCodes = new Uint8Array(maxRowid + 1);
    this.startVerseIds = new Int32Array(maxRowid + 1);
    this.endVerseIds = new Int32Array(maxRowid + 1);
    const levelIndex = new Map<string, number>();

    const rows = db.prepare(
      'SELECT rowid, level, start_verse_id, end_verse_id FROM semantic_embeddings'
    ).iterate() as IterableIterator<{
      rowid: number;
      level: string | null;
      start_verse_id: number;
      end_verse_id: number;
    }>;
    let n = 0;
    for (const row of rows) {
      const level = row.level ?? '';
      let code = levelIndex.get(level);
      if (code === undefined) {
        code = this.levelNames.length;
        levelIndex.set(level, code);
        this.levelNames.push(level);
      }
      this.present[row.rowid] = 1;
      this.levelCodes[row.rowid] = code;
      this.startVerseIds[row.rowid] = row.start_verse_id;
      this.endVerseIds[row.rowid] = row.end_verse_id;
      n++;
    }
    if (this.levelNames.length > 256) {
      db.close();
      throw new Error(`[NativeCliVectorSearch] ${this.dbPath}: more than 256 distinct embedding levels`);
    }

    this.textStmt = db.prepare(
      'SELECT rowid, text_content FROM semantic_embeddings WHERE rowid IN (SELECT value FROM json_each(?))'
    );
    this.db = db;
    console.log(`[NativeCliVectorSearch] Loaded metadata for ${n} embeddings (passage text stays on disk).`);
  }

  async search(queryVector: Float32Array, options: VectorSearchOptions): Promise<SearchCandidate[]> {
    if (!this.db) {
      throw new Error('NativeCliVectorSearch not initialized. Call initialize() first.');
    }

    const { topN, minScore = 0.0, levels } = options;

    // Build stdin: 4 bytes topN (uint32 LE) + query vector (float32 LE)
    const headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32LE(topN * 3); // Request extra to allow filtering
    const vectorBuf = Buffer.from(queryVector.buffer, queryVector.byteOffset, queryVector.byteLength);
    const stdinData = Buffer.concat([headerBuf, vectorBuf]);

    const stdout = await runBinary(this.binaryPath, [this.embeddingsPath], stdinData, 10_000, 1024 * 1024);

    // Parse JSON output: [{index, score}, ...]
    const rawResults = JSON.parse(stdout) as Array<{ index: number; score: number }>;

    // Map indices to metadata and filter
    const picked: Array<{ rowid: number; score: number }> = [];
    for (const raw of rawResults) {
      // Binary index is 0-based, rowid is 1-based
      const rowid = raw.index + 1;
      if (rowid >= this.present.length || !this.present[rowid]) continue;

      if (levels && levels.length > 0 && !levels.includes(this.levelNames[this.levelCodes[rowid]])) {
        continue;
      }

      if (raw.score < minScore) continue;

      picked.push({ rowid, score: raw.score });
      if (picked.length >= topN) break;
    }

    const texts = new Map<number, string>();
    if (picked.length > 0 && this.textStmt) {
      const found = this.textStmt.all(JSON.stringify(picked.map(p => p.rowid))) as Array<{ rowid: number; text_content: string | null }>;
      for (const r of found) texts.set(r.rowid, r.text_content || '');
    }

    return picked.map(({ rowid, score }) => ({
      index: rowid,
      score,
      level: this.levelNames[this.levelCodes[rowid]],
      startVerseId: this.startVerseIds[rowid],
      endVerseId: this.endVerseIds[rowid],
      text: texts.get(rowid) ?? '',
    }));
  }

  async dispose(): Promise<void> {
    this.db?.close();
    this.db = null;
    this.textStmt = null;
  }
}

/**
 * Run the search binary and collect stdout. Asynchronous on purpose: the
 * previous execFileSync blocked the event loop — and every other request —
 * for the length of each search.
 */
function runBinary(file: string, args: string[], input: Buffer, timeoutMs: number, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`vec-search timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill('SIGKILL');
        reject(new Error(`vec-search output exceeded ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks).toString());
      else reject(new Error(`vec-search exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
    child.stdin.on('error', () => { /* the binary may exit before reading all input */ });
    child.stdin.end(input);
  });
}
