/**
 * Module- and library-scoped capability descriptors for the swappable data
 * access layer (task 0026, "Swappable Data Access", revision 2, subtask M1).
 *
 * Pure types here: no behaviour, no I/O. See {@link KeywordIndexRegistry}
 * (in `./KeywordIndexRegistry.ts`) for the first piece of this layer with
 * real logic.
 */

import { CompressionCodec } from '../Format/ModuleFormat';
import { ModuleFeature } from '../Models/Main/ModuleMetadata';

/**
 * What a single module can currently do. Computed per module - one call per
 * module, not once for the whole library (contrast {@link LibraryCapabilities}).
 */
export interface ModuleCapabilities {
  /** false ⇒ the library greys the module out. */
  readContent: boolean;
  unavailableReason?: 'missing-codec' | 'unsupported-format-version' | 'open-failed';
  compression: { codec: CompressionCodec; supported: boolean };
  keyword: KeywordCapability;
  /** module_feature rows - content features only. */
  features: ModuleFeature[];
  // NOTE: semantic availability is deliberately NOT here - see LibraryCapabilities.
}

/** Library-scoped, asked once, not once per module. */
export interface LibraryCapabilities {
  semantic: { available: boolean; packId?: string; versification: string };
}

export type KeywordCapability =
  | { state: 'unavailable'; reason: 'no-fts-engine' | 'no-provider' | 'nothing-to-index' }
  | { state: 'unbuilt'; providerId: string; estimate?: { bytes: number; approxMs: number } }
  | { state: 'building'; providerId: string; done: number; total: number }
  | { state: 'stale'; providerId: string; builtFor: string /* content_sha256 */ }
  | { state: 'ready'; providerId: string; supports: KeywordFeatures }
  // Added by task 0027 §4.5 review: without this, a build that failed (e.g. full disk)
  // is indistinguishable from 'unbuilt' and gets retried forever.
  | { state: 'failed'; providerId: string; reason: string };

export interface KeywordFeatures {
  phrase: boolean;
  prefix: boolean;
  near: boolean;
  booleanOps: boolean;
  rank: boolean;
  /** false for any contentless index - the app must highlight from its own text. */
  snippetFromIndex: boolean;
}
