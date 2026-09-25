// Module types come from the canonical `MODULE_TYPES` in `@bible/core` rather
// than being re-declared here - a local copy drifted out of sync once
// (missing lexicon/topical_index/cross_reference/tag_graph), which mistyped
// modules of those types throughout the Module Manager UI.
import type { ModuleType } from '@bible/core';
export type { ModuleType };

export interface ModuleMetadata {
  module_id: number;
  module_type: ModuleType;
  abbreviation: string;
  name: string;
  language_code: string;
  version: string;
  description?: string;
  database_path: string;
  is_indexed: boolean;
  repository_id?: number;
  update_available: boolean;
  last_used_date?: string;
  usage_count: number;
  user_hidden: boolean;
}

export interface CatalogModule {
  module_id: string;
  module_type: ModuleType;
  name: string;
  abbreviation: string;
  language_code: string;
  version: string;
  description: string;
  author?: string;
  publisher?: string;
  year_published?: number;
  license: string;
  license_url?: string;
  download_url: string;
  download_size_bytes: number;
  installed_size_bytes: number;
  checksum: string;
  features: string[];
  tags: string[];
  recommended: boolean;
  requires_module?: string;
  created_date: string;
  updated_date: string;
}

export interface DownloadProgress {
  queueId: number;
  moduleId: string;
  moduleName: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  progressBytes: number;
  totalBytes?: number;
  progressPercentage: number;
  speedBps?: number;
  speedMBps?: number;
  estimatedTimeRemaining?: number;
  errorMessage?: string;
}

/**
 * A module catalog source - an online or local endpoint serving downloadable modules.
 * Named "ModuleCatalog" to distinguish from the data-access Repository pattern.
 */
export interface ModuleCatalog {
  catalogId: number;
  name: string;
  abbreviation?: string;
  url: string;
  type: 'official' | 'crosswire' | 'third_party' | 'local';
  isEnabled: boolean;
  priority: number;
  lastUpdated?: string;
  lastFetched?: string;
  /**
   * Result of verifying this catalog's detached signature on the last
   * successful fetch - `undefined` when it has never been fetched. Drives
   * `RepositorySettings`' signature badge; see
   * `packages/core`'s `CatalogSignatureStatus` for the full status meanings.
   */
  signatureStatus?: 'verified' | 'unsigned' | 'invalid' | 'untrusted_key' | 'error';
}

export interface ModuleFilter {
  moduleType?: ModuleType | ModuleType[];
  languageCode?: string | string[];
  license?: string | string[];
  features?: string | string[];
  tags?: string | string[];
  recommended?: boolean;
  searchQuery?: string;
  minSize?: number;
  maxSize?: number;
}

/**
 * Which tab of the Module Manager dialog is active: one tab per module type,
 * plus the `features` (feature packs) and `repositories` (sources) panels,
 * which render their own content instead of a module table.
 */
export type ModuleManagerTab = ModuleType | 'features' | 'repositories';

/** The All / Installed / Updates filter chip group shown inside each module-type tab. */
export type ModuleInstallFilter = 'all' | 'installed' | 'updates';

import type { LifecycleSlice } from './slices/lifecycleSlice';
import type { CatalogSlice } from './slices/catalogSlice';
import type { InstalledSlice } from './slices/installedSlice';
import type { DetailsSlice } from './slices/detailsSlice';
import type { DownloadSlice } from './slices/downloadSlice';
import type { RepositorySlice } from './slices/repositorySlice';

export type ModuleState =
  LifecycleSlice
  & CatalogSlice
  & InstalledSlice
  & DetailsSlice
  & DownloadSlice
  & RepositorySlice;
