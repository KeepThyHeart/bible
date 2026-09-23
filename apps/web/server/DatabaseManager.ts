import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { SqliteProvider } from './providers/SqliteProvider.js';
import {
  BibleBookRepository,
  ModuleMetadataRepository,
  DictionaryRepository,
  BibleSearchRepository,
  BibleSearchService,
  SearchController,
  SemanticSearchService,
  TagGraphRepository,
  WordFamilyService,
} from './core.js';
import type {
  BibleBookRepository as BibleBookRepositoryT,
  ModuleMetadataRepository as ModuleMetadataRepositoryT,
  BibleRepository as BibleRepositoryT,
  CommentaryRepository as CommentaryRepositoryT,
  DictionaryRepository as DictionaryRepositoryT,
  BibleSearchRepository as BibleSearchRepositoryT,
  BibleSearchService as BibleSearchServiceT,
  SearchController as SearchControllerT,
  SemanticSearchService as SemanticSearchServiceT,
  CrossReferenceRepository as CrossReferenceRepositoryT,
  TopicalIndexRepository as TopicalIndexRepositoryT,
  TagGraphRepository as TagGraphRepositoryT,
  WordFamilyService as WordFamilyServiceT,
  IBibleRepository,
  ICommentaryRepository,
  ICrossReferenceRepository,
  ITopicalIndexRepository,
  ModuleLoader as ModuleLoaderT,
  ModuleConnectionFactory,
  SqliteModuleStore as SqliteModuleStoreT,
  SqliteModuleRepositoryFactory as SqliteModuleRepositoryFactoryT,
  moduleRepositoryFactoryFor as moduleRepositoryFactoryForT,
  nodeCodecRegistry as nodeCodecRegistryT,
  wrapSqlConnection as wrapSqlConnectionT,
  SqlDriverFactory,
  IModuleStore,
  IModuleRepositoryFactory,
  ICodecRegistry,
} from '@bible/core';

/**
 * Module databases (Bibles, commentaries, dictionaries, topical indexes,
 * cross-references) are content the server only reads, so they're opened
 * read-only: nothing in the app can change them.
 */
const MODULE_DB_OPTIONS = { readonly: true, fileMustExist: true } as const;

/**
 * `@bible/core` is CJS; `core.ts` bridges it for every OTHER value this file
 * uses (see its own doc comment). `ModuleLoader`/`SqliteModuleStore`/
 * `SqliteModuleRepositoryFactory`/`moduleRepositoryFactoryFor`/
 * `nodeCodecRegistry` are pulled the same way, directly here, rather than by
 * editing `core.ts` - that file is not part of this subtask's (task 0026
 * revision 2, M11) scope, and this is the exact bridging pattern it already
 * uses for every other CJS value.
 */
const coreRequire = createRequire(import.meta.url);
const coreCjs = coreRequire('@bible/core');
const ModuleLoader: typeof ModuleLoaderT = coreCjs.ModuleLoader;
const SqliteModuleStore: typeof SqliteModuleStoreT = coreCjs.SqliteModuleStore;
const SqliteModuleRepositoryFactory: typeof SqliteModuleRepositoryFactoryT = coreCjs.SqliteModuleRepositoryFactory;
const moduleRepositoryFactoryFor: typeof moduleRepositoryFactoryForT = coreCjs.moduleRepositoryFactoryFor;
const nodeCodecRegistry: typeof nodeCodecRegistryT = coreCjs.nodeCodecRegistry;
/** Task 0034 (finishing M11): wraps an already-open `SqliteProvider` as an `IModuleConnection` for `repositoryFactory.create()`. */
const wrapSqlConnection: typeof wrapSqlConnectionT = coreCjs.wrapSqlConnection;

/**
 * `IModuleRepositoryFactory.create()` (and so `moduleRepositoryFactoryFor()`)
 * is typed to hand back the per-type INTERFACE (`IBibleRepository`, ...) -
 * deliberately, per M11's design doc, so a caller of the factory abstraction
 * never depends on a concrete repository's extra surface. This class's own
 * public methods, unchanged by this subtask, return the CONCRETE class
 * (`BibleRepositoryT = BibleRepository` from `@bible/core`, matching every
 * caller outside this file that was already written against it). This
 * narrows back to the concrete type the factory is KNOWN to build here
 * (`SqliteModuleRepositoryFactory`'s `create('bible', ...)` literally
 * `new BibleRepository(...)`s) - a truthful cast, not a widening one.
 */
