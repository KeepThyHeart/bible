/**
 * Composition-root configuration for the swappable data access layer
 * (task 0026, revision 2, subtask M1).
 */

import { CompressionCodec } from '../Format/ModuleFormat';
import type { SearchPipelineConfig } from '../../Services/Search/SearchPipelineConfig';

export type KeywordIndexConfig =
  | { provider: 'in-module-fts5' }
  | { provider: 'sidecar-fts5'; indexDir: string }
  | { provider: 'shared-fts5'; indexDbPath: string }
  | { provider: 'none' };

export interface DataAccessConfig {
  // moduleStore is added in M11 - leave it out of this interface for now (M1 has no
  // store/factory types yet).
  /**
   * Ordered: first provider whose supports() accepts wins (same user-override
   * → extension → built-in order as SingleActiveProviderRegistry).
   */
  keywordIndex: KeywordIndexConfig[];
  codecs: CompressionCodec[];
  /**
   * Semantic pipeline config. Already exists as `SearchPipelineConfig`
   * (`Services/Search/SearchPipelineConfig.ts`) - referenced here by import,
   * not redefined.
   */
  search: SearchPipelineConfig;
}
