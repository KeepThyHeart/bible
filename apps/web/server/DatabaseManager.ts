import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import { SqliteProvider } from './providers/SqliteProvider.js';
import {
  BibleBookRepository,
  ModuleMetadataRepository,
  BibleRepository,
  CommentaryRepository,
  DictionaryRepository,
  BibleSearchRepository,
  BibleSearchService,
  SearchController,
  SemanticSearchService,
  CrossReferenceRepository,
  TopicalIndexRepository,
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
} from '@bible/core';

export class DatabaseManager {
  private abbreviationMap: Map<string, string> | null = null;
  private mainDb: SqliteProvider | null = null;
  private bibleRepos = new Map<string, BibleRepositoryT>();
  private bibleDbs = new Map<string, SqliteProvider>();
  private commentaryRepos = new Map<string, CommentaryRepositoryT>();
  private commentaryDbs = new Map<string, SqliteProvider>();
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
  private crossRefRepos = new Map<string, CrossReferenceRepositoryT>();
  private crossRefDbs = new Map<string, SqliteProvider>();
  private topicalIndexRepos = new Map<string, TopicalIndexRepositoryT>();
  private topicalIndexDbs = new Map<string, SqliteProvider>();
  private _tagGraphDb: SqliteProvider | null = null;
  private _tagGraphRepo: TagGraphRepositoryT | null = null;
  private wordFamilySvc: WordFamilyServiceT | null = null;
  private _studyCacheDb: SqliteProvider | null = null;

  /**
   * @param dataDir  Directory for app-level data (main.db, settings.json, semantic DBs, etc.)
   * @param modulesDir  Optional separate directory for module .db files. When set, module
   *                    database_path values (e.g. "modules/bible_kjv.db") resolve from here
   *                    instead of dataDir. Allows shared module storage across packages.
   */
  constructor(private dataDir: string, private modulesDir?: string) {}

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
    if (this.bibleRepos.has(resolved)) {
      return this.bibleRepos.get(resolved)!;
    }

    const moduleMetadata = this.getModuleMetadataRepo().getByAbbreviation(resolved);
    if (!moduleMetadata || moduleMetadata.moduleType !== 'bible') {
      return null;
    }

    const dbPath = this.resolveModulePath(moduleMetadata.databasePath);
    if (!existsSync(dbPath)) {
      return null;
    }

    try {
      const db = new SqliteProvider(dbPath);
      const repo = new BibleRepository(db);
      this.bibleDbs.set(resolved, db);
      this.bibleRepos.set(resolved, repo);
      return repo;
    } catch (err) {
      console.debug(`Failed to open Bible module ${resolved}:`, err);
      return null;
    }
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

  getCommentaryRepo(abbreviation: string): CommentaryRepositoryT | null {
    const resolved = this.resolveAbbreviation(abbreviation);
    if (this.commentaryRepos.has(resolved)) {
      return this.commentaryRepos.get(resolved)!;
    }

    const moduleMetadata = this.getModuleMetadataRepo().getByAbbreviation(resolved);
    if (!moduleMetadata || moduleMetadata.moduleType !== 'commentary') {
      return null;
    }

    const dbPath = this.resolveModulePath(moduleMetadata.databasePath);
    if (!existsSync(dbPath)) {
      return null;
    }

    try {
      const db = new SqliteProvider(dbPath);
      const repo = new CommentaryRepository(db);
      this.commentaryDbs.set(resolved, db);
      this.commentaryRepos.set(resolved, repo);
      return repo;
    } catch (err) {
      console.debug(`Failed to open commentary module ${resolved}:`, err);
      return null;
    }
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
      const db = new SqliteProvider(dbPath);
      const repo = new DictionaryRepository(db);
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
      const db = new SqliteProvider(dbPath);
      this.topicalDbs.set(source, db);
      return this.getTopicalRepo(source);
    } catch {
      return null;
    }
  }

  getCrossRefRepo(abbreviation: string): CrossReferenceRepositoryT | null {
    const resolved = this.resolveAbbreviation(abbreviation);
    if (this.crossRefRepos.has(resolved)) {
      return this.crossRefRepos.get(resolved)!;
    }

    const moduleMetadata = this.getModuleMetadataRepo().getByAbbreviation(resolved);
    if (!moduleMetadata || moduleMetadata.moduleType !== 'cross_reference') {
      return null;
    }

    const dbPath = this.resolveModulePath(moduleMetadata.databasePath);
    if (!existsSync(dbPath)) {
      return null;
    }

    try {
      const db = new SqliteProvider(dbPath);
      const repo = new CrossReferenceRepository(db);
      this.crossRefDbs.set(resolved, db);
      this.crossRefRepos.set(resolved, repo);
      return repo;
    } catch {
      return null;
    }
  }

  getTopicalIndexRepo(abbreviation: string): TopicalIndexRepositoryT | null {
    const resolved = this.resolveAbbreviation(abbreviation);
    if (this.topicalIndexRepos.has(resolved)) {
      return this.topicalIndexRepos.get(resolved)!;
    }

    const moduleMetadata = this.getModuleMetadataRepo().getByAbbreviation(resolved);
    if (!moduleMetadata || moduleMetadata.moduleType !== 'topical_index') {
      return null;
    }

    const dbPath = this.resolveModulePath(moduleMetadata.databasePath);
    if (!existsSync(dbPath)) {
      return null;
    }

    try {
      const db = new SqliteProvider(dbPath);
      const repo = new TopicalIndexRepository(db);
      this.topicalIndexDbs.set(resolved, db);
      this.topicalIndexRepos.set(resolved, repo);
      return repo;
    } catch {
      return null;
    }
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
      this._tagGraphRepo = new TagGraphRepository(this._tagGraphDb);
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
    for (const db of this.bibleDbs.values()) {
      try { db.close(); } catch (err) { console.debug('Error closing Bible DB:', err); }
    }
    for (const db of this.commentaryDbs.values()) {
      try { db.close(); } catch (err) { console.debug('Error closing commentary DB:', err); }
    }
    for (const db of this.dictionaryDbs.values()) {
      try { db.close(); } catch (err) { console.debug('Error closing dictionary DB:', err); }
    }
    if (this.enrichmentsDb) {
      try { this.enrichmentsDb.close(); } catch (err) { console.debug('Error closing enrichments DB:', err); }
    }
    for (const db of this.topicalDbs.values()) {
      try { db.close(); } catch (err) { console.debug('Error closing topical DB:', err); }
    }
    for (const db of this.crossRefDbs.values()) {
      try { db.close(); } catch (err) { console.debug('Error closing cross-ref DB:', err); }
    }
    for (const db of this.topicalIndexDbs.values()) {
      try { db.close(); } catch (err) { console.debug('Error closing topical index DB:', err); }
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

    this.bibleRepos.clear();
    this.bibleDbs.clear();
    this.commentaryRepos.clear();
    this.commentaryDbs.clear();
    this.dictionaryRepos.clear();
    this.dictionaryDbs.clear();
    this.crossRefRepos.clear();
    this.crossRefDbs.clear();
    this.topicalIndexRepos.clear();
    this.topicalIndexDbs.clear();
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