function asConcreteFactory<TInterface, TConcrete extends TInterface>(
  factory: ModuleConnectionFactory<TInterface>
): ModuleConnectionFactory<TConcrete> {
  return factory as unknown as ModuleConnectionFactory<TConcrete>;
}

export class DatabaseManager {
  private abbreviationMap: Map<string, string> | null = null;
  private mainDb: SqliteProvider | null = null;
  private dictionaryRepos = new Map<string, DictionaryRepositoryT>();
  private dictionaryDbs = new Map<string, SqliteProvider>();
  private bookRepo: BibleBookRepositoryT | null = null;
  private moduleMetadataRepo: ModuleMetadataRepositoryT | null = null;
  private searchRepo: BibleSearchRepositoryT | null = null;
  private searchService: BibleSearchServiceT | null = null;
  private searchController: SearchControllerT | null = null;
  private semanticDb: SqliteProvider | null = null;
  private semanticService: SemanticSearchServiceT | null = null;
  private enrichmentsDb: SqliteProvider | null = null;
  private topicalDbs: Map<string, SqliteProvider> = new Map();
  private _tagGraphDb: SqliteProvider | null = null;
  private _tagGraphRepo: TagGraphRepositoryT | null = null;
  private wordFamilySvc: WordFamilyServiceT | null = null;
  private _studyCacheDb: SqliteProvider | null = null;

  /**
   * M11 (task 0026, revision 2): a `SqliteModuleStore` (driven by this app's
   * own `SqliteProvider`) and a `SqliteModuleRepositoryFactory`, shared by
   * the four `ModuleLoader`s below. Cheap to construct - neither touches disk
   * until a loader actually opens a module - so building them eagerly here
   * (rather than lazily like everything else in this class) costs nothing and
   * keeps the four loaders' own construction below uniform.
   */
  private readonly codecs: ICodecRegistry = nodeCodecRegistry();
  private readonly moduleStore: IModuleStore = new SqliteModuleStore({
    create: (path, opts) => new SqliteProvider(path, { readonly: opts.readonly, fileMustExist: true }),
  } satisfies SqlDriverFactory);
  private readonly repositoryFactory: IModuleRepositoryFactory = new SqliteModuleRepositoryFactory(this.codecs);

  /**
   * Five hand-rolled `Map<abbreviation, repo>` / `Map<abbreviation, db>`
   * pairs collapsed into one `ModuleLoader` each (M11) - Bible, commentary,
   * cross-reference and topical-index. Each is created lazily, on first use,
   * exactly like the single `bookRepo`/`moduleMetadataRepo` fields above
   * already were - constructing a `ModuleLoader` needs `getModuleMetadataRepo()`,
   * which opens `main.db`, and this class's whole contract is that nothing
   * touches disk before the first real request.
   *
   * Dictionary is NOT part of this consolidation. `getDictionaryRepo()` below
   * does not look `module_metadata` up at all - it resolves a path directly
   * from a filename convention with a case-folding fallback
   * (`dictionary_<name>.db` / `dictionary_<name.toLowerCase()>.db`), which
   * `ModuleLoader.get()` cannot reproduce: it unconditionally starts from
   * `metadataRepo.getByAbbreviation()`. Routing dictionary through
   * `ModuleLoader` would mean registering every dictionary in
   * `module_metadata` first, which is a real, observable change to how
   * dictionaries are resolved - out of scope for a pure construction refactor.
   * See this subtask's final report for the full reasoning.
   */
  private bibleLoader: ModuleLoaderT<BibleRepositoryT> | null = null;
  private commentaryLoader: ModuleLoaderT<CommentaryRepositoryT> | null = null;
  private crossRefLoader: ModuleLoaderT<CrossReferenceRepositoryT> | null = null;
  private topicalIndexLoader: ModuleLoaderT<TopicalIndexRepositoryT> | null = null;

