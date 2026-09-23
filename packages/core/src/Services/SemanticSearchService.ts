/**
 * Semantic Search Service
 *
 * Provides semantic (meaning-based) search across Bible text using
 * pre-computed embeddings stored in a SQLite database.
 *
 * Uses cosine similarity between query embeddings and stored verse/paragraph/chapter
 * embeddings to find semantically relevant passages.
 *
 * ## Index formats
 *
 * The index describes itself in `index_metadata`, and this service reads the
 * vectors the way that metadata says to:
 *
 *   - **Format 1** (no `index_format` key): full-width float32 vectors, compared
 *     by raw cosine. The query model is the one such packs were built around,
 *     laid out under the `Xenova/nomic-embed-text-v1` directory name.
 *   - **Format 2**: the index names its own `vector_encoding` (`float32` or
 *     `int8`), `embedding_dim` (a Matryoshka truncation of the model's output),
 *     an optional `mean_vector` it was centred on, the `min_similarity` that
 *     suits its score scale, and the query model (`query_model`,
 *     `query_model_dtype`, `query_prefix`) whose output it was built to match.
 *
 * The query side has to be transformed exactly as the documents were, so the
 * index - not the caller - owns that transform: `search()` takes the model's
 * raw output and applies it.
 */

import { ISql } from '../Data/Core/ISql';
import { VerseId } from '../Data/Core/Types';

// ============================================================================
// Types
// ============================================================================

export type SemanticLevel = 'verse' | 'paragraph' | 'chapter';

export interface SemanticSearchResult {
  /** Unique ID of the embedding entry */
  id: string;
  /** Whether this is a verse, paragraph, or chapter match */
  level: SemanticLevel;
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

/** The embedding model a query has to go through to be comparable with this index. */
export interface SemanticQueryModel {
  /** Model id, resolved by the embedding runtime under the local models directory. */
  modelId: string;
  /** Weight precision to load (`fp32`, `q8`, ...), which selects the ONNX file. */
  dtype: string;
  /** Text prepended to the query before embedding. */
  prefix: string;
}

export interface SemanticSearchOptions {
  /** Maximum number of results to return */
  maxResults?: number;
  /** Which levels to search */
  levels?: SemanticLevel[];
  /** Minimum similarity threshold (0-1). Defaults to the index's own calibrated threshold. */
  minSimilarity?: number;
  /**
   * Return one result per passage rather than one per embedding row.
   *
   * An index can hold several rows for the same passage (one per chunk and
   * facet), and without this a single verse can fill several slots of the
   * result list. The highest-scoring row stands in for its passage.
   */
  collapsePassages?: boolean;
}

// ============================================================================
// Index layout
// ============================================================================

const LEVELS: readonly SemanticLevel[] = ['verse', 'paragraph', 'chapter'];

/** Threshold for indexes that do not declare one - tuned on raw full-width cosine. */
const LEGACY_MIN_SIMILARITY = 0.3;

/**
 * Query model for a format-1 index. Those packs ship the nomic v1.5 weights
 * under this directory name, so it is the name the runtime has to ask for.
 */
const LEGACY_QUERY_MODEL: SemanticQueryModel = {
  modelId: 'Xenova/nomic-embed-text-v1',
  dtype: 'fp32',
  prefix: 'search_query: ',
};

/** Rows read per page while loading, to bound the transient row objects. */
const LOAD_PAGE_SIZE = 20000;

type VectorEncoding = 'float32' | 'int8';

interface IndexLayout {
  dims: number;
  encoding: VectorEncoding;
  /** Present when the stored vectors were centred before normalising. */
  meanVector: Float32Array | null;
  minSimilarity: number;
  queryModel: SemanticQueryModel;
}

/** Everything `search()` scans, in flat typed arrays rather than per-row objects. */
interface LoadedEmbeddings {
  count: number;
  ids: string[];
  previews: string[];
  levels: Uint8Array;
  startVerseIds: Int32Array;
  endVerseIds: Int32Array;
  /** `count * dims` components, row-major. */
  vectors: Float32Array | Int8Array;
  /** 1 / |v| per row, so a dot product with a unit query is a cosine. */
  inverseNorms: Float32Array;
}

// ============================================================================
// Service
// ============================================================================

export class SemanticSearchService {
  private readonly layout: IndexLayout;
  private embeddings: LoadedEmbeddings | null = null;

