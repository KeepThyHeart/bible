/**
 * Interface for query embedding providers.
 *
 * Implementations may use local ONNX models, external APIs,
 * or browser-based inference.
 */
export interface IEmbedder {
  /** Load model or verify API connectivity. */
  initialize(): Promise<void>;

  /** Embed a single query string into a vector. */
  embedQuery(query: string): Promise<Float32Array>;

  /** Release resources (model memory, connections). */
  dispose(): Promise<void>;
}