  /**
   * @param dataDir  Directory for app-level data (main.db, settings.json, semantic DBs, etc.)
   * @param modulesDir  Optional separate directory for module .db files. When set, module
   *                    database_path values (e.g. "modules/bible_kjv.db") resolve from here
   *                    instead of dataDir. Allows shared module storage across packages.
   */
  constructor(private dataDir: string, private modulesDir?: string) {}

  /**
   * `readonly: true` is passed explicitly on every one of the four loaders
   * below, rather than relied on as `ModuleLoader`'s own default -
   * `MODULE_DB_OPTIONS` above already states why every module database this
   * server opens is read-only, and a future reader should see that decision
   * at each call site, not have to go check what `ModuleLoader` defaults to.
   */
  private getBibleLoader(): ModuleLoaderT<BibleRepositoryT> {
    if (!this.bibleLoader) {
      this.bibleLoader = new ModuleLoader<BibleRepositoryT>({
        moduleType: 'bible',
        metadataRepo: this.getModuleMetadataRepo(),
        pathResolver: { resolveModulePath: (p: string) => this.resolveModulePath(p) },
        store: this.moduleStore,
        factory: asConcreteFactory<IBibleRepository, BibleRepositoryT>(
          moduleRepositoryFactoryFor(this.repositoryFactory, 'bible', this.codecs)
        ),
        readonly: MODULE_DB_OPTIONS.readonly,
        fileExists: existsSync,
      });
    }
    return this.bibleLoader;
  }

  private getCommentaryLoader(): ModuleLoaderT<CommentaryRepositoryT> {
    if (!this.commentaryLoader) {
      this.commentaryLoader = new ModuleLoader<CommentaryRepositoryT>({
        moduleType: 'commentary',
        metadataRepo: this.getModuleMetadataRepo(),
        pathResolver: { resolveModulePath: (p: string) => this.resolveModulePath(p) },
        store: this.moduleStore,
        factory: asConcreteFactory<ICommentaryRepository, CommentaryRepositoryT>(
          moduleRepositoryFactoryFor(this.repositoryFactory, 'commentary', this.codecs)
        ),
        readonly: MODULE_DB_OPTIONS.readonly,
        fileExists: existsSync,
      });
    }
    return this.commentaryLoader;
  }

  private getCrossRefLoader(): ModuleLoaderT<CrossReferenceRepositoryT> {
    if (!this.crossRefLoader) {
      this.crossRefLoader = new ModuleLoader<CrossReferenceRepositoryT>({
        moduleType: 'cross_reference',
        metadataRepo: this.getModuleMetadataRepo(),
        pathResolver: { resolveModulePath: (p: string) => this.resolveModulePath(p) },
        store: this.moduleStore,
        factory: asConcreteFactory<ICrossReferenceRepository, CrossReferenceRepositoryT>(
          moduleRepositoryFactoryFor(this.repositoryFactory, 'crossRef', this.codecs)
        ),
        readonly: MODULE_DB_OPTIONS.readonly,
        fileExists: existsSync,
      });
    }
    return this.crossRefLoader;
  }

  private getTopicalIndexLoader(): ModuleLoaderT<TopicalIndexRepositoryT> {
    if (!this.topicalIndexLoader) {
      this.topicalIndexLoader = new ModuleLoader<TopicalIndexRepositoryT>({
        moduleType: 'topical_index',
        metadataRepo: this.getModuleMetadataRepo(),
        pathResolver: { resolveModulePath: (p: string) => this.resolveModulePath(p) },
        store: this.moduleStore,
        factory: asConcreteFactory<ITopicalIndexRepository, TopicalIndexRepositoryT>(
          moduleRepositoryFactoryFor(this.repositoryFactory, 'topicalIndex', this.codecs)
        ),
        readonly: MODULE_DB_OPTIONS.readonly,
        fileExists: existsSync,
      });
    }
    return this.topicalIndexLoader;
  }

  /** Resolve a module's database_path against the modules directory. */
  resolveModulePath(databasePath: string): string {
    return join(this.modulesDir ?? this.dataDir, databasePath);
  }