  constructor(
    private semanticDb: ISql
  ) {
    this.layout = readIndexLayout(this.semanticDb);
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

  /** The model, precision and prefix a query must be embedded with for this index. */
  getQueryModel(): SemanticQueryModel {
    return this.layout.queryModel;
  }

  /**
   * Get statistics about the semantic index
   */
  getStats(): { total: number; verses: number; paragraphs: number; chapters: number } {
    const rows = this.semanticDb.queryAll<{ level: string; count: number }>(
      'SELECT level, COUNT(*) as count FROM semantic_embeddings GROUP BY level'
    );
    const byLevel = new Map(rows.map(row => [row.level, row.count]));
    const verses = byLevel.get('verse') ?? 0;
    const paragraphs = byLevel.get('paragraph') ?? 0;
    const chapters = byLevel.get('chapter') ?? 0;

    return { total: verses + paragraphs + chapters, verses, paragraphs, chapters };
  }

  /**
   * Load all embeddings into memory for fast search.
   * Call this once at startup. Resident size is roughly rows x dims x bytes per
   * component: ~1.2 GB for 388K full-width float32 rows, ~100 MB at 256-d int8.
   */
  loadEmbeddings(): void {
    if (this.embeddings) return;

    const { dims, encoding } = this.layout;
    const bytesPerComponent = encoding === 'int8' ? 1 : 4;
    const expectedBlobBytes = dims * bytesPerComponent;

    const countRow = this.semanticDb.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM semantic_embeddings'
    );
    const count = countRow?.count ?? 0;

    const loaded: LoadedEmbeddings = {
      count: 0,
      ids: new Array<string>(count),
      previews: new Array<string>(count),
      levels: new Uint8Array(count),
      startVerseIds: new Int32Array(count),
      endVerseIds: new Int32Array(count),
      vectors: encoding === 'int8' ? new Int8Array(count * dims) : new Float32Array(count * dims),
      inverseNorms: new Float32Array(count),
    };

    // Keyset paging on rowid, which SQLite assigns from 1 upward.
    let lastRowId = 0;
    let row = 0;
    for (;;) {
      const page = this.semanticDb.queryAll<{
        rid: number;
        id: string;
        level: string;
        start_verse_id: number;
        end_verse_id: number;
        text_preview: string | null;
        embedding_blob: Uint8Array;
      }>(
        `SELECT rowid AS rid, id, level, start_verse_id, end_verse_id, text_preview, embedding_blob
         FROM semantic_embeddings WHERE rowid > ? ORDER BY rowid LIMIT ?`,
        [lastRowId, LOAD_PAGE_SIZE]
      );
      if (page.length === 0) break;

      for (const entry of page) {
        if (row >= count) break;
        const blob = entry.embedding_blob;
        if (blob.byteLength !== expectedBlobBytes) {
          throw new Error(
            `Semantic index row "${entry.id}" holds ${blob.byteLength} bytes; ` +
              `${dims}-d ${encoding} vectors are ${expectedBlobBytes}.`
          );
        }
        const levelIndex = LEVELS.indexOf(entry.level as SemanticLevel);
        if (levelIndex < 0) {
          throw new Error(`Semantic index row "${entry.id}" has unknown level "${entry.level}".`);
        }

        const offset = row * dims;
        // Copied out of the row's buffer: a view would pin every page's
        // backing store, and a float32 view needs 4-byte alignment the driver
        // does not promise.
        if (encoding === 'int8') {
          loaded.vectors.set(new Int8Array(blob.buffer, blob.byteOffset, dims), offset);
        } else {
          loaded.vectors.set(
            new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + expectedBlobBytes)),
            offset
          );
        }
        loaded.inverseNorms[row] = inverseNorm(loaded.vectors, offset, dims);
        loaded.ids[row] = entry.id;
        loaded.previews[row] = entry.text_preview || '';
        loaded.levels[row] = levelIndex;
        loaded.startVerseIds[row] = entry.start_verse_id;
        loaded.endVerseIds[row] = entry.end_verse_id;
        row++;
      }
      lastRowId = page[page.length - 1].rid;
    }

    loaded.count = row;
    this.embeddings = loaded;

    console.log(`[SemanticSearch] Loaded ${row} embeddings into memory (${dims}-d ${encoding})`);
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
   * @param queryEmbedding The query model's output for the query text - full
   *   width and untransformed; the index's truncation and centring are applied here.
   * @param options Search options
   * @returns Ranked results sorted by similarity
   */
  search(queryEmbedding: Float32Array, options: SemanticSearchOptions = {}): SemanticSearchResult[] {
    const maxResults = options.maxResults ?? 20;
    const levels = options.levels ?? ['verse', 'paragraph'];
    const minSimilarity = options.minSimilarity ?? this.layout.minSimilarity;

    // Ensure embeddings are loaded
    if (!this.embeddings) {
      this.loadEmbeddings();
    }

    const loaded = this.embeddings;
    if (!loaded || loaded.count === 0) {
      return [];
    }

    const query = this.prepareQuery(queryEmbedding);
    const { dims } = this.layout;
    const wantedLevels = new Uint8Array(LEVELS.length);
    for (const level of levels) wantedLevels[LEVELS.indexOf(level)] = 1;

    const hits: Array<{ row: number; similarity: number }> = [];
    const { vectors, inverseNorms } = loaded;

    for (let row = 0; row < loaded.count; row++) {
      if (!wantedLevels[loaded.levels[row]]) continue;

      const offset = row * dims;
      let dot = 0;
      for (let i = 0; i < dims; i++) {
        dot += query[i] * vectors[offset + i];
      }
      const similarity = dot * inverseNorms[row];

      if (similarity >= minSimilarity) {
        hits.push({ row, similarity });
      }
    }

    hits.sort((a, b) => b.similarity - a.similarity);

    const results: SemanticSearchResult[] = [];
    const seenPassages = new Set<string>();
    for (const { row, similarity } of hits) {
      if (results.length >= maxResults) break;

      if (options.collapsePassages) {
        const passageKey = `${loaded.levels[row]}:${loaded.startVerseIds[row]}:${loaded.endVerseIds[row]}`;
        if (seenPassages.has(passageKey)) continue;
        seenPassages.add(passageKey);
      }

      results.push({
        id: loaded.ids[row],
        level: LEVELS[loaded.levels[row]],
        startVerseId: loaded.startVerseIds[row],
        endVerseId: loaded.endVerseIds[row],
        textPreview: loaded.previews[row],
        similarity,
        reference: '', // Will be filled in by the caller
      });
    }

    return results;
  }

