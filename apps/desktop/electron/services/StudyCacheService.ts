import { join, dirname } from 'path';
import { closeSync, existsSync, mkdirSync, openSync, readSync, rmSync, statSync } from 'fs';
import log from 'electron-log';
import {
  CommentaryRepository,
  CrossReferenceRepository,
  TopicalIndexRepository,
  TagGraphRepository,
  CommentaryAggregationService,
  CrossRefAggregationService,
  TopicAggregationService,
  EntityAggregationService,
} from '@bible/core';
import type {
  AggregationModule,
  ChapterCommentaryOverview,
  TopicsByVerse,
  CrossRefsByVerse,
  EntitiesByVerse,
  ICommentaryRepository,
  ICrossReferenceRepository,
  ITagGraphRepository,
  ITopicAggregationService,
} from '@bible/core';
import { SqliteProvider } from '../providers/SqliteProvider';
import { getDataPath, getUserDataPath, resolveModulePath } from '../utils/appPaths';
import { getSharedModuleMetadataRepo } from './sharedMainDb';

/**
 * Where a chapter's overview came from. Diagnostics, and what the tests assert
 * write-through with.
 */
export type StudyOverviewSource = 'cache' | 'computed' | 'unavailable';

/** Every section a chapter overview can carry. */
export const STUDY_OVERVIEW_SECTIONS = ['commentary', 'topics', 'crossrefs', 'entities'] as const;
export type StudyOverviewSection = (typeof STUDY_OVERVIEW_SECTIONS)[number];

/**
 * **The** switch: which sections are computed and stored.
 *
 * Desktop reads `crossrefs` and nothing else. Computing the other three cost
 * about 33 MB of a ~60 MB full-canon cache for data no consumer reads -
 * commentary overviews and topic indexes are large, and the tag graph is empty
 * on every shipped install.
 *
 * **Re-enabling a section is an edit to this line and nothing else.** Rows are
 * stamped with the sections they actually contain (`study_cache.sections`), and
 * a read is a hit only when the row contains everything the caller asked for -
 * so widening this constant makes existing rows fail that check and refill on
 * demand. No migration, no manual cache wipe, and no possibility of a narrow
 * row being mistaken for a complete one.
 *
 * If you widen it, widen the renderer too: `studyOverviewProvider` deliberately
 * exposes a getter only for the sections that are actually cached, so that a
 * getter can never answer "this chapter has no topics" when the truth is "topics
 * were never computed".
 */
export const CACHED_SECTIONS: readonly StudyOverviewSection[] = ['crossrefs'];

/**
 * Pre-computed per-chapter study overview, as served to the renderer.
 *
 * `available: false` means the main process could not produce this chapter at
 * all - no modules installed, or the aggregation threw. The renderer then falls
 * back to its own live `xref:*` queries. It does NOT mean "not cached": a cache
 * miss is computed on the spot and returned as `available: true`.
 */
export interface StudyOverviewPayload {
  available: boolean;
  /**
   * The sections this payload actually carries. A section that is absent from
   * this list is **not computed**, which is a different fact from "computed and
   * empty" - consumers must not read the corresponding field.
   */
  sections: StudyOverviewSection[];
  commentary: ChapterCommentaryOverview;
  topics: TopicsByVerse;
  crossrefs: CrossRefsByVerse;
  entities: EntitiesByVerse;
  source: StudyOverviewSource;
}

/** Module types the cache aggregates, and therefore the ones the fingerprint covers. */
const FINGERPRINTED_MODULE_TYPES = ['commentary', 'cross_reference', 'topical_index'] as const;

const UNAVAILABLE: StudyOverviewPayload = {
  available: false,
  sections: [],
  commentary: [],
  topics: {},
  crossrefs: {},
  entities: {},
  source: 'unavailable',
};

interface CacheRow {
  commentary_overview: string;
  topics: string;
  crossrefs: string;
  entities: string;
  sections: string;
}

/** Canonical on-disk form of a section set: sorted, comma-joined. */
function serializeSections(sections: readonly StudyOverviewSection[]): string {
  return [...new Set(sections)].sort().join(',');
}