  /** Resolve abbreviation case-insensitively by building a lookup map */
  resolveAbbreviation(abbreviation: string): string {
    if (!this.abbreviationMap) {
      this.abbreviationMap = new Map();
      const all = this.getModuleMetadataRepo().getAll();
      for (const m of all) {
        const abbr = m.abbreviation || m.getAbbreviation();
        if (abbr) {
          this.abbreviationMap.set(abbr.toLowerCase(), abbr);
        }
      }
    }
    return this.abbreviationMap.get(abbreviation.toLowerCase()) ?? abbreviation;
  }

  getMainDb(): SqliteProvider {
    if (!this.mainDb) {
      const mainDbPath = join(this.dataDir, 'main.db');
      if (!existsSync(mainDbPath)) {
        throw new Error(`Main database not found: ${mainDbPath}`);
      }
      this.mainDb = new SqliteProvider(mainDbPath);
    }
    return this.mainDb;
  }

  /**
   * `BibleBookRepository` reads main.db, not a module file - it has no
   * `IModuleRepositoryFactory` entry by design; see `ModuleRepositoryFactory.ts`'s
   * doc comment (task 0034).
   */
  getBookRepo(): BibleBookRepositoryT {
    if (!this.bookRepo) {
      this.bookRepo = new BibleBookRepository(this.getMainDb());
    }
    return this.bookRepo;
  }

  getModuleMetadataRepo(): ModuleMetadataRepositoryT {
    if (!this.moduleMetadataRepo) {
      this.moduleMetadataRepo = new ModuleMetadataRepository(this.getMainDb());
    }
    return this.moduleMetadataRepo;
  }

  getBibleRepo(abbreviation: string): BibleRepositoryT | null {
    const resolved = this.resolveAbbreviation(abbreviation);
    return this.getBibleLoader().get(resolved);
  }

  /**
   * The Bible to answer in when a request names none.
   *
   * `preferred` when that Bible is installed, otherwise the first installed
   * Bible `isVisible` accepts, so a deployment without the configured
   * translation still answers rather than 404ing. Null only when no Bible is
   * installed at all. "Installed" is what `getBibleRepo` means by it: listed in
   * main.db *and* its .db file present.
   */
  getDefaultBibleAbbreviation(
    preferred?: string,
    isVisible: (abbreviation: string) => boolean = () => true,
  ): string | null {
    if (preferred && this.getBibleRepo(preferred)) return this.resolveAbbreviation(preferred);
    for (const module of this.getModuleMetadataRepo().getByType('bible')) {
      const abbreviation = module.abbreviation || module.getAbbreviation();
      if (abbreviation && isVisible(abbreviation) && this.getBibleRepo(abbreviation)) return abbreviation;
    }
    return null;
  }

  /**
   * The Bible to read Strong's-tagged (interlinear) words from when a request
   * names none.
   *
   * Like `getDefaultBibleAbbreviation`, but only a Bible that carries
   * interlinear data qualifies: counting or aligning in an untagged translation
   * answers nothing. `preferred` when it qualifies, otherwise the first
   * installed Bible that does, otherwise null -- so an install without KJV
   * still gets Strong's counts from whichever tagged Bible it has.
   */
  getDefaultInterlinearBibleAbbreviation(preferred?: string): string | null {
    if (preferred && this.getBibleRepo(preferred)?.hasInterlinearData()) {
      return this.resolveAbbreviation(preferred);
    }
    for (const module of this.getModuleMetadataRepo().getByType('bible')) {
      const abbreviation = module.abbreviation || module.getAbbreviation();
      if (abbreviation && this.getBibleRepo(abbreviation)?.hasInterlinearData()) return abbreviation;
    }
    return null;
  }

  getCommentaryRepo(abbreviation: string): CommentaryRepositoryT | null {
    const resolved = this.resolveAbbreviation(abbreviation);
    return this.getCommentaryLoader().get(resolved);
  }