  /**
   * Bring a raw query embedding into the index's vector space: truncate to the
   * index width, normalise, and - when the index was centred - subtract its
   * mean and normalise again. Mirrors what the index builder did to each document.
   */
  private prepareQuery(queryEmbedding: Float32Array): Float32Array {
    const { dims, meanVector } = this.layout;
    if (queryEmbedding.length < dims) {
      throw new Error(
        `Query embedding has ${queryEmbedding.length} dimensions; this index needs at least ${dims}.`
      );
    }

    const query = normalize(queryEmbedding.slice(0, dims));
    if (!meanVector) return query;

    for (let i = 0; i < dims; i++) query[i] -= meanVector[i];
    return normalize(query);
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
// Index metadata
// ============================================================================

/**
 * Read how the index's vectors are stored and how a query must be prepared.
 *
 * An index that declares something this reader cannot honour is an error:
 * guessing would return confidently wrong rankings rather than no results.
 */
function readIndexLayout(db: ISql): IndexLayout {
  const metadata = new Map<string, string>();
  const rows = db.queryAll<{ key: string; value: string }>('SELECT key, value FROM index_metadata');
  for (const row of rows) metadata.set(row.key, row.value);

  const dims = Number(metadata.get('embedding_dim') ?? 768);
  if (!Number.isInteger(dims) || dims <= 0) {
    throw new Error(`Semantic index declares an invalid embedding_dim "${metadata.get('embedding_dim')}".`);
  }

  const format = metadata.get('index_format') ?? '1';
  if (format === '1') {
    return {
      dims,
      encoding: 'float32',
      meanVector: null,
      minSimilarity: LEGACY_MIN_SIMILARITY,
      queryModel: LEGACY_QUERY_MODEL,
    };
  }
  if (format !== '2') {
    throw new Error(`Semantic index format "${format}" is newer than this app understands.`);
  }

  const encoding = metadata.get('vector_encoding') ?? 'float32';
  if (encoding !== 'float32' && encoding !== 'int8') {
    throw new Error(`Semantic index uses unsupported vector_encoding "${encoding}".`);
  }

  const meanJson = metadata.get('mean_vector');
  const meanVector = meanJson ? Float32Array.from(JSON.parse(meanJson) as number[]) : null;
  if (meanVector && meanVector.length !== dims) {
    throw new Error(`Semantic index mean_vector has ${meanVector.length} components; embedding_dim is ${dims}.`);
  }

  const minSimilarity = Number(metadata.get('min_similarity') ?? LEGACY_MIN_SIMILARITY);

  return {
    dims,
    encoding,
    meanVector,
    minSimilarity: Number.isFinite(minSimilarity) ? minSimilarity : LEGACY_MIN_SIMILARITY,
    queryModel: {
      modelId: metadata.get('query_model') ?? metadata.get('embedding_model') ?? LEGACY_QUERY_MODEL.modelId,
      dtype: metadata.get('query_model_dtype') ?? 'fp32',
      prefix: metadata.get('query_prefix') ?? LEGACY_QUERY_MODEL.prefix,
    },
  };
}

// ============================================================================
// Math Utilities
// ============================================================================

/** L2-normalise in place and return the same array. A zero vector is left as is. */
function normalize(vector: Float32Array): Float32Array {
  let sumOfSquares = 0;
  for (let i = 0; i < vector.length; i++) sumOfSquares += vector[i] * vector[i];
  const norm = Math.sqrt(sumOfSquares);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  }
  return vector;
}

function inverseNorm(vectors: Float32Array | Int8Array, offset: number, dims: number): number {
  let sumOfSquares = 0;
  for (let i = 0; i < dims; i++) {
    const component = vectors[offset + i];
    sumOfSquares += component * component;
  }
  return sumOfSquares > 0 ? 1 / Math.sqrt(sumOfSquares) : 0;
}

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
