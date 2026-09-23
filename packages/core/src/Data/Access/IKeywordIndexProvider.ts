/**
 * The provider contract implemented by each keyword-index backend
 * (sidecar-fts5, shared-fts5, in-module-fts5, ...). See
 * `IKeywordIndexRegistry.ts` for the thing that selects among providers.
 */

import { CompressionCodec } from '../Format/ModuleFormat';
import { KeywordCapability } from './Capabilities';
import { IndexTarget, IIndexSource, IKeywordIndex } from './KeywordTypes';

export interface IKeywordIndexProvider {
  readonly id: string; // 'sidecar-fts5', 'shared-fts5', 'in-module-fts5', …
  supports(t: IndexTarget, env: RuntimeEnvironment): boolean;
  /** Cheap; never builds. */
  status(t: IndexTarget): Promise<KeywordCapability>;

  /** An array, not one target: a shared-index provider returns ONE index for all. */
  open(targets: IndexTarget[]): Promise<IKeywordIndex>;

  /** Interruptible, restartable. */
  build(
    src: IIndexSource,
    onProgress?: (d: number, t: number) => void,
    signal?: AbortSignal
  ): Promise<void>;
  prune(t: IndexTarget): Promise<void>;
  /** Uninstall / stale-revision GC. */
  pruneExcept(keep: IndexTarget[]): Promise<void>;
}

export interface RuntimeEnvironment {
  runtime: 'electron' | 'node-server' | 'browser-worker';
  sqlite: { fts5: boolean; writableModules: boolean };
  codecs: ReadonlySet<CompressionCodec>;
  /** null ⇒ no writable derived-data location. */
  indexDir: string | null;
}
