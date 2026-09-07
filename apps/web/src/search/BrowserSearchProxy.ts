/**
 * Browser Search Proxy — main-thread interface to the search Web Worker.
 *
 * Implements the same ISearchProvider.semanticSearch() contract as ServerDataProvider,
 * but runs entirely in the browser using a Web Worker for embedding + vector search.
 *
 * Lazy-initializes on first search. Downloads ~180 MB on first use:
 *   - ~47 MB embeddings binary
 *   - ~60 MB metadata JSON
 *   - ~131 MB ONNX model (cached by browser after first download)
 */

import type { SearchResultSet, SearchOptions } from '../types';

export type BrowserSearchStatus = 'idle' | 'initializing' | 'ready' | 'error';

/** Progress update for the one-time semantic-search initialization. */
export interface SemanticInitProgress {
  /** Which phase of init this update is about. */
  stage: 'metadata' | 'vectors' | 'model' | 'ready' | 'error';
  /** Human-readable description of the current step. */
  detail: string;
  /** Bytes downloaded so far for this stage, if known. */
  loaded?: number;
  /** Total bytes for this stage, if known. */
  total?: number;
  /** Fraction complete for this stage (0..1), if known. */
  percent?: number;
}

export type ProgressCallback = (progress: SemanticInitProgress) => void;

export class BrowserSearchProxy {
  private worker: Worker | null = null;
  private embeddingsUrl: string;
  private metadataUrl: string;
  private modelHost: string | undefined;
  private ortWasmPath: string | undefined;
  private status: BrowserSearchStatus = 'idle';
  private initPromise: Promise<void> | null = null;
  private pendingSearch: {
    resolve: (value: SearchResultSet) => void;
    reject: (reason: any) => void;
  } | null = null;
  private onProgress: ProgressCallback | null = null;

  constructor(embeddingsUrl: string, metadataUrl: string, modelHost?: string, ortWasmPath?: string) {
    this.embeddingsUrl = embeddingsUrl;
    this.metadataUrl = metadataUrl;
    this.modelHost = modelHost;
    this.ortWasmPath = ortWasmPath;
  }

  getStatus(): BrowserSearchStatus {
    return this.status;
  }

  setProgressCallback(cb: ProgressCallback | null): void {
    this.onProgress = cb;
  }

  private ensureInitialized(): Promise<void> {
    if (this.status === 'ready') return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.status = 'initializing';
    this.initPromise = new Promise<void>((resolve, reject) => {
      this.worker = new Worker(
        new URL('./searchWorker.ts', import.meta.url),
        { type: 'module' }
      );

      const onMessage = (e: MessageEvent) => {
        const msg = e.data;
        switch (msg.type) {
          case 'progress':
            this.onProgress?.({
              stage: msg.stage,
              detail: msg.detail,
              loaded: msg.loaded,
              total: msg.total,
              percent: msg.percent,
            });
            break;
          case 'ready':
            this.status = 'ready';
            this.onProgress?.({ stage: 'ready', detail: 'Semantic search ready' });
            resolve();
            break;
          case 'error':
            if (this.status === 'initializing') {
              this.status = 'error';
              this.onProgress?.({ stage: 'error', detail: msg.message });
              reject(new Error(msg.message));
            } else if (this.pendingSearch) {
              this.pendingSearch.reject(new Error(msg.message));
              this.pendingSearch = null;
            }
            break;
          case 'results':
            if (this.pendingSearch) {
              this.pendingSearch.resolve({
                results: msg.results,
                total: msg.results.length,
              });
              this.pendingSearch = null;
            }
            break;
        }
      };

      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', (err) => {
        if (this.status === 'initializing') {
          this.status = 'error';
          // The "Ideas Search unavailable" overlay is driven purely by this
          // callback, and a wasm compile failure arrives as an 'error' event
          // rather than a posted message — so without this the user saw
          // nothing at all, just console noise.
          this.onProgress?.({ stage: 'error', detail: err.message || 'Search worker failed to start' });
          // Clear the memoized promise so a later search can retry instead of
          // re-awaiting this same rejection until the page is reloaded.
          this.initPromise = null;
          reject(new Error(err.message));
        }
      });

      // Send init message
      this.worker.postMessage({
        type: 'init',
        embeddingsUrl: this.embeddingsUrl,
        metadataUrl: this.metadataUrl,
        modelHost: this.modelHost,
        ortWasmPath: this.ortWasmPath,
      });
    });

    return this.initPromise;
  }

  async semanticSearch(query: string, options?: SearchOptions): Promise<SearchResultSet> {
    await this.ensureInitialized();

    if (!this.worker) {
      throw new Error('Worker not available');
    }

    return new Promise<SearchResultSet>((resolve, reject) => {
      this.pendingSearch = { resolve, reject };
      this.worker!.postMessage({
        type: 'search',
        query,
        maxResults: options?.pageSize ?? 20,
        levels: ['verse', 'paragraph'],
        minScore: 0.0,
      });
    });
  }

  dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.status = 'idle';
    this.initPromise = null;
    this.pendingSearch = null;
  }
}