/** Parse a stored marker back, dropping anything this build does not know. */
function parseSections(stored: string): StudyOverviewSection[] {
  const known = new Set<string>(STUDY_OVERVIEW_SECTIONS);
  return stored
    .split(',')
    .filter((name): name is StudyOverviewSection => known.has(name));
}

/** Every section in `wanted` is present in `have`. */
function containsAll(
  have: readonly StudyOverviewSection[],
  wanted: readonly StudyOverviewSection[]
): boolean {
  const present = new Set<StudyOverviewSection>(have);
  return wanted.every(section => present.has(section));
}

/**
 * The repositories and pre-computation one aggregation pass needs, built once
 * per process and reused for every chapter.
 *
 * `TopicAggregationService.from` is the expensive part: it bulk-reads every
 * topic and topic-verse link of every installed topical module. Paying that
 * once and keeping it is the whole reason this is a context rather than a
 * per-call construction.
 */
export interface AggregationContext {
  fingerprint: string;
  commentaryModules: AggregationModule<ICommentaryRepository>[];
  crossRefModules: AggregationModule<ICrossReferenceRepository>[];
  topicService: ITopicAggregationService;
  tagGraph: ITagGraphRepository | null;
}

export interface StudyCacheOptions {
  /** Absolute path to the cache file. Defaults to `<userData>/data/cache/study-cache.db`. */
  cachePath?: string;
  /** Builds the aggregation context. Injectable so tests need no real modules. */
  contextFactory?: () => AggregationContext;
}

/**
 * The per-chapter study overview: a user-local, runtime-built accelerator.
 *
 * ## What this is, and what it is emphatically not
 *
 * It is **a cache and nothing else**. Every chapter it serves can be computed
 * from the installed modules on demand, and is, whenever the cache does not
 * have it. Nothing about the app requires the file to exist: not startup, not
 * correctness, not the first visit to a chapter. Delete it mid-session and the
 * app keeps working and rebuilds it.
 *
 * That model is deliberate. Shipping a pre-generated `study-cache.db` inside
 * the installer instead would be wrong twice over: such an artifact can only be
 * generated against whatever module set the build machine had, so it is stale
 * on the first launch of every real install, and a cache that ships read-only
 * in `resources/` can never grow to cover what a user actually reads.
 *
 * ## How it fills
 *
 * - **Write-through.** A miss computes the chapter live, returns it
 *   immediately, and persists it. The first visit to a chapter is therefore
 *   never slower than having no cache at all, and it warms exactly what the
 *   reader reads.
 * - **Background sweep.** `StudyCacheSweeper` fills the rest of the canon a
 *   chapter at a time, well after startup, yielding between chapters.
 *
 * ## Staleness
 *
 * Every row carries the `fingerprint` of the module set it was computed from,
 * and a read requires an exact match. A newly installed or removed module
 * therefore cannot produce a stale answer: rows computed under the old
 * fingerprint stop matching and are recomputed as they are visited. Opening the
 * DB also runs one `DELETE` of the non-matching rows to reclaim the space.
 *
 * This replaces the old "disable the whole cache on mismatch" rule, which was
 * right for a shipped artifact and wrong for a local one: a user who installs
 * one commentary should not lose the other 1,188 chapters, and - more to the
 * point - should not lose the *acceleration* merely because the data changed.
 */
export class StudyCacheService {
  private db: SqliteProvider | null = null;
  /** Set once open has been attempted; a null `db` afterwards means "compute only". */
  private opened = false;
  private context: AggregationContext | null = null;
  private contextFailed = false;
  private purged = false;

  private readonly commentaryService = new CommentaryAggregationService();
  private readonly crossRefService = new CrossRefAggregationService();
  private readonly entityService = new EntityAggregationService();

  constructor(private readonly options: StudyCacheOptions = {}) {}

  /**
   * The cache file's location: the **writable user data** directory, never
   * `resources/`.
   *
   * `getDataPath()` points at `resources/data` in a packaged app - read-mostly
   * state laid down by the installer, on Windows typically under Program Files,
   * where a background writer has no business. `getUserDataPath()` is the
   * per-user writable root that downloaded modules already use, and it survives
   * app updates. In development the two are the same directory, which is what
   * lets a developer's generated cache act as a seed (see `ensureSchema`).
   */
  cachePath(): string {
    return this.options.cachePath ?? join(getUserDataPath(), 'cache', 'study-cache.db');
  }

