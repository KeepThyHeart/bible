/**
 * Module installation tracking in main.db (installed_date, database_path,
 * size_bytes, is_indexed). Distinct from per-module *ModuleInfo classes
 * (BibleModuleInfo, CommentaryModuleInfo, etc.) which live inside each
 * module's own database and describe the content itself.
 */
import { ModuleType, Metadata } from '../../Core/Types';

/**
 * Features supported by a module (stored as JSON array in DB)
 */
export type ModuleFeature =
  | 'strongs_numbers'
  | 'morphology'
  | 'footnotes'
  | 'cross_references'
  | 'red_letter'
  | 'section_headings'
  | 'interlinear'
  | 'word_occurrences';

/**
 * Serialized form of ModuleMetadata with snake_case keys for frontend consumption.
 */
export interface ModuleMetadataJSON {
  module_id?: number;
  module_uuid?: string;
  module_type: ModuleType;
  name: string;
  abbreviation?: string;
  version?: string;
  language_code?: string;
  installed_date?: string;
  last_updated?: string;
  database_path: string;
  size_bytes?: number;
  is_indexed: boolean;
  last_indexed_date?: string;
  features: ModuleFeature[];
  sword_metadata?: Metadata;
  metadata?: Metadata;
  description?: string;
  repository_id?: string;
  update_available: boolean;
  last_used_date?: string;
  usage_count: number;
  user_hidden: boolean;
}

/**
 * Module metadata entity from the main database
 * Represents an installed module (Bible, commentary, dictionary, etc.)
 */
export class ModuleMetadata {
  moduleId?: number;
  /**
   * Stable cross-database identity, from the module file's
   * `module_info.module_uuid`. Required: every module conforms to the current
   * format, so a registered module always has one. Prefer it over
   * `abbreviation` for any cross-database reference - an abbreviation is a
   * display string that two publishers can collide on.
   */
  moduleUuid: string;
  moduleType: ModuleType;
  moduleName: string;
  abbreviation?: string;
  version?: string;
  languageCode?: string;
  installedDate?: string;
  lastUpdated?: string;
  databasePath: string;
  sizeBytes?: number;
  isIndexed: boolean;
  lastIndexedDate?: string;
  features: ModuleFeature[];
  swordMetadata?: Metadata;
  metadata?: Metadata;

  constructor(data: {
    moduleId?: number;
    moduleUuid: string;
    moduleType: ModuleType;
    moduleName: string;
    abbreviation?: string;
    version?: string;
    languageCode?: string;
    installedDate?: string;
    lastUpdated?: string;
    databasePath: string;
    sizeBytes?: number;
    isIndexed?: boolean;
    lastIndexedDate?: string;
    features?: ModuleFeature[];
    swordMetadata?: Metadata;
    metadata?: Metadata;
  }) {
    this.moduleId = data.moduleId;
    this.moduleUuid = data.moduleUuid;
    this.moduleType = data.moduleType;
    this.moduleName = data.moduleName;
    this.abbreviation = data.abbreviation;
    this.version = data.version;
    this.languageCode = data.languageCode;
    this.installedDate = data.installedDate;
    this.lastUpdated = data.lastUpdated;
    this.databasePath = data.databasePath;
    this.sizeBytes = data.sizeBytes;
    this.isIndexed = data.isIndexed ?? false;
    this.lastIndexedDate = data.lastIndexedDate;
    this.features = data.features ?? [];
    this.swordMetadata = data.swordMetadata;
    this.metadata = data.metadata;
  }

  /**
   * Get the full display name with version
   */
  getDisplayName(): string {
    if (this.version) {
      return `${this.moduleName} (${this.version})`;
    }
    return this.moduleName;
  }

  /**
   * Check if the module has a specific feature
   */
  hasFeature(feature: ModuleFeature): boolean {
    return this.features.includes(feature);
  }

  /**
   * Add a feature to the module
   */
  addFeature(feature: ModuleFeature): void {
    if (!this.hasFeature(feature)) {
      this.features.push(feature);
    }
  }

  /**
   * Remove a feature from the module
   */
  removeFeature(feature: ModuleFeature): void {
    const index = this.features.indexOf(feature);
    if (index !== -1) {
      this.features.splice(index, 1);
    }
  }

  /**
   * Check if the module needs indexing
   */
  needsIndexing(): boolean {
    return !this.isIndexed;
  }

  /**
   * Mark the module as indexed
   */
  markAsIndexed(): void {
    this.isIndexed = true;
    this.lastIndexedDate = new Date().toISOString();
  }

  /**
   * Get the abbreviation or default to first word of name
   */
  getAbbreviation(): string {
    return this.abbreviation ?? this.moduleName.split(' ')[0].toUpperCase();
  }

  /**
   * Get file size in MB
   */
  getSizeMB(): number {
    return this.sizeBytes ? this.sizeBytes / (1024 * 1024) : 0;
  }

  /**
   * Serialize to JSON with snake_case property names for frontend compatibility
   */
  toJSON(): ModuleMetadataJSON {
    return {
      module_id: this.moduleId,
      module_uuid: this.moduleUuid,
      module_type: this.moduleType,
      name: this.moduleName,
      abbreviation: this.abbreviation,
      version: this.version,
      language_code: this.languageCode,
      installed_date: this.installedDate,
      last_updated: this.lastUpdated,
      database_path: this.databasePath,
      size_bytes: this.sizeBytes,
      is_indexed: this.isIndexed,
      last_indexed_date: this.lastIndexedDate,
      features: this.features,
      sword_metadata: this.swordMetadata,
      metadata: this.metadata,
      description: (this.metadata?.description as string | undefined),
      repository_id: (this.metadata?.repository_id as string | undefined),
      update_available: false,
      last_used_date: (this.metadata?.last_used_date as string | undefined),
      usage_count: (this.metadata?.usage_count as number | undefined) ?? 0,
      user_hidden: (this.metadata?.user_hidden as boolean | undefined) ?? false
    };
  }
}
