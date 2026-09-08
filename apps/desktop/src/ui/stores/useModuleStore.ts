// Re-export shim - the useModuleStore implementation has been sliced into
// `./module/`. This shim preserves the original import path so consumers
// don't need to be updated.
//
// See: docs/old/cleanup/07-store-slice-refactor.md
export { useModuleStore } from './module/useModuleStore';
export type {
  ModuleState,
  ModuleType,
  ModuleMetadata,
  CatalogModule,
  DownloadProgress,
  ModuleCatalog,
  ModuleFilter,
  ModuleViewMode,
} from './module/types';