  getDictionaryRepo(name: string): DictionaryRepositoryT | null {
    if (this.dictionaryRepos.has(name)) {
      return this.dictionaryRepos.get(name)!;
    }

    // The API advertises mixed-case abbreviations ("AmTract", "ISBE") but the
    // module files on disk are lowercase, so the obvious path only resolves on
    // a case-insensitive filesystem. On Linux every dictionary lookup silently
    // returned null and the routes answered with an empty list. Try the name as
    // given first (Strong's dictionaries are addressed directly), then folded.
    const candidates = [name];
    if (name.toLowerCase() !== name) candidates.push(name.toLowerCase());

    const dbPath = candidates
      .map(candidate => this.resolveModulePath(join('modules', `dictionary_${candidate}.db`)))
      .find(path => existsSync(path));
    if (!dbPath) {
      return null;
    }

    try {
      const db = new SqliteProvider(dbPath, MODULE_DB_OPTIONS);
      // Construction (not connection-opening) routed through the shared
      // factory (task 0034, finishing M11). Resolution here deliberately
      // stays a direct filename lookup, not `ModuleLoader` - see the
      // consolidation comment above this class's loader fields for why.
      // The factory is typed to hand back the per-type INTERFACE
      // (`IDictionaryRepository`); it is known to build the concrete
      // `DictionaryRepository` here - a truthful narrowing, matching this
      // file's own `asConcreteFactory` above.
      const repo = this.repositoryFactory.create(wrapSqlConnection(db), 'dictionary', this.codecs) as DictionaryRepositoryT | null;
      if (!repo) {
        db.close();
        return null;
      }
      this.dictionaryDbs.set(name, db);
      this.dictionaryRepos.set(name, repo);
      return repo;
    } catch (err) {
      console.debug(`Failed to open dictionary module ${name}:`, err);
      return null;
    }
  }

  /** Get raw SqliteProvider for a dictionary module (for direct queries) */
  getDictionaryDb(name: string): SqliteProvider | null {
    // Ensure the repo (and db) are loaded
    this.getDictionaryRepo(name);
    return this.dictionaryDbs.get(name) ?? null;
  }

  /** Get all dictionary repos (loads them lazily) */
  getAllDictionaryRepos(): Array<{ abbreviation: string; name: string; repo: DictionaryRepositoryT }> {
    const modules = this.getModuleMetadataRepo().getByType('dictionary');
    const result: Array<{ abbreviation: string; name: string; repo: DictionaryRepositoryT }> = [];
    for (const mod of modules) {
      const abbr = mod.abbreviation || mod.getAbbreviation();
      const repo = this.getDictionaryRepo(abbr);
      if (repo) {
        result.push({ abbreviation: abbr, name: mod.moduleName, repo });
      }
    }
    return result;
  }

  getSearchController(): SearchControllerT | null {
    if (this.searchController) return this.searchController;

    try {
      const mainDb = this.getMainDb();
      // `BibleSearchRepository` reads main.db, not a module file - it has no
      // `IModuleRepositoryFactory` entry by design; see
      // `ModuleRepositoryFactory.ts`'s doc comment (task 0034).
      this.searchRepo = new BibleSearchRepository(mainDb);
      const bookRepo = this.getBookRepo();
      const bibleModules = new Map<string, BibleRepositoryT>();

      // The Bible a search spans when the request names none. KJV when it is
      // installed, because Strong's searches read its tagged text; otherwise
      // any installed Bible, so a plain keyword search still has text to scan.
      const defaultAbbr = this.getDefaultBibleAbbreviation('KJV');
      const defaultRepo = defaultAbbr ? this.getBibleRepo(defaultAbbr) : null;
      if (defaultAbbr && defaultRepo) {
        bibleModules.set(defaultAbbr, defaultRepo);
      }

      this.searchService = new BibleSearchService(bibleModules, bookRepo);
      this.searchController = new SearchController(this.searchService, this.searchRepo);
      return this.searchController;
    } catch {
      return null;
    }
  }

  getSearchService(): BibleSearchServiceT | null {
    if (!this.searchService) {
      this.getSearchController();
    }
    return this.searchService;
  }

