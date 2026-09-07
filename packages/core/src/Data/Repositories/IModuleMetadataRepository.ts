import { ModuleMetadata, ModuleFeature } from '../Models/Main/ModuleMetadata';
import { ModuleType } from '../Core/Types';
import { RepositoryQueryOptions } from '../Core/IRepository';

/**
 * Interface for Module Metadata repository
 * Defines all operations for working with the module registry in the main database
 */
export interface IModuleMetadataRepository {
  getById(id: number): ModuleMetadata | undefined;
  /**
   * Look a module up by its stable `module_uuid`. Prefer this over
   * `getByAbbreviation` for identity: abbreviations collide across publishers
   * and change between editions. Returns `undefined` for pre-2.0 modules,
   * which carry no UUID.
   */
  getByUuid(moduleUuid: string): ModuleMetadata | undefined;
  getByAbbreviation(abbreviation: string): ModuleMetadata | undefined;
  getAll(options?: RepositoryQueryOptions): ModuleMetadata[];
  getByType(moduleType: ModuleType): ModuleMetadata[];
  getByLanguage(languageCode: string): ModuleMetadata[];
  getUnindexedModules(): ModuleMetadata[];

  create(entity: ModuleMetadata): ModuleMetadata;
  update(entity: ModuleMetadata): ModuleMetadata;
  delete(id: number): boolean;

  markAsIndexed(moduleId: number): void;
  search(query: string): ModuleMetadata[];
  getByFeature(feature: ModuleFeature): ModuleMetadata[];
}
