/**
 * The repository-construction half of the M11 seam (task 0026, "Swappable
 * Data Access", revision 2). See `ModuleStore.ts` for the connection half.
 *
 * ## Why there is deliberately NO generic `IModuleRepository`
 *
 * It is tempting to read "swap the factory" as "collapse the repositories
 * into one interface and give it a back end." That would be the wrong move,
 * and this design explicitly rejects it. The per-type interfaces that exist
 * today - `IBibleRepository`, `IDictionaryRepository`, `ICommentaryRepository`,
 * `IBookRepository`, `ITopicalIndexRepository`, `ICrossReferenceRepository`,
 * `ITagGraphRepository` - stay, unmerged, and {@link IModuleRepositoryFactory}
 * hands back whichever one the caller asked for. The reason is that the
 * storage scheme is not guaranteed to be uniform across module types: a
 * dictionary could ship as a flat CSV, a Bible never could (it needs the
 * verse-id index SQLite gives for free). A single `IModuleRepository`
 * interface wide enough to cover both would either leak SQL-shaped concepts
 * into a CSV reader or squash Bible's needs down to the CSV reader's level.
 *
 * What *is* shared is implementation, not interface. Every SQLite-backed
 * repository shares the same paging, the same `module_info` read, the same
 * parameter binding and the same row-mapping ceremony - see
 * `Data/Repositories/BaseModuleRepository.ts`, which every content repository
 * already extends. A CSV or JSON factory simply would not extend it. That is
 * the correct line: shared base classes inside one storage family; separate
 * public interfaces across module types.
 *
 * `ModuleRepositoryByType` is the ONLY thing that ties the per-type
 * interfaces together, and it ties them by name, not by a shared supertype.
 */

import type { ICodecRegistry } from './Codec';
import type { ModuleCapabilities } from './Capabilities';
import type { RuntimeEnvironment } from './IKeywordIndexProvider';
import type { IModuleConnection } from './ModuleStore';
import type { IBibleRepository } from '../Repositories/IBibleRepository';
import type { ICommentaryRepository } from '../Repositories/ICommentaryRepository';
import type { IDictionaryRepository } from '../Repositories/IDictionaryRepository';
import type { IBookRepository } from '../Repositories/IBookRepository';
import type { ITopicalIndexRepository } from '../Repositories/ITopicalIndexRepository';
import type { ICrossReferenceRepository } from '../Repositories/ICrossReferenceRepository';
import type { ITagGraphRepository } from '../Repositories/ITagGraphRepository';

/**
 * Every module type that has both a real content repository AND a public
 * interface for it today. Checked against `Data/Repositories/` and
 * `ModuleType` (`Data/Core/Types.ts`) as of this subtask: `devotional` and
 * `lexicon` are real `ModuleType`s but have no dedicated repository class
 * (dictionaries cover `lexicon` at the `DictionaryRepository` level; nothing
 * implements `devotional` yet), so neither appears here - there is nothing
 * for a factory to construct. `tagGraph` is included because `TagGraphRepository`
 * / `ITagGraphRepository` are a real, implemented content repository, even
 * though `TagGraphRepository` does not extend `BaseModuleRepository` (it has
 * no `module_info`-shaped identity block the way the other six do).
 */
export interface ModuleRepositoryByType {
  bible: IBibleRepository;
  commentary: ICommentaryRepository;
  dictionary: IDictionaryRepository;
  book: IBookRepository;
  topicalIndex: ITopicalIndexRepository;
  crossRef: ICrossReferenceRepository;
  tagGraph: ITagGraphRepository;
}

/**
 * Constructs a `ModuleRepositoryByType[K]` over an already-open
 * {@link IModuleConnection}. A factory may support ONE module type, or
 * several - nothing requires a back end to cover the whole library.
 */
export interface IModuleRepositoryFactory {
  /** 'sqlite', 'csv-dictionary', 'json-bible', ... */
  readonly id: string;
  supports<K extends keyof ModuleRepositoryByType>(conn: IModuleConnection, type: K): boolean;
  create<K extends keyof ModuleRepositoryByType>(
    conn: IModuleConnection,
    type: K,
    codecs: ICodecRegistry
  ): ModuleRepositoryByType[K] | null;
  capabilities(conn: IModuleConnection, env: RuntimeEnvironment): ModuleCapabilities;
}