  /**
   * Get the WordFamilyService (lazily created from Greek + Hebrew Strong's dictionaries).
   * Also wires it into the BibleSearchService for Strong's word-root searches.
   */
  getWordFamilyService(): WordFamilyServiceT | null {
    if (this.wordFamilySvc) return this.wordFamilySvc;

    const greekDict = this.getDictionaryRepo('strongsgreek');
    const hebrewDict = this.getDictionaryRepo('strongshebrew');

    if (!greekDict && !hebrewDict) return null;

    this.wordFamilySvc = new WordFamilyService(greekDict, hebrewDict);

    // Wire into search service so Strong's searches can resolve word families
    const searchService = this.getSearchService();
    if (searchService) {
      searchService.setWordFamilyService(this.wordFamilySvc);
    }

    return this.wordFamilySvc;
  }

  getSemanticSearchService(): SemanticSearchServiceT | null {
    if (this.semanticService) return this.semanticService;

    // Use full 768-dim DB on server (plenty of memory), browser DB is for client-side only
    const fullDbPath = join(this.dataDir, 'semantic_nomic-v1.5.db');
    const fallbackPath = join(this.dataDir, 'semantic_index.db');
    const semanticDbPath = existsSync(fullDbPath) ? fullDbPath : fallbackPath;
    if (!existsSync(semanticDbPath)) return null;

    try {
      this.semanticDb = new SqliteProvider(semanticDbPath);
      this.semanticService = new SemanticSearchService(this.semanticDb);
      if (this.semanticService.isAvailable()) {
        this.semanticService.loadEmbeddings();
      }
      return this.semanticService;
    } catch {
      return null;
    }
  }

  getEnrichmentsDb(): SqliteProvider | null {
    if (this.enrichmentsDb) return this.enrichmentsDb;

    // Find enrichments DB (name includes model identifier)
    try {
      const files = readdirSync(this.dataDir);
      const enrichFile = files.find((f: string) => f.startsWith('enrichments_') && f.endsWith('.db'));
      if (!enrichFile) return null;
      const dbPath = join(this.dataDir, enrichFile);
      this.enrichmentsDb = new SqliteProvider(dbPath);
      return this.enrichmentsDb;
    } catch {
      return null;
    }
  }

  /**
   * Get a lightweight topical DB accessor for Nave's or Torrey's topic_verses lookups.
   * @param source - 'nave' or 'torrey'
   */
  getTopicalRepo(source: string): { getTopicVerses(topicId: number, limit: number): Array<{ startVerseId: number; endVerseId: number }> } | null {
    if (this.topicalDbs.has(source)) {
      const db = this.topicalDbs.get(source)!;
      return {
        getTopicVerses(topicId: number, limit: number) {
          return db.queryAll<{ start_verse_id: number; end_verse_id: number }>(
            'SELECT start_verse_id, end_verse_id FROM topic_verses WHERE topic_id = ? ORDER BY sort_order LIMIT ?',
            [topicId, limit]
          ).map(r => ({ startVerseId: r.start_verse_id, endVerseId: r.end_verse_id }));
        }
      };
    }

    const moduleName = source === 'nave' ? 'topical_nave' : 'topical_torrey';
    const dbPath = this.resolveModulePath(join('modules', `${moduleName}.db`));
    if (!existsSync(dbPath)) return null;

    try {
      const db = new SqliteProvider(dbPath, MODULE_DB_OPTIONS);
      this.topicalDbs.set(source, db);
      return this.getTopicalRepo(source);
    } catch {
      return null;
    }
  }

  getCrossRefRepo(abbreviation: string): CrossReferenceRepositoryT | null {
    const resolved = this.resolveAbbreviation(abbreviation);
    return this.getCrossRefLoader().get(resolved);
  }

  getTopicalIndexRepo(abbreviation: string): TopicalIndexRepositoryT | null {
    const resolved = this.resolveAbbreviation(abbreviation);
    return this.getTopicalIndexLoader().get(resolved);
  }

