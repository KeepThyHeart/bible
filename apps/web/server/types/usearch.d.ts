// Type declaration for the 'usearch' npm package.
// Covers the subset of the API used by UsearchVectorSearch.
declare module 'usearch' {
  export interface IndexOptions {
    /** Distance metric. */
    metric: 'cos' | 'l2sq' | 'ip' | 'haversine' | 'divergence' | 'hamming' | 'tanimoto' | 'sorensen';
    /** HNSW connectivity parameter (M). Higher = better recall, more memory. */
    connectivity: number;
    /** Vector dimensionality. */
    dimensions: number;
    /** Scalar type for stored vectors. */
    dtype: 'f32' | 'f64' | 'f16' | 'i8' | 'b1';
  }

  export interface SearchResult {
    /** Matched keys (BigInt array). */
    keys: BigInt64Array;
    /** Corresponding distances (lower = closer for cosine distance). */
    distances: Float32Array;
    /** Number of results returned. */
    count: number;
  }

  export class Index {
    constructor(options: IndexOptions);
    /** Add a vector with the given key. */
    add(key: bigint, vector: Int8Array | Float32Array | Float64Array): void;
    /** Search for the top-N nearest neighbors. */
    search(query: Int8Array | Float32Array | Float64Array, topN: number): SearchResult;
    /** Save the index to a file. */
    save(path: string): void;
    /** Load an index from a file. */
    load(path: string): void;
    /** Number of vectors in the index. */
    readonly size: number;
  }
}
