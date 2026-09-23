/**
 * The one `IModuleRepositoryFactory` implemented anywhere in this codebase
 * today - constructs the existing SQLite-backed repositories over an
 * {@link IModuleConnection} opened by {@link SqliteModuleStore} (task 0026,
 * revision 2, subtask M11).
 *
 * This is a construction seam, not a new implementation: every repository it
 * builds is the exact same class every caller already constructed by hand
 * (`new BibleRepository(db)`, etc.) - see `ModuleRepositoryFactory.ts`'s doc
 * comment for why those classes and their public interfaces are unchanged.
 *
 * ### `codecs` is honored where a repository's constructor accepts it
 *
 * `create()`'s `codecs: ICodecRegistry` parameter is part of the
 * `IModuleRepositoryFactory` contract, but today only `CommentaryRepository`
 * actually threads a caller-supplied registry through its constructor; every
 * other repository built here (`BibleRepository`, `DictionaryRepository`,
 * `BookRepository`, `TopicalIndexRepository`, `CrossReferenceRepository`)
 * takes only `(sql: ISql)` and falls back to `BaseModuleRepository`'s own
 * default (`nodeCodecRegistry()`) internally. Widening those constructors to
 * accept a codec registry is out of scope for M11 - it would touch repository
 * files this subtask does not have permission to edit, and would be exactly
 * the kind of repository-interface change the design doc forbids. So
 * `codecs` is a documented no-op for six of the seven module types today;
 * `capabilities()` below uses it (or the factory's own default) directly
 * since it does not go through a repository constructor at all.
 */

import type { ISql } from '../Core/ISql';
import type { ICodecRegistry } from './Codec';
import { nodeCodecRegistry, resolveModuleCodec } from './Codec';
import type { ModuleCapabilities } from './Capabilities';
import type { RuntimeEnvironment } from './IKeywordIndexProvider';
import type { IModuleConnection } from './ModuleStore';
import type { IModuleRepositoryFactory, ModuleRepositoryByType } from './ModuleRepositoryFactory';
import { BibleRepository } from '../Repositories/BibleRepository';
import { CommentaryRepository } from '../Repositories/CommentaryRepository';
import { DictionaryRepository } from '../Repositories/DictionaryRepository';
import { BookRepository } from '../Repositories/BookRepository';
import { TopicalIndexRepository } from '../Repositories/TopicalIndexRepository';
import { CrossReferenceRepository } from '../Repositories/CrossReferenceRepository';
import { TagGraphRepository } from '../Repositories/TagGraphRepository';

type RepoBuilder<K extends keyof ModuleRepositoryByType> = (
  sql: ISql,
  codecs: ICodecRegistry
) => ModuleRepositoryByType[K];

const BUILDERS: { [K in keyof ModuleRepositoryByType]: RepoBuilder<K> } = {
  bible: (sql) => new BibleRepository(sql),
  commentary: (sql, codecs) => new CommentaryRepository(sql, codecs),
  dictionary: (sql) => new DictionaryRepository(sql),
  book: (sql) => new BookRepository(sql),
  topicalIndex: (sql) => new TopicalIndexRepository(sql),
  crossRef: (sql) => new CrossReferenceRepository(sql),
  tagGraph: (sql) => new TagGraphRepository(sql),
};

export class SqliteModuleRepositoryFactory implements IModuleRepositoryFactory {
  readonly id = 'sqlite';

  /**
   * @param defaultCodecs Used only by `capabilities()`, which - unlike
   *   `create()` - has no `codecs` parameter of its own (see
   *   `ModuleRepositoryFactory.ts`'s interface). Defaults to the
   *   Node/Electron composition root, matching `BaseModuleRepository`'s own
   *   default.
   */
  constructor(private readonly defaultCodecs: ICodecRegistry = nodeCodecRegistry()) {}

  supports<K extends keyof ModuleRepositoryByType>(conn: IModuleConnection, type: K): boolean {
    return conn.sql !== undefined && Object.prototype.hasOwnProperty.call(BUILDERS, type);
  }

  create<K extends keyof ModuleRepositoryByType>(
    conn: IModuleConnection,
    type: K,
    codecs: ICodecRegistry
  ): ModuleRepositoryByType[K] | null {
    if (!conn.sql) return null;
    const build = BUILDERS[type] as RepoBuilder<K> | undefined;
    if (!build) return null;
    return build(conn.sql, codecs);
  }

  /**
   * A minimal, honest capability answer - NOT the full M7/F8/M9 capability
   * surface (`BaseModuleRepository.getCompressionCapability()`'s doc comment
   * explains why nothing populates `ModuleCapabilities` for real yet). This
   * reads `module_info.compression` once via the same `resolveModuleCodec()`
   * every repository's own compression accessor uses, and reports the
   * keyword state as `'unavailable'` unconditionally: wiring a real
   * `IKeywordIndexProvider` answer through here is that later subtask's job,
   * not M11's.
   */
  capabilities(conn: IModuleConnection, env: RuntimeEnvironment): ModuleCapabilities {
    if (!conn.sql) {
      return {
        readContent: false,
        unavailableReason: 'open-failed',
        compression: { codec: 'none', supported: false },
        keyword: { state: 'unavailable', reason: 'no-fts-engine' },
        features: [],
      };
    }

    const resolved = resolveModuleCodec(conn.sql, this.defaultCodecs);
    return {
      readContent: resolved.supported,
      unavailableReason: resolved.supported ? undefined : 'missing-codec',
      compression: { codec: resolved.compression, supported: resolved.supported },
      keyword: env.sqlite.fts5
        ? { state: 'unavailable', reason: 'no-provider' }
        : { state: 'unavailable', reason: 'no-fts-engine' },
      features: [],
    };
  }
}
