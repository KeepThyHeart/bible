/**
 * Semantic Search Service
 *
 * Provides semantic (meaning-based) search across Bible text using
 * pre-computed embeddings stored in a SQLite database.
 *
 * Uses cosine similarity between query embeddings and stored verse/paragraph/chapter
 * embeddings to find semantically relevant passages.
 */

import { ISql } from '../Data/Core/ISql';
import { VerseId } from '../Data/Core/Types';

// ============================================================================
// Types
// ============================================================================

export interface SemanticSearchResult {
  /** Unique ID of the embedding entry */
  id: string;
  /** Whether this is a verse, paragraph, or chapter match */
  level: 'verse' | 'paragraph' | 'chapter';
  /** Start verse ID of the matching passage */
  startVerseId: VerseId;
  /** End verse ID of the matching passage */
  endVerseId: VerseId;
  /** Preview text of the matching passage */
  textPreview: string;
  /** Cosine similarity score (0-1, higher is better) */
  similarity: number;
  /** Human-readable reference string */
  reference: string;
}

export interface ParagraphDivision {
  paragraphId: number;
  startVerseId: VerseId;
  endVerseId: VerseId;
  bookNumber: number;
  chapter: number;
}

// ============================================================================
// Service
// ============================================================================

export class SemanticSearchService {
  // Embedding dimension read from index metadata (for future validation)
  private embeddings: Map<string, { level: string; startVerseId: number; endVerseId: number; textPreview: string; vector: Float32Array }> | null = null;

  constructor(
    private semanticDb: ISql
  ) {
    // Read embedding dimension from metadata
    const dimRow = this.semanticDb.queryOne<{ value: string }>(
      "SELECT value FROM index_metadata WHERE key = 'embedding_dim'"
    );
    // dimRow contains embedding dimension for future validation
    void dimRow;
  }

  /**
   * Check if the semantic index is available and has data
   */
  isAvailable(): boolean {
    try {
      const row = this.semanticDb.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM semantic_embeddings'
      );
      return row !== undefined && row.count > 0;
    } catch {
      // Intentional: the semantic_embeddings table may not exist if the semantic index
      // hasn't been built yet. Returning false correctly indicates "not available".
      return false;
    }
  }

  /**
   * Get statistics about the semantic index
   */
  getStats(): { total: number; verses: number; paragraphs: number; chapters: number } {
    const total = this.semanticDb.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM semantic_embeddings'
    );
    const verses = this.semanticDb.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM semantic_embeddings WHERE level = 'verse'"
    );
    const paragraphs = this.semanticDb.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM semantic_embeddings WHERE level = 'paragraph'"
    );
    const chapters = this.semanticDb.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM semantic_embeddings WHERE level = 'chapter'"
    );

    return {
      total: total?.count ?? 0,
      verses: verses?.count ?? 0,
      paragraphs: paragraphs?.count ?? 0,
      chapters: chapters?.count ?? 0,
    };
  }

  /**
   * Load all embeddings into memory for fast search.
   * Call this once at startup. Uses ~90MB of memory for 31K verses + paragraphs + chapters.
   */
  loadEmbeddings(): void {
    if (this.embeddings) return;

    const rows = this.semanticDb.queryAll<{
      id: string;
      level: string;
      start_verse_id: number;
      end_verse_id: number;
      text_preview: string;
      embedding_blob: Buffer;
    }>('SELECT id, level, start_verse_id, end_verse_id, text_preview, embedding_blob FROM semantic_embeddings');

    this.embeddings = new Map();

    for (const row of rows) {
      const vector = new Float32Array(
        row.embedding_blob.buffer,
        row.embedding_blob.byteOffset,
        row.embedding_blob.byteLength / 4
      );

      this.embeddings.set(row.id, {
        level: row.level,
        startVerseId: row.start_verse_id,
        endVerseId: row.end_verse_id,
        textPreview: row.text_preview || '',
        vector,
      });
    }

    console.log(`[SemanticSearch] Loaded ${this.embeddings.size} embeddings into memory`);
  }

  /**
   * Unload embeddings from memory
   */
  unloadEmbeddings(): void {
    this.embeddings = null;
  }

  /**
   * Search for passages semantically similar to the query embedding.
   *
   * @param queryEmbedding The embedding vector for the search query
   * @param options Search options
   * @returns Ranked results sorted by similarity
   */
  search(
    queryEmbedding: Float32Array,
    options: {
      /** Maximum number of results to return */
      maxResults?: number;
      /** Which levels to search */
      levels?: Array<'verse' | 'paragraph' | 'chapter'>;
      /** Minimum similarity threshold (0-1) */
      minSimilarity?: number;
    } = {}
  ): SemanticSearchResult[] {
    const maxResults = options.maxResults ?? 20;
    const levels = options.levels ?? ['verse', 'paragraph'];
    const minSimilarity = options.minSimilarity ?? 0.3;

    // Ensure embeddings are loaded
    if (!this.embeddings) {
      this.loadEmbeddings();
    }

    if (!this.embeddings || this.embeddings.size === 0) {
      return [];
    }

    // Compute cosine similarity with all embeddings at the requested levels
    const results: SemanticSearchResult[] = [];

    for (const [id, entry] of this.embeddings) {
      if (!levels.includes(entry.level as 'verse' | 'paragraph' | 'chapter')) {
        continue;
      }

      const similarity = cosineSimilarity(queryEmbedding, entry.vector);

      if (similarity >= minSimilarity) {
        results.push({
          id,
          level: entry.level as 'verse' | 'paragraph' | 'chapter',
          startVerseId: entry.startVerseId,
          endVerseId: entry.endVerseId,
          textPreview: entry.textPreview,
          similarity,
          reference: '', // Will be filled in by the caller
        });
      }
    }

    // Sort by similarity (descending)
    results.sort((a, b) => b.similarity - a.similarity);

    // Return top N
    return results.slice(0, maxResults);
  }

  /**
   * Get paragraph divisions
   */
  getParagraphDivisions(bookNumber?: number): ParagraphDivision[] {
    let query = 'SELECT paragraph_id, start_verse_id, end_verse_id, book_number, chapter FROM paragraph_divisions';
    const params: number[] = [];

    if (bookNumber !== undefined) {
      query += ' WHERE book_number = ?';
      params.push(bookNumber);
    }

    query += ' ORDER BY start_verse_id';

    const rows = this.semanticDb.queryAll<{
      paragraph_id: number;
      start_verse_id: number;
      end_verse_id: number;
      book_number: number;
      chapter: number;
    }>(query, params);

    return rows.map(row => ({
      paragraphId: row.paragraph_id,
      startVerseId: row.start_verse_id,
      endVerseId: row.end_verse_id,
      bookNumber: row.book_number,
      chapter: row.chapter,
    }));
  }
}

// ============================================================================
// Math Utilities
// ============================================================================

/**
 * Compute cosine similarity between two vectors.
 * Both vectors should already be L2-normalized for fastest computation
 * (in which case cosine similarity = dot product).
 *
 * Exported for `SemanticSearchService.test.ts`, which previously kept its own
 * copy of this function and tested that instead.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dot / denom;
}