  /** Get all topical index repos (loads them lazily) */
  getAllTopicalIndexRepos(): Array<{ abbreviation: string; repo: TopicalIndexRepositoryT }> {
    const modules = this.getModuleMetadataRepo().getByType('topical_index');
    const result: Array<{ abbreviation: string; repo: TopicalIndexRepositoryT }> = [];
    for (const mod of modules) {
      const abbr = mod.abbreviation || mod.getAbbreviation();
      const repo = this.getTopicalIndexRepo(abbr);
      if (repo) {
        result.push({ abbreviation: abbr, repo });
      }
    }
    return result;
  }

  getTagGraphRepo(): TagGraphRepositoryT | null {
    if (this._tagGraphRepo) return this._tagGraphRepo;

    const dbPath = join(this.dataDir, 'tag_graph.db');
    if (!existsSync(dbPath)) {
      return null;
    }

    try {
      this._tagGraphDb = new SqliteProvider(dbPath);
      // Construction routed through the shared factory (task 0034, finishing
      // M11) - a truthful narrowing back to the concrete class, matching
      // this file's own `asConcreteFactory` above.
      this._tagGraphRepo = this.repositoryFactory.create(
        wrapSqlConnection(this._tagGraphDb), 'tagGraph', this.codecs
      ) as TagGraphRepositoryT | null;
      return this._tagGraphRepo;
    } catch {
      return null;
    }
  }

  /** Get raw tag_graph.db provider for direct queries (e.g. reverse verse lookup) */
  getTagGraphDb(): SqliteProvider | null {
    // Ensure the DB is loaded
    this.getTagGraphRepo();
    return this._tagGraphDb;
  }

  /** Get the pre-generated study cache database (study-cache.db). Returns null if not generated. */
  getStudyCacheDb(): SqliteProvider | null {
    if (this._studyCacheDb) return this._studyCacheDb;

    const dbPath = join(this.dataDir, 'cache', 'study-cache.db');
    if (!existsSync(dbPath)) {
      return null;
    }

    try {
      this._studyCacheDb = new SqliteProvider(dbPath, { readonly: true });
      return this._studyCacheDb;
    } catch {
      return null;
    }
  }

  closeAll(): void {
    // The four consolidated ModuleLoaders close (and forget) every connection
    // they opened - the same job the old per-type `for (const db of
    // xxxDbs.values())` loops did, minus a per-connection console.debug on a
    // close error (ModuleLoader.closeAll() swallows close errors the same
    // way, just without a log line - see this subtask's final report).
    this.bibleLoader?.closeAll();
    this.commentaryLoader?.closeAll();
    this.crossRefLoader?.closeAll();
    this.topicalIndexLoader?.closeAll();

    for (const db of this.dictionaryDbs.values()) {
      try { db.close(); } catch (err) { console.debug('Error closing dictionary DB:', err); }
    }
    if (this.enrichmentsDb) {
      try { this.enrichmentsDb.close(); } catch (err) { console.debug('Error closing enrichments DB:', err); }
    }
    for (const db of this.topicalDbs.values()) {
      try { db.close(); } catch (err) { console.debug('Error closing topical DB:', err); }
    }
    if (this._tagGraphDb) {
      try { this._tagGraphDb.close(); } catch (err) { console.debug('Error closing tag-graph DB:', err); }
    }
    if (this.semanticDb) {
      this.semanticService?.unloadEmbeddings();
      try { this.semanticDb.close(); } catch (err) { console.debug('Error closing semantic DB:', err); }
    }
    if (this._studyCacheDb) {
      try { this._studyCacheDb.close(); } catch (err) { console.debug('Error closing study-cache DB:', err); }
    }
    if (this.mainDb) {
      try { this.mainDb.close(); } catch (err) { console.debug('Error closing main DB:', err); }
    }

    this.bibleLoader = null;
    this.commentaryLoader = null;
    this.crossRefLoader = null;
    this.topicalIndexLoader = null;
    this.dictionaryRepos.clear();
    this.dictionaryDbs.clear();
    this._tagGraphDb = null;
    this._tagGraphRepo = null;
    this._studyCacheDb = null;
    this.mainDb = null;
    this.bookRepo = null;
    this.moduleMetadataRepo = null;
    this.searchRepo = null;
    this.searchService = null;
    this.searchController = null;
    this.semanticDb = null;
    this.semanticService = null;
    this.enrichmentsDb = null;
  }
}
