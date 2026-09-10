/**
 * Web Worker for browser-side semantic search.
 *
 * Handles both query embedding (via ONNX) and vector search (brute-force int8).
 * Runs in a dedicated worker thread to avoid blocking the UI.
 *
 * Message protocol:
 *   → { type: 'init', embeddingsUrl, metadataUrl }
 *   ← { type: 'progress', stage, detail }
 *   ← { type: 'ready' }
 *   → { type: 'search', query, module, maxResults?, levels?, minScore? }
 *   ← { type: 'results', results, timings }
 *   → { type: 'dispose' }
 *   ← { type: 'error', message }
 */

// ── Types ───────────────────────────────────────────────────────────────────

interface MetadataRow {
  level: string;
  startVerseId: number;
  endVerseId: number;
  textPreview: string;
}

interface MetadataFile {
  model: string;
  dims: number;
  precision: string;
  centered: boolean;
  meanVector: number[];
  count: number;
  rows: MetadataRow[];
}

interface SearchResult {
  verseId: number;
  endVerseId: number;
  reference: string;
  text: string;
  snippet: string;
  score: number;
  module: string;
  type: string;
}

// ── Limits ──────────────────────────────────────────────────────────────────

/**
 * Duplicated from MAX_SEARCH_QUERY_CHARS in @bible/core — workers cannot import
 * from core, which is CJS and breaks Vite's worker build (same constraint as
 * offline/bibleWorker.ts). Keep the two in sync.
 *
 * Attention is O(n²) and the tokenizer's own limit is 8192 tokens, so an
 * unbounded query is a CPU/memory amplifier. Here the victim is the user's own
 * tab rather than a server, but a pasted chapter still freezes the worker for
 * seconds and balloons its memory, so the same ceiling applies.
 */
const MAX_SEARCH_QUERY_CHARS = 512;

// ── State ───────────────────────────────────────────────────────────────────

let vectors: Int8Array | null = null;
let metadata: MetadataRow[] | null = null;
let meanVector: number[] | null = null;
let dims = 128;
let rowCount = 0;
let extractor: any = null;
let initialized = false;

// ── Vector search ───────────────────────────────────────────────────────────