  /**
   * The fingerprint the live module registry would produce right now:
   * abbreviations of every commentary, cross-reference and topical-index module
   * whose database file actually resolves, sorted and comma-joined.
   *
   * Kept identical to the recipe a pre-generated cache is built with, so a
   * seeded cache is recognised rather than discarded on sight.
   */
  liveFingerprint(): string {
    const repo = getSharedModuleMetadataRepo();
    const abbreviations: string[] = [];

    for (const moduleType of FINGERPRINTED_MODULE_TYPES) {
      for (const mod of repo.getByType(moduleType)) {
        try {
          if (!existsSync(resolveModulePath(mod.databasePath))) continue;
        } catch {
          continue;
        }
        abbreviations.push(mod.abbreviation ?? '');
      }
    }

    return abbreviations.sort().join(',');
  }

  // ------------------------------------------------------------------------
  // Cache file
  // ------------------------------------------------------------------------

  /**
   * Open (creating if absent) the cache file. Returns null when the file cannot
   * be used at all, in which case every read is computed live.
   *
   * A corrupt file is deleted and recreated once. A cache problem must never
   * reach the user as an error - the worst it may cost is speed.
   */
  private ensureDb(): SqliteProvider | null {
    if (this.opened) return this.db;
    this.opened = true;

    const path = this.cachePath();
    try {
      this.db = this.openAt(path);
    } catch (firstError) {
      log.warn(`[StudyCache] Could not open ${path}, recreating:`, firstError);
      try {
        // A half-written or corrupt file is worth exactly nothing - it is a
        // cache. Remove it and its WAL sidecars, and try once more.
        for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
        this.db = this.openAt(path);
      } catch (secondError) {
        log.error('[StudyCache] Cache unusable, running live-only:', secondError);
        this.db = null;
      }
    }
    return this.db;
  }

  private openAt(path: string): SqliteProvider {
    mkdirSync(dirname(path), { recursive: true });
    // Check the file BEFORE handing it to better-sqlite3.
    //
    // Its constructor runs `PRAGMA journal_mode = WAL`, which on a non-database
    // file throws from inside the constructor - so `SqliteProvider` never
    // assigns its handle, the underlying one is orphaned with no way to close
    // it, and on Windows the recovery `rmSync` then fails with EBUSY. The
    // damaged file would survive, and the cache would stay dead for the rest of
    // the session. Deleting it before we ever open it sidesteps the whole
    // problem for the case that actually happens: a truncated or partially
    // written file.
    if (existsSync(path) && !looksLikeSqlite(path)) {
      log.warn(`[StudyCache] ${path} is not a SQLite database; discarding it`);
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
    }
    const db = new SqliteProvider(path, { readonly: false });
    try {
      this.ensureSchema(db);
    } catch (error) {
      // Close before rethrowing. A corrupt file opens fine and only fails on
      // the first statement, leaving a live OS handle - and on Windows the
      // caller's `rmSync` then fails with EBUSY, so the recovery path could
      // not actually recover. Releasing the handle here is what makes
      // "delete it and start again" work.
      try {
        db.close();
      } catch {
        // Already unusable; nothing to salvage.
      }
      throw error;
    }
    return db;
  }

