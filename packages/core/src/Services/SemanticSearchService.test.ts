import { describe, it, expect, afterEach } from 'vitest';
import { cosineSimilarity, SemanticSearchService } from './SemanticSearchService';
import { TestSqliteProvider } from '../__tests__/helpers/TestSqliteProvider';

/**
 * Cosine similarity is the scoring function behind every semantic search hit.
 *
 * This file used to declare its own copy of it - the header said "it's a
 * private module function" - so the tests passed no matter what the service
 * computed. The function is exported now and tested for real.
 */

describe('SemanticSearchService - Cosine Similarity', () => {
  it('should return 1.0 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3, 4, 5]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('should return -1.0 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('should return 0 for zero vectors', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should return 0 for mismatched lengths', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should be scale-invariant', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([2, 4, 6]); // 2x scale of a
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('should compute correct similarity for known vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 1]);
    // cos(45°) = 1/sqrt2 ~= 0.7071
    expect(cosineSimilarity(a, b)).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('should handle high-dimensional vectors (embedding size)', () => {
    const dim = 768;
    const a = new Float32Array(dim);
    const b = new Float32Array(dim);

    // Create two vectors with known similarity
    for (let i = 0; i < dim; i++) {
      a[i] = Math.sin(i * 0.1);
      b[i] = Math.sin(i * 0.1 + 0.5); // shifted version
    }

    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});

// ============================================================================
// Index fixtures
// ============================================================================

interface FixtureRow {
  id: string;
  level?: 'verse' | 'paragraph' | 'chapter';
  start: number;
  end?: number;
  preview?: string;
  blob: Buffer;
}

const openDbs: TestSqliteProvider[] = [];

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()!.close();
});

function buildIndex(metadata: Record<string, string>, rows: FixtureRow[]): TestSqliteProvider {
  const db = new TestSqliteProvider(':memory:');
  openDbs.push(db);
  db.exec(`
    CREATE TABLE semantic_embeddings (
      id TEXT NOT NULL,
      level TEXT NOT NULL,
      start_verse_id INTEGER NOT NULL,
      end_verse_id INTEGER NOT NULL,
      text_preview TEXT,
      embedding_blob BLOB NOT NULL
    );
    CREATE TABLE index_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  for (const [key, value] of Object.entries(metadata)) {
    db.execute('INSERT INTO index_metadata (key, value) VALUES (?, ?)', [key, value]);
  }
  for (const row of rows) {
    db.execute(
      'INSERT INTO semantic_embeddings (id, level, start_verse_id, end_verse_id, text_preview, embedding_blob) VALUES (?, ?, ?, ?, ?, ?)',
      [row.id, row.level ?? 'verse', row.start, row.end ?? row.start, row.preview ?? '', row.blob]
    );
  }
  return db;
}

function float32Blob(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

function unit(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map(v => v / norm);
}

/** The document transform a format-2 builder applies: truncate, normalise, centre, normalise, quantise. */
function int8Blob(raw: number[], dims: number, mean: number[] | null): Buffer {
  let vector = unit(raw.slice(0, dims));
  if (mean) vector = unit(vector.map((v, i) => v - mean[i]));
  return Buffer.from(Int8Array.from(vector.map(v => Math.round(Math.max(-127, Math.min(127, v * 127))))).buffer);
}

// ============================================================================
// Format 1 - legacy full-width float32
// ============================================================================

describe('SemanticSearchService - format 1 (float32, no index_format key)', () => {
  const metadata = { embedding_model: 'nomic-ai/nomic-embed-text-v1.5', embedding_dim: '3' };

  it('ranks by cosine and applies the legacy 0.3 floor', () => {
    const db = buildIndex(metadata, [
      { id: 'near', start: 1001001, blob: float32Blob(unit([1, 0.1, 0])) },
      { id: 'far', start: 1001002, blob: float32Blob(unit([0, 0, 1])) },
      { id: 'mid', start: 1001003, blob: float32Blob(unit([1, 1, 0])) },
    ]);
    const service = new SemanticSearchService(db);

    const results = service.search(new Float32Array([1, 0, 0]));

    expect(results.map(r => r.id)).toEqual(['near', 'mid']);
    expect(results[0].similarity).toBeCloseTo(cosineSimilarity(new Float32Array([1, 0, 0]), new Float32Array([1, 0.1, 0])), 5);
  });

  it('names the query model legacy packs ship', () => {
    const service = new SemanticSearchService(buildIndex(metadata, []));

    expect(service.getQueryModel()).toEqual({
      modelId: 'Xenova/nomic-embed-text-v1',
      dtype: 'fp32',
      prefix: 'search_query: ',
    });
  });

});

// ============================================================================
// Format 2 - self-describing, truncated, int8, centred
// ============================================================================

describe('SemanticSearchService - format 2 (int8, truncated, centred)', () => {
  const mean = [0.1, 0.05, 0, -0.05];
  const metadata = {
    index_format: '2',
    embedding_model: 'nomic-ai/nomic-embed-text-v1.5',
    embedding_dim: '4',
    vector_encoding: 'int8',
    vector_scale: '127',
    mean_vector: JSON.stringify(mean),
    min_similarity: '0.5',
    query_model: 'nomic-ai/nomic-embed-text-v1.5',
    query_model_dtype: 'q8',
    query_prefix: 'search_query: ',
  };

  // Six-wide "model output"; the index keeps the first four dimensions.
  const docs = {
    creation: [0.9, 0.1, 0.1, 0.0, 0.7, -0.2],
    shepherd: [0.1, 0.9, 0.2, 0.1, -0.3, 0.4],
    exodus: [0.2, 0.1, 0.9, 0.3, 0.1, 0.1],
  };

  function service(extraRows: FixtureRow[] = []): SemanticSearchService {
    return new SemanticSearchService(
      buildIndex(metadata, [
        { id: 'creation', start: 1001001, blob: int8Blob(docs.creation, 4, mean) },
        { id: 'shepherd', start: 19023001, blob: int8Blob(docs.shepherd, 4, mean) },
        { id: 'exodus', start: 2014021, blob: int8Blob(docs.exodus, 4, mean) },
        ...extraRows,
      ])
    );
  }

  it('declares its own query model', () => {
    expect(service().getQueryModel()).toEqual({
      modelId: 'nomic-ai/nomic-embed-text-v1.5',
      dtype: 'q8',
      prefix: 'search_query: ',
    });
  });

  it('transforms a full-width query the way the documents were built', () => {
    // The raw model output for a document should find that document at ~1.0:
    // only true if the service truncates, normalises and centres the query.
    const results = service().search(Float32Array.from(docs.shepherd));

    expect(results[0].id).toBe('shepherd');
    expect(results[0].similarity).toBeGreaterThan(0.99);
  });

  it('uses the index-declared floor when the caller names none', () => {
    const results = service().search(Float32Array.from(docs.creation));

    expect(results.every(r => r.similarity >= 0.5)).toBe(true);
    expect(results.map(r => r.id)).toContain('creation');
    expect(service().search(Float32Array.from(docs.creation), { minSimilarity: -1 })).toHaveLength(3);
  });

  it('collapses facet rows of the same passage when asked', () => {
    const facet: FixtureRow = { id: 'shepherd_s0', start: 19023001, blob: int8Blob(docs.shepherd, 4, mean) };

    const rows = service([facet]).search(Float32Array.from(docs.shepherd), { minSimilarity: 0.9 });
    const passages = service([facet]).search(Float32Array.from(docs.shepherd), { minSimilarity: 0.9, collapsePassages: true });

    expect(rows.map(r => r.startVerseId)).toEqual([19023001, 19023001]);
    expect(passages.map(r => r.startVerseId)).toEqual([19023001]);
  });

  it('searches only the requested levels', () => {
    const chapter: FixtureRow = { id: 'psalm23', level: 'chapter', start: 19023001, end: 19023006, blob: int8Blob(docs.shepherd, 4, mean) };
    const query = Float32Array.from(docs.shepherd);

    expect(service([chapter]).search(query).map(r => r.level)).not.toContain('chapter');
    expect(service([chapter]).search(query, { levels: ['chapter'] }).map(r => r.id)).toEqual(['psalm23']);
  });

  it('refuses a query narrower than the index', () => {
    expect(() => service().search(new Float32Array([1, 0, 0]))).toThrow(/at least 4/);
  });
});

// ============================================================================
// Malformed indexes
// ============================================================================

describe('SemanticSearchService - malformed indexes', () => {
  it('rejects a blob whose width disagrees with embedding_dim', () => {
    const db = buildIndex(
      { index_format: '2', embedding_dim: '4', vector_encoding: 'int8' },
      [{ id: 'wide', start: 1001001, blob: Buffer.from(new Int8Array(8).buffer) }]
    );

    expect(() => new SemanticSearchService(db).loadEmbeddings()).toThrow(/8 bytes; 4-d int8 vectors are 4/);
  });

  it('refuses an index format it does not know', () => {
    expect(() => new SemanticSearchService(buildIndex({ index_format: '3', embedding_dim: '4' }, []))).toThrow(/newer/);
  });

  it('refuses an encoding it does not know', () => {
    const db = buildIndex({ index_format: '2', embedding_dim: '4', vector_encoding: 'binary' }, []);

    expect(() => new SemanticSearchService(db)).toThrow(/binary/);
  });

  it('refuses a mean vector of the wrong width', () => {
    const db = buildIndex({ index_format: '2', embedding_dim: '4', vector_encoding: 'int8', mean_vector: '[0,0]' }, []);

    expect(() => new SemanticSearchService(db)).toThrow(/2 components/);
  });
});

// ============================================================================
// Passage rows and vector search (task 0070)
// ============================================================================

describe('SemanticSearchService - passage rows and searchByVectors', () => {
  const mean = [0.1, 0.05, 0, -0.05];
  const metadata = {
    index_format: '2',
    embedding_dim: '4',
    vector_encoding: 'int8',
    mean_vector: JSON.stringify(mean),
    min_similarity: '0.5',
  };
  const raw = {
    a: [0.9, 0.1, 0.1, 0.0],
    b: [0.1, 0.9, 0.2, 0.1],
    c: [0.2, 0.1, 0.9, 0.3],
    d: [0.8, 0.3, 0.1, 0.1],
  };

  function svc(extraMeta: Record<string, string> = {}): SemanticSearchService {
    return new SemanticSearchService(
      buildIndex({ ...metadata, ...extraMeta }, [
        { id: 'a', start: 1001001, blob: int8Blob(raw.a, 4, mean) },
        { id: 'a_s0', start: 1001001, blob: int8Blob(raw.d, 4, mean) },
        { id: 'b', start: 1001002, blob: int8Blob(raw.b, 4, mean) },
        { id: 'c', start: 2001001, blob: int8Blob(raw.c, 4, mean) },
        { id: 'p', level: 'paragraph', start: 1001001, end: 1001002, blob: int8Blob(raw.a, 4, mean) },
        { id: 'ch', level: 'chapter', start: 1001001, end: 1001031, blob: int8Blob(raw.b, 4, mean) },
      ])
    );
  }

  function norm(v: Float32Array): number {
    return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  }

  it('returns unit vectors for rows inside the selection, honouring levels', () => {
    const rows = svc().getPassageRows(1001001, 1001001, ['verse', 'paragraph']);

    expect(rows.map(r => r.id)).toEqual(['a', 'a_s0']);
    for (const row of rows) expect(norm(row.vector)).toBeCloseTo(1, 5);

    const span = svc().getPassageRows(1001001, 1001002, ['verse', 'paragraph']);
    expect(span.map(r => r.id).sort()).toEqual(['a', 'a_s0', 'b', 'p']);
    expect(svc().getPassageRows(1001001, 1001002, ['chapter'])).toEqual([]);
    expect(svc().getPassageRows(9999999, 9999999, ['verse'])).toEqual([]);
  });

  it('returns unit vectors for float32 indexes too', () => {
    const db = buildIndex({ embedding_dim: '3' }, [
      { id: 'x', start: 1001001, blob: float32Blob([3, 0, 4]) },
    ]);
    const rows = new SemanticSearchService(db).getPassageRows(1001001, 1001001, ['verse']);

    expect(norm(rows[0].vector)).toBeCloseTo(1, 5);
    expect(rows[0].vector[0]).toBeCloseTo(0.6, 5);
  });

  it('ranks a row\'s own vector first with similarity about 1', () => {
    const service = svc();
    const [row] = service.getPassageRows(1001002, 1001002, ['verse']);

    const [hits] = service.searchByVectors([row.vector], { levels: ['verse'], topK: 3 });

    expect(hits[0].id).toBe('b');
    expect(hits[0].similarity).toBeCloseTo(1, 4);
    expect(hits).toHaveLength(3);
  });

  it('applies no similarity floor', () => {
    const service = svc();
    const [row] = service.getPassageRows(1001002, 1001002, ['verse']);

    const [hits] = service.searchByVectors([row.vector], { levels: ['verse'], topK: 10 });

    expect(hits).toHaveLength(4); // every verse row, even below the 0.5 index floor
  });

  it('answers several queries in one pass exactly as separate calls', () => {
    const service = svc();
    const vectors = service.getPassageRows(1001001, 2001001, ['verse']).map(r => r.vector);

    const together = service.searchByVectors(vectors, { levels: ['verse', 'paragraph'], topK: 3 });
    const apart = vectors.map(v => service.searchByVectors([v], { levels: ['verse', 'paragraph'], topK: 3 })[0]);

    expect(together).toEqual(apart);
    expect(together.every(h => h.length === 3)).toBe(true);
  });

  it('bounded selection equals the head of the full ranking, ties in row order', () => {
    const service = svc();
    const [row] = service.getPassageRows(1001001, 1001001, ['verse']);

    const [full] = service.searchByVectors([row.vector], { levels: ['verse', 'paragraph', 'chapter'], topK: 100 });
    const [top2] = service.searchByVectors([row.vector], { levels: ['verse', 'paragraph', 'chapter'], topK: 2 });

    expect(top2.map(h => h.id)).toEqual(full.slice(0, 2).map(h => h.id));
  });

  it('rejects a vector of the wrong width', () => {
    expect(() => svc().searchByVectors([new Float32Array(3)], { levels: ['verse'], topK: 1 })).toThrow(/4/);
  });

  it('clears the row map on unload and rebuilds it on demand', () => {
    const service = svc();
    expect(service.getPassageRows(1001001, 1001001, ['verse'])).toHaveLength(2);
    service.unloadEmbeddings();
    expect(service.getPassageRows(1001001, 1001001, ['verse'])).toHaveLength(2);
  });

  it('reads the neighbour floor from metadata, else the search floor', () => {
    expect(svc().neighbourMinSimilarity()).toBe(0.5);
    expect(svc({ neighbour_min_similarity: '0.62' }).neighbourMinSimilarity()).toBe(0.62);
    expect(new SemanticSearchService(buildIndex({ embedding_dim: '3' }, [])).neighbourMinSimilarity()).toBe(0.3);
  });

  it('search() with maxResults keeps the same head as before', () => {
    const service = svc();
    const query = Float32Array.from([...raw.a, 0, 0]);

    const all = service.search(query, { minSimilarity: -1, maxResults: 100, levels: ['verse', 'paragraph', 'chapter'] });
    const two = service.search(query, { minSimilarity: -1, maxResults: 2, levels: ['verse', 'paragraph', 'chapter'] });

    expect(two.map(r => r.id)).toEqual(all.slice(0, 2).map(r => r.id));
  });
});