function searchInt8(queryFloat32: Float32Array, module: string, maxResults: number, levels?: string[], minScore = 0.0): SearchResult[] {
  if (!vectors || !metadata) throw new Error('Not initialized');

  // Quantize query to int8
  const queryInt8 = new Int8Array(queryFloat32.length);
  for (let i = 0; i < queryFloat32.length; i++) {
    queryInt8[i] = Math.round(Math.max(-127, Math.min(127, queryFloat32[i] * 127)));
  }

  const normFactor = 1 / (127 * 127);
  const scored: Array<{ index: number; score: number }> = [];

  for (let row = 0; row < rowCount; row++) {
    const meta = metadata[row];
    if (levels && levels.length > 0 && !levels.includes(meta.level)) continue;

    // Integer dot product
    const offset = row * dims;
    let dot = 0;
    for (let d = 0; d < dims; d++) {
      dot += queryInt8[d] * vectors[offset + d];
    }
    const score = dot * normFactor;

    if (score >= minScore) {
      scored.push({ index: row, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, maxResults).map(s => {
    const meta = metadata![s.index];
    return {
      verseId: meta.startVerseId,
      endVerseId: meta.endVerseId,
      reference: '', // Resolved client-side from verseId
      text: meta.textPreview,
      snippet: meta.textPreview,
      score: Math.round(s.score * 1000) / 1000,
      module,
      type: meta.level,
    };
  });
}

// ── Embedding ───────────────────────────────────────────────────────────────

async function embedQuery(query: string): Promise<Float32Array> {
  if (!extractor || !meanVector) throw new Error('Embedder not initialized');

  // No prefix for centered search
  const clamped = query.length > MAX_SEARCH_QUERY_CHARS ? query.slice(0, MAX_SEARCH_QUERY_CHARS) : query;
  const output = await extractor([clamped], { pooling: 'mean', normalize: true });
  const embedding: number[] = output.tolist()[0];

  // Truncate to dims (Matryoshka)
  const truncated = embedding.slice(0, dims);

  // Normalize
  let norm = 0;
  for (let i = 0; i < truncated.length; i++) norm += truncated[i] * truncated[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < truncated.length; i++) truncated[i] /= norm;

  // Mean-center
  for (let i = 0; i < truncated.length; i++) truncated[i] -= meanVector[i];

  // Re-normalize
  norm = 0;
  for (let i = 0; i < truncated.length; i++) norm += truncated[i] * truncated[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < truncated.length; i++) truncated[i] /= norm;

  return new Float32Array(truncated);
}

// ── Streaming download with byte-level progress ──────────────────────────────

/**
 * Fetch a URL while posting `progress` messages with loaded/total bytes so the UI
 * can show a real progress bar. Throws a descriptive error if the file is missing
 * (e.g. the server returned the SPA HTML because the index files aren't deployed).
 */
async function fetchWithProgress(
  url: string,
  stage: 'metadata' | 'vectors',
  detail: string,
  expectJson: boolean,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${detail} failed (HTTP ${res.status}) at ${url}. The semantic index files may be missing from the server's data directory.`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (expectJson && !contentType.includes('json')) {
    throw new Error(`Expected JSON but got '${contentType}' from ${url}. The file is likely missing and the server returned the app HTML instead.`);
  }

  const total = Number(res.headers.get('content-length')) || 0;

  // Non-streaming fallback if the body stream isn't available.
  if (!res.body) {
    postMessage({ type: 'progress', stage, detail, total: total || undefined });
    return res.arrayBuffer();
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastPost = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.length;
    const now = performance.now();
    if (now - lastPost > 100) {
      lastPost = now;
      // content-length may reflect the compressed size for gzipped JSON; only
      // report a percent while the decoded byte count hasn't overshot it.
      const percent = total && loaded <= total ? loaded / total : undefined;
      postMessage({ type: 'progress', stage, detail, loaded, total: total || undefined, percent });
    }
  }

  postMessage({
    type: 'progress', stage, detail, loaded,
    total: total || undefined,
    percent: total && loaded <= total ? loaded / total : (total ? 1 : undefined),
  });

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out.buffer;
}

// ── Message handler ─────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'init': {
        const { embeddingsUrl, metadataUrl, modelHost, ortWasmPath } = msg;

        // Load metadata JSON (contains mean vector + row data)
        const metaBuffer = await fetchWithProgress(metadataUrl, 'metadata', 'Downloading search index', true);
        const metaData: MetadataFile = JSON.parse(new TextDecoder().decode(metaBuffer));
        metadata = metaData.rows;
        meanVector = metaData.meanVector;
        dims = metaData.dims;
        rowCount = metaData.count;

        // Load binary embeddings
        const binBuffer = await fetchWithProgress(embeddingsUrl, 'vectors', 'Downloading search vectors', false);

        // Parse: 4-byte row count header, 4-byte dims header, then N × dims int8 vectors
        const headerView = new DataView(binBuffer);
        const binRowCount = headerView.getUint32(0, true);
        const binDims = headerView.getUint32(4, true);

        if (binRowCount !== rowCount || binDims !== dims) {
          throw new Error(`Binary header mismatch: got ${binRowCount}×${binDims}, expected ${rowCount}×${dims}`);
        }

        vectors = new Int8Array(binBuffer, 8); // Skip 8-byte header

        // Load the embedding model
        postMessage({ type: 'progress', stage: 'model', detail: 'Loading the search engine' });
        const { pipeline, env } = await import('@huggingface/transformers');
        // ONNX Runtime's wasm backend is a SEPARATE download from the model, and
        // transformers.js defaults it to the jsDelivr CDN. Our CSP is
        // `default-src 'self'`, so that import is refused and the pipeline dies
        // with "no available backend found. ERR: [wasm] TypeError: Failed to
        // fetch dynamically imported module: https://cdn.jsdelivr.net/...".
        // `ortWasmPath` points at our own copy (emitted by ortWasmPlugin in
        // vite.config.ts); it must end in '/' — ort concatenates the file name
        // onto it directly.
        const ortWasm = env.backends?.onnx?.wasm;
        if (ortWasmPath && ortWasm) {
          ortWasm.wasmPaths = ortWasmPath.endsWith('/') ? ortWasmPath : `${ortWasmPath}/`;
          // Cross-origin isolation is off (COEP is deliberately not enabled —
          // it breaks other wasm here), so SharedArrayBuffer is unavailable and
          // the threaded build would fail to spin up its worker pool. Pin to a
          // single thread rather than letting ort discover that the hard way.
          ortWasm.numThreads = 1;
        }
        // When a self-hosted model host is provided, fetch the model from our own
        // server (offline-capable, no HuggingFace CDN dependency). Otherwise fall
        // back to the library default (HuggingFace CDN).
        if (modelHost) {
          env.allowLocalModels = false;          // skip the local-filesystem probe (we're in a browser)
          env.allowRemoteModels = true;
          env.remoteHost = modelHost;            // e.g. https://host/data/models
          env.remotePathTemplate = '{model}/';   // → {modelHost}/nomic-ai/nomic-embed-text-v1.5/onnx/model_quantized.onnx
        }
        extractor = await pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5', {
          dtype: 'q8' as any,
          // Report per-file download progress for the model (~130 MB) so the UI bar advances.
          progress_callback: (p: any) => {
            if (p?.status === 'progress' && typeof p.loaded === 'number') {
              const total = typeof p.total === 'number' ? p.total : undefined;
              postMessage({
                type: 'progress',
                stage: 'model',
                detail: 'Downloading the search engine',
                loaded: p.loaded,
                total,
                percent: total ? p.loaded / total : undefined,
              });
            }
          },
        } as any);

        // Warm up
        await embedQuery('warmup');

        initialized = true;
        postMessage({ type: 'ready' });
        break;
      }

      case 'search': {
        if (!initialized) {
          postMessage({ type: 'error', message: 'Worker not initialized' });
          return;
        }

        const { query, module, maxResults = 20, levels, minScore = 0.0 } = msg;

        const t0 = performance.now();
        const queryVector = await embedQuery(query);
        const embedTime = performance.now() - t0;

        const t1 = performance.now();
        const results = searchInt8(queryVector, module, maxResults, levels, minScore);
        const searchTime = performance.now() - t1;

        postMessage({
          type: 'results',
          results,
          timings: {
            embed: Math.round(embedTime),
            vectorSearch: Math.round(searchTime),
            total: Math.round(embedTime + searchTime),
          },
        });
        break;
      }

      case 'dispose': {
        vectors = null;
        metadata = null;
        meanVector = null;
        extractor = null;
        initialized = false;
        break;
      }
    }
  } catch (err: any) {
    postMessage({ type: 'error', message: err.message || String(err) });
  }
};