  /**
   * Create the schema if absent, and bring a pre-existing file up to it.
   *
   * The migration matters in development: a pre-generated cache has a
   * `study_cache` table with no `fingerprint` column and one
   * `cache_metadata.module_fingerprint` row for the whole file. Adding the
   * column and backfilling it from that row turns a generated cache into a
   * valid seed instead of throwing it away.
   */
  private ensureSchema(db: SqliteProvider): void {
    db.execute(
      `CREATE TABLE IF NOT EXISTS study_cache (
         book INTEGER NOT NULL,
         chapter INTEGER NOT NULL,
         commentary_overview TEXT NOT NULL DEFAULT '[]',
         topics TEXT NOT NULL DEFAULT '{}',
         crossrefs TEXT NOT NULL DEFAULT '{}',
         entities TEXT NOT NULL DEFAULT '{}',
         fingerprint TEXT NOT NULL DEFAULT '',
         sections TEXT NOT NULL DEFAULT '',
         PRIMARY KEY (book, chapter)
       )`
    );
    db.execute(
      `CREATE TABLE IF NOT EXISTS cache_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
    );

    const columns = db.queryAll<{ name: string }>('PRAGMA table_info(study_cache)');
    if (!columns.some(c => c.name === 'fingerprint')) {
      log.info('[StudyCache] Migrating a generated cache: adding per-row fingerprint');
      db.execute(`ALTER TABLE study_cache ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''`);
      const seeded = db.queryOne<{ value: string }>(
        'SELECT value FROM cache_metadata WHERE key = ?',
        ['module_fingerprint']
      );
      if (seeded?.value) {
        db.execute('UPDATE study_cache SET fingerprint = ?', [seeded.value]);
      }
    }
    if (!columns.some(c => c.name === 'sections')) {
      log.info('[StudyCache] Migrating a generated cache: adding per-row section marker');
      db.execute(`ALTER TABLE study_cache ADD COLUMN sections TEXT NOT NULL DEFAULT ''`);
      // A pre-generated cache computes all four sections for every row, so
      // a pre-existing row genuinely is complete. Marking it so keeps a
      // developer's generated cache usable as a seed for any section set.
      db.execute('UPDATE study_cache SET sections = ?', [serializeSections(STUDY_OVERVIEW_SECTIONS)]);
    }
  }

  /**
   * Drop every row computed under a different module set, once per process.
   *
   * One statement. The per-row fingerprint check is what actually guarantees
   * nothing stale is ever served; this only reclaims the space.
   */
  private purgeStale(db: SqliteProvider, fingerprint: string): void {
    if (this.purged) return;
    this.purged = true;
    try {
      const result = db.execute('DELETE FROM study_cache WHERE fingerprint <> ?', [fingerprint]);
      if (result.changes > 0) {
        log.info(`[StudyCache] Cleared ${result.changes} chapter(s) left by a previous module set`);
      }
      db.execute(
        'INSERT INTO cache_metadata (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['module_fingerprint', fingerprint]
      );
    } catch (error) {
      log.warn('[StudyCache] Could not purge stale rows:', error);
    }
  }

  // ------------------------------------------------------------------------
  // Aggregation context
  // ------------------------------------------------------------------------

  /**
   * Build (once) the repositories and pre-computation the aggregation needs.
   *
   * Returns null if it cannot be built, and remembers that, so a broken install
   * does not retry the expensive precompute on every chapter.
   */
  private ensureContext(): AggregationContext | null {
    if (this.context) return this.context;
    if (this.contextFailed) return null;

    const started = Date.now();
    try {
      this.context = (this.options.contextFactory ?? (() => this.buildContext()))();
      log.info(
        `[StudyCache] Aggregation context ready in ${Date.now() - started}ms ` +
          `(${this.context.commentaryModules.length} commentary, ` +
          `${this.context.crossRefModules.length} cross-reference)`
      );
      const db = this.ensureDb();
      if (db) this.purgeStale(db, this.context.fingerprint);
      return this.context;
    } catch (error) {
      log.error('[StudyCache] Could not build aggregation context:', error);
      this.contextFailed = true;
      return null;
    }
  }

  private buildContext(): AggregationContext {
    const metadata = getSharedModuleMetadataRepo();

    const open = <T>(
      moduleType: 'commentary' | 'cross_reference' | 'topical_index',
      make: (sql: SqliteProvider) => T
    ): AggregationModule<T>[] => {
      const out: AggregationModule<T>[] = [];
      for (const mod of metadata.getByType(moduleType)) {
        const path = resolveModulePath(mod.databasePath);
        if (!existsSync(path)) continue;
        try {
          // Opened directly rather than through ModuleDatabaseRegistry: the
          // background sweep holds these for minutes, and must neither keep the
          // shared handles the UI uses busy nor be evicted out from under itself.
          const sql = new SqliteProvider(path, { readonly: true });
          out.push({
            abbreviation: mod.abbreviation ?? '',
            moduleName: mod.moduleName,
            repository: make(sql),
          });
        } catch (error) {
          log.warn(`[StudyCache] Skipping ${mod.databasePath}:`, error);
        }
      }
      return out;
    };

    const commentaryModules = open('commentary', sql => new CommentaryRepository(sql));
    const crossRefModules = open('cross_reference', sql => new CrossReferenceRepository(sql));
    const topicalModules = open('topical_index', sql => new TopicalIndexRepository(sql));

    let tagGraph: ITagGraphRepository | null = null;
    const tagGraphPath = join(getDataPath(), 'tag_graph.db');
    if (existsSync(tagGraphPath)) {
      try {
        tagGraph = new TagGraphRepository(new SqliteProvider(tagGraphPath, { readonly: true }));
      } catch (error) {
        log.warn('[StudyCache] Tag graph unavailable:', error);
      }
    }

    return {
      fingerprint: this.liveFingerprint(),
      commentaryModules,
      crossRefModules,
      topicService: TopicAggregationService.from(topicalModules),
      tagGraph,
    };
  }

  // ------------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------------

  /**
   * The overview for one chapter: from the cache when it holds a row computed
   * under the current module set, otherwise computed now and written through.
   */
  getChapter(
    book: number,
    chapter: number,
    requested: readonly StudyOverviewSection[] = CACHED_SECTIONS
  ): StudyOverviewPayload {
    const context = this.ensureContext();
    if (!context) return UNAVAILABLE;

    const db = this.ensureDb();
    if (db) {
      const cached = this.readRow(db, book, chapter, context.fingerprint, requested);
      if (cached) return cached;
    }

    // Compute at least what will be stored, plus anything extra the caller
    // asked for. A caller wanting a section outside `CACHED_SECTIONS` gets real
    // data rather than an empty field, and that chapter's row is then stamped
    // with the wider set - so the answer is never narrower than the marker says.
    const toCompute = [...new Set([...requested, ...CACHED_SECTIONS])];
    const computed = this.computeChapter(book, chapter, context, toCompute);
    if (!computed) return UNAVAILABLE;
    if (db) this.writeRow(db, book, chapter, context.fingerprint, computed);
    return { ...computed, source: 'computed' };
  }

  private readRow(
    db: SqliteProvider,
    book: number,
    chapter: number,
    fingerprint: string,
    requested: readonly StudyOverviewSection[]
  ): StudyOverviewPayload | null {
    try {
      const row = db.queryOne<CacheRow>(
        `SELECT commentary_overview, topics, crossrefs, entities, sections
           FROM study_cache
          WHERE book = ? AND chapter = ? AND fingerprint = ?`,
        [book, chapter, fingerprint]
      );
      if (!row) return null;

      // A row is a hit only if it CONTAINS everything asked for. A row written
      // under a narrower `CACHED_SECTIONS` must read as a miss, not as a
      // chapter that happens to have no topics - which is the whole reason the
      // marker exists.
      const stored = parseSections(row.sections);
      if (!containsAll(stored, requested)) return null;

      return {
        available: true,
        source: 'cache',
        sections: stored,
        commentary: JSON.parse(row.commentary_overview) as ChapterCommentaryOverview,
        topics: JSON.parse(row.topics) as TopicsByVerse,
        crossrefs: JSON.parse(row.crossrefs) as CrossRefsByVerse,
        entities: JSON.parse(row.entities) as EntitiesByVerse,
      };
    } catch (error) {
      // A row that will not parse is one corrupt cache entry, not an outage.
      log.warn(`[StudyCache] Unreadable row for ${book}/${chapter}, recomputing:`, error);
      return null;
    }
  }

  /**
   * Compute one chapter from the installed modules. This is the correctness
   * path - the cache only ever remembers what this returns.
   */
  computeChapter(
    book: number,
    chapter: number,
    context: AggregationContext,
    sections: readonly StudyOverviewSection[] = CACHED_SECTIONS
  ): Omit<StudyOverviewPayload, 'source'> | null {
    const wanted = new Set<StudyOverviewSection>(sections);
    try {
      return {
        available: true,
        sections: [...wanted],
        commentary: wanted.has('commentary')
          ? this.commentaryService.getChapterOverview(book, chapter, context.commentaryModules)
          : [],
        topics: wanted.has('topics') ? context.topicService.getChapterTopics(book, chapter) : {},
        crossrefs: wanted.has('crossrefs')
          ? this.crossRefService.getChapterCrossRefs(book, chapter, context.crossRefModules)
          : {},
        entities: wanted.has('entities')
          ? this.entityService.getChapterEntities(book, chapter, context.tagGraph)
          : {},
      };
    } catch (error) {
      log.error(`[StudyCache] Aggregation failed for ${book}/${chapter}:`, error);
      return null;
    }
  }

  /** Compute and persist one chapter, skipping it if already cached. Sweeper entry point. */
  fillChapter(book: number, chapter: number, context: AggregationContext): boolean {
    const db = this.ensureDb();
    if (!db) return false;
    if (this.readRow(db, book, chapter, context.fingerprint, CACHED_SECTIONS)) return false;

    const computed = this.computeChapter(book, chapter, context, CACHED_SECTIONS);
    if (!computed) return false;
    this.writeRow(db, book, chapter, context.fingerprint, computed);
    return true;
  }

  private writeRow(
    db: SqliteProvider,
    book: number,
    chapter: number,
    fingerprint: string,
    payload: Omit<StudyOverviewPayload, 'source'>
  ): void {
    try {
      db.execute(
        `INSERT INTO study_cache (book, chapter, commentary_overview, topics, crossrefs, entities, fingerprint, sections)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(book, chapter) DO UPDATE SET
           commentary_overview = excluded.commentary_overview,
           topics = excluded.topics,
           crossrefs = excluded.crossrefs,
           entities = excluded.entities,
           fingerprint = excluded.fingerprint,
           sections = excluded.sections`,
        [
          book,
          chapter,
          JSON.stringify(payload.commentary),
          JSON.stringify(payload.topics),
          JSON.stringify(payload.crossrefs),
          JSON.stringify(payload.entities),
          fingerprint,
          serializeSections(payload.sections),
        ]
      );
    } catch (error) {
      // Read-only volume, disk full, file deleted under us - all survivable.
      log.warn(`[StudyCache] Could not persist ${book}/${chapter}:`, error);
    }
  }

  /** Current on-disk size in bytes, or 0 when there is no file. */
  sizeBytes(): number {
    try {
      return statSync(this.cachePath()).size;
    } catch {
      return 0;
    }
  }

  /** The aggregation context, building it on demand. Used by the sweeper. */
  contextOrNull(): AggregationContext | null {
    return this.ensureContext();
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch (error) {
        log.warn('[StudyCache] Error closing cache:', error);
      }
      this.db = null;
    }
    this.opened = false;
    this.purged = false;
    this.context = null;
    this.contextFailed = false;
  }
}

/**
 * Whether a file starts with SQLite's 16-byte magic header.
 *
 * Cheap and exact for the failure this guards against. Deeper corruption (a
 * valid header over damaged pages) still throws on open, and is handled by the
 * delete-and-retry in `ensureDb` - or, if even that cannot remove the file,
 * by running live-only until the next launch.
 */
const SQLITE_MAGIC = 'SQLite format 3' + '\u0000';

function looksLikeSqlite(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const header = Buffer.alloc(SQLITE_MAGIC.length);
    const read = readSync(fd, header, 0, header.length, 0);
    // A zero-length file is a legitimate "empty database" to SQLite.
    if (read === 0) return true;
    return read === header.length && header.toString('binary') === SQLITE_MAGIC;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Nothing useful to do; the open attempt below will report the truth.
      }
    }
  }
}

let instance: StudyCacheService | null = null;

/** Process-wide singleton - one cache file, one aggregation context. */
export function getStudyCacheService(): StudyCacheService {
  if (!instance) instance = new StudyCacheService();
  return instance;
}

/** Close the shared study cache (shutdown hook). */
export function closeStudyCache(): void {
  instance?.close();
  instance = null;
}
