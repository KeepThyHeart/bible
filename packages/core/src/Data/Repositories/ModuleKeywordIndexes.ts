/**
 * Build whatever sidecar keyword indexes a set of module files is missing.
 *
 * The desktop builds a module's index after installing it
 * (`KeywordIndexService`); everything else - the web server, `init:modules`,
 * the tests that search real modules - has module files on disk and needs
 * their indexes to exist before a search can find anything in a v0.2 module.
 * This is that one step, shared: open each file read-only, work out its type,
 * and build through the configured {@link SidecarFts5Provider} when its index
 * is unbuilt, stale or failed. An index that is already current costs one
 * small read and is left alone, so calling this on every start is cheap.
 */

import { ISql } from '../Core/ISql';
import { ModuleType, normalizeModuleType } from '../Core/Types';
import { IIndexSource, IndexTarget } from '../Access/KeywordTypes';
import type { SidecarFts5Provider } from '../Access/Fts5/SidecarFts5Provider';
import { hasModuleTable } from '../Access/Fts5/ModuleKeywordIndex';
import { BibleRepository } from './BibleRepository';
import { BookRepository } from './BookRepository';
import { CommentaryRepository } from './CommentaryRepository';
import { DictionaryRepository } from './DictionaryRepository';
import { TopicalIndexRepository } from './TopicalIndexRepository';

/**
 * The module types with indexable prose, the repository that reads it, and
 * the FTS5 table a v0.1 module of that type shipped instead of a sidecar.
 * Other types (`cross_reference`, `tag_graph`, ...) have nothing to index.
 */
const INDEXABLE: Partial<Record<ModuleType, { legacyTable: string; source: (sql: ISql) => IIndexSource }>> = {
  bible: { legacyTable: 'bible_verse_fts', source: (sql) => new BibleRepository(sql).getIndexSource() },
  commentary: { legacyTable: 'commentary_entry_fts', source: (sql) => new CommentaryRepository(sql).getIndexSource() },
  dictionary: { legacyTable: 'dictionary_entry_fts', source: (sql) => new DictionaryRepository(sql).getIndexSource() },
  lexicon: { legacyTable: 'dictionary_entry_fts', source: (sql) => new DictionaryRepository(sql).getIndexSource() },
  book: { legacyTable: 'book_section_fts', source: (sql) => new BookRepository(sql).getIndexSource() },
  topical_index: { legacyTable: 'topic_fts', source: (sql) => new TopicalIndexRepository(sql).getIndexSource() },
};

export interface EnsureModuleKeywordIndexesOptions {
  provider: SidecarFts5Provider;
  /** Module database files to cover. */
  modulePaths: readonly string[];
  /** Open one module file read-only. The helper closes it. */
  openModule: (path: string) => ISql;
  /** Progress lines, e.g. `console.log`. Silent when omitted. */
  log?: (message: string) => void;
  /**
   * Delete every `.kwi` in the index directory that belongs to none of
   * `modulePaths` - superseded revisions and uninstalled modules. Only pass
   * this when `modulePaths` is the complete set the directory serves.
   */
  pruneOthers?: boolean;
  signal?: AbortSignal;
}

export interface EnsureModuleKeywordIndexesResult {
  /** Indexes built (or rebuilt) by this call. */
  built: string[];
  /** Already current; left alone. */
  current: string[];
  /** Nothing to do: no indexable content, or the module ships its own v0.1 table. */
  notApplicable: string[];
  /** Could not be built - the reason is also recorded by the provider as `failed`. */
  failed: Array<{ path: string; reason: string }>;
}

export async function ensureModuleKeywordIndexes(
  options: EnsureModuleKeywordIndexesOptions
): Promise<EnsureModuleKeywordIndexesResult> {
  const { provider, modulePaths, openModule, log } = options;
  const result: EnsureModuleKeywordIndexesResult = { built: [], current: [], notApplicable: [], failed: [] };
  const keep: IndexTarget[] = [];

  for (const modulePath of modulePaths) {
    if (options.signal?.aborted) break;

    let sql: ISql | null = null;
    try {
      sql = openModule(modulePath);
      const row = sql.queryOne<{ module_type: string | null }>('SELECT module_type FROM module_info LIMIT 1');
      const moduleType = row?.module_type ? (normalizeModuleType(row.module_type) as ModuleType) : null;
      const entry = moduleType ? INDEXABLE[moduleType] : undefined;
      if (!entry || hasModuleTable(sql, entry.legacyTable)) {
        result.notApplicable.push(modulePath);
        continue;
      }

      const source = entry.source(sql);
      keep.push(source.target);
      const status = await provider.status(source.target);
      if (status.state === 'ready') {
        result.current.push(modulePath);
        continue;
      }
      if (status.state === 'unavailable') {
        // No usable uuid/digest - the provider cannot address this module.
        result.failed.push({ path: modulePath, reason: `cannot be indexed: ${status.reason}` });
        continue;
      }

      const started = Date.now();
      log?.(`Building keyword index for ${modulePath} ...`);
      await provider.build(source, undefined, options.signal);
      log?.(`  done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      result.built.push(modulePath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log?.(`  keyword index for ${modulePath} failed: ${reason}`);
      result.failed.push({ path: modulePath, reason });
    } finally {
      try {
        sql?.close();
      } catch {
        // Nothing useful to do; the work above already succeeded or failed.
      }
    }
  }

  if (options.pruneOthers && !options.signal?.aborted) {
    await provider.pruneExcept(keep);
  }
  return result;
}
