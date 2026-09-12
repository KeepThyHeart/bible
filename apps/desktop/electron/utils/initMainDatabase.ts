import { SqliteProvider } from '../providers/SqliteProvider';
import { APP_CONFIG } from '../config/appConfig';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';

/**
 * Recognised `module_metadata.module_type` values.
 *
 * Mirrors `packages/core/src/Data/Core/Types.ts` (`MODULE_TYPES`), the
 * TypeScript source of truth. Core validates the set in TypeScript and its
 * canonical schema carries no CHECK for it; this legacy upgrader keeps an
 * explicit (rather than open) CHECK, so the two lists must be kept in sync
 * by hand.
 *
 * Used both by `createInitialSchema` (what a brand new database gets) and by
 * migration 005's table rebuild (what an existing database is upgraded to) -
 * a fresh install and a migrated install must end up with the identical
 * CHECK, or the two main.db creation paths silently diverge.
 */
const MODULE_TYPE_CHECK_VALUES = [
  'bible', 'commentary', 'dictionary', 'book', 'devotional', 'lexicon',
  'topical_index', 'cross_reference', 'tag_graph'
];

/**
 * Reference tables that hold the canonical verse space, in dependency order:
 * `bible_verse_ref` and `chapter_info` both carry a FK to `bible_book`, so
 * books have to land first.
 *
 * These are the tables no code path ever writes at runtime. Everything else in
 * main.db (`module_metadata`, `setting`, `saved_search`, `search_history`,
 * `module_repository`, `module_download_queue`) is user-owned state and is
 * never touched by the seed copy.
 */
const REFERENCE_TABLES = ['bible_book', 'bible_verse_ref', 'chapter_info'] as const;

/**
 * Initialize the main database schema
 * Runs the initial schema creation and applies migrations
 *
 * @param seedDbPath Optional path to the bundled read-only `main.db` template
 *   to copy the reference space from when this database has none. Callers in
 *   the app pass `getBundledMainDbPath()`; tests that build their own fixtures
 *   omit it.
 */
export function initializeMainDatabase(mainDbPath: string, seedDbPath?: string): SqliteProvider {
  log.info('[MainDB] Initializing main database:', mainDbPath);

  // Ensure the directory exists
  const dbDir = path.dirname(mainDbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    log.info('[MainDB] Created database directory:', dbDir);
  }

  // Check if database is new (doesn't exist yet)
  const isNewDatabase = !fs.existsSync(mainDbPath);

  // Open database connection
  const db = new SqliteProvider(mainDbPath, { readonly: false });

  if (isNewDatabase) {
    log.info('[MainDB] New database detected, running initial schema creation');
    createInitialSchema(db);
    applyMigrations(db);
  } else {
    log.info('[MainDB] Existing database detected, checking migrations');
    ensureSchemaUpToDate(db);
  }

  ensureModuleUuidColumn(db);
  ensureDefaultRepository(db);
  ensureReferenceData(db, seedDbPath);

  log.info('[MainDB] Database initialization complete');
  return db;
}

/**
 * Fill the canonical reference space from the bundled template when this
 * database has none.
 *
 * ## Why this is not covered by the first-run seed
 *
 * `resolveMainDbPath()` copies the bundled `main.db` into user data only when
 * no file is there yet. That misses the case that actually bites on an
 * upgrade: a *stale* user-data `main.db`, created schema-only by an earlier
 * build that called `initializeMainDatabase()` against that path and was then
 * abandoned. The file exists, so the seed is skipped, and the app runs forever
 * against a database whose `bible_book` is empty - every book name resolves
 * through `bibleHandlers`' `book?.bookName ?? 'Unknown'` fallback and every
 * menu built from the book list renders placeholders.
 *
 * Overwriting the file wholesale is not safe at this point: it may hold
 * settings, saved searches and history the template has not got. So the
 * reference rows are copied INTO the existing database instead, and nothing
 * user-owned is read or written.
 *
 * Columns are intersected rather than assumed equal (`INSERT ... SELECT *`
 * would break the moment a migration adds a column to one side and not the
 * other), and ATTACH is deliberately outside the transaction - SQLite refuses
 * to attach within one.
 */
function ensureReferenceData(db: SqliteProvider, seedDbPath?: string): void {
  let bookCount: number;
  try {
    bookCount = db.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM bible_book')?.count ?? 0;
  } catch (error) {
    // No bible_book table at all - a schema this old is beyond a row copy.
    log.error('[MainDB] Could not read bible_book; skipping reference seed:', error);
    return;
  }

  if (bookCount > 0) return;

  if (!seedDbPath) {
    log.warn('[MainDB] bible_book is empty and no seed database was supplied; book names will read "Unknown"');
    return;
  }

  if (!fs.existsSync(seedDbPath)) {
    log.error(`[MainDB] bible_book is empty and no bundled template at ${seedDbPath}; book names will read "Unknown"`);
    return;
  }

  log.info(`[MainDB] Empty reference space detected; seeding from ${seedDbPath}`);

  try {
    db.execute('ATTACH DATABASE ? AS seed', [seedDbPath]);
  } catch (error) {
    log.error('[MainDB] Failed to attach the bundled template:', error);
    return;
  }

  try {
    db.transaction(() => {
      for (const table of REFERENCE_TABLES) {
        const columns = sharedColumns(db, table);
        if (columns.length === 0) {
          log.warn(`[MainDB] No shared columns for ${table}; skipped`);
          continue;
        }
        const list = columns.map((c) => `"${c}"`).join(', ');
        const result = db.execute(
          `INSERT OR IGNORE INTO main.${table} (${list}) SELECT ${list} FROM seed.${table}`
        );
        log.info(`[MainDB] Seeded ${result.changes} row(s) into ${table}`);
      }
    });
  } catch (error) {
    log.error('[MainDB] Reference seed failed; the database is unchanged:', error);
  } finally {
    try {
      db.execute('DETACH DATABASE seed');
    } catch (error) {
      log.error('[MainDB] Failed to detach the bundled template:', error);
    }
  }
}

/**
 * Column names present in `table` in BOTH the open database and the attached
 * `seed` one, in the target's own order. Returns an empty array when either
 * side lacks the table.
 */
function sharedColumns(db: SqliteProvider, table: string): string[] {
  const namesIn = (schema: 'main' | 'seed'): string[] => {
    try {
      return db
        .queryAll<{ name: string }>(`PRAGMA ${schema}.table_info(${table})`)
        .map((row) => row.name);
    } catch {
      return [];
    }
  };

  const source = new Set(namesIn('seed'));
  return namesIn('main').filter((name) => source.has(name));
}

/**
 * Add `module_metadata.module_uuid` if it is missing.
 *
 * `ModuleMetadataRepository.create()` and `.update()` in `@bible/core` name
 * this column unconditionally, but no `main.db` this app has ever produced
 * contains it: neither `createInitialSchema` below nor the dev-environment
 * seeding script declares it, and none of `applyMigration002`-`005` adds it.
 * It exists only in the canonical schema
 * (`packages/core/sql/schemas/initial/MainDatabase.sql`), which only a freshly
 * created database is built from. Core ships no migration files at all - see
 * `packages/core/sql/migrations/README.md` and
 * `packages/core/docs/features/migrations.md` - so an existing database never
 * acquires the column except through this legacy upgrader.
 *
 * The consequence was not cosmetic: registering any *newly discovered* module
 * (`moduleDetector.ts`) or installing one (`InstallationService.ts`) threw
 * `table module_metadata has no column named module_uuid`. It stayed hidden
 * because an established install has every module registered already, so the
 * insert path only runs when a user adds a module.
 *
 * This is deliberately outside the `_schema` version ladder. That ladder and
 * the numbered `.sql` sequence disagree about which version means what, and
 * reconciling them is a larger change; a presence-checked `ALTER TABLE` is
 * idempotent, costs one pragma per launch, and cannot make that worse.
 */
function ensureModuleUuidColumn(db: SqliteProvider): void {
  const tableExists = db.queryOne(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='module_metadata'
  `);
  if (!tableExists) return;

  const column = db.queryOne(
    `SELECT name FROM pragma_table_info('module_metadata') WHERE name = 'module_uuid'`
  );
  if (column) return;

  log.info('[MainDB] Adding missing module_metadata.module_uuid column');
  // Nullable with no default: every existing row predates module identity, and
  // NULL is exactly what the canonical schema says a pre-2.0 module carries.
  db.execute(`ALTER TABLE module_metadata ADD COLUMN module_uuid TEXT`);
  db.execute(
    `CREATE INDEX IF NOT EXISTS idx_module_metadata_uuid ON module_metadata(module_uuid)`
  );
}

/**
 * Add this build's official catalog source when the database has none.
 *
 * Runs on every start rather than inside a migration, because most databases
 * never run the migration that used to seed it: `npm run init` and the main.db
 * template the installer ships (`init --no-modules`) both build the schema
 * directly, so a fresh install's first launch already finds an existing
 * database. Only when this build has a catalog URL (BIBLE_MODULE_CATALOG_URL,
 * defaulted from branding) - seeding a URL that 404s makes the Module Manager
 * look broken.
 *
 * Keyed on the type rather than the URL, so a user who edited or disabled the
 * official source keeps what they chose, and it is never added twice. The
 * official source cannot be removed, so "none" means it never existed here.
 */
function ensureDefaultRepository(db: SqliteProvider): void {
  if (APP_CONFIG.moduleCatalogUrl === '') {
    log.info('[MainDB] No default module catalog configured; skipping repository seed');
    return;
  }

  const tableExists = db.queryOne(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='module_repository'
  `);
  if (!tableExists) return;

  const official = db.queryOne(`SELECT repository_id FROM module_repository WHERE type = 'official' LIMIT 1`);
  if (official) return;

  log.info('[MainDB] Seeding the official module repository:', APP_CONFIG.moduleCatalogUrl);
  db.execute(
    `INSERT OR IGNORE INTO module_repository (name, abbreviation, url, type, is_enabled, priority)
     VALUES (?, 'OFFICIAL', ?, 'official', 1, 100)`,
    [`Official ${APP_CONFIG.productName} Repository`, APP_CONFIG.moduleCatalogUrl]
  );
}

/**
 * Create the initial main database schema
 */
function createInitialSchema(db: SqliteProvider): void {
  log.info('[MainDB] Creating initial schema...');

  // Enable foreign keys and set pragmas
  db.execute('PRAGMA foreign_keys = ON');
  db.execute('PRAGMA journal_mode = WAL');
  db.execute('PRAGMA synchronous = NORMAL');
  db.execute('PRAGMA temp_store = MEMORY');
  db.execute('PRAGMA cache_size = -64000');

  // Bible Books
  db.execute(`
    CREATE TABLE IF NOT EXISTS bible_book (
      book_id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_number INTEGER NOT NULL UNIQUE,
      book_name TEXT NOT NULL,
      book_abbreviation TEXT,
      testament TEXT NOT NULL,
      book_group TEXT,
      chapter_count INTEGER NOT NULL,
      verse_count INTEGER NOT NULL,
      metadata TEXT,
      CHECK (testament IN ('OT', 'NT')),
      CHECK (chapter_count > 0),
      CHECK (verse_count > 0)
    )
  `);

  db.execute('CREATE INDEX IF NOT EXISTS idx_bible_book_testament ON bible_book(testament)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_bible_book_group ON bible_book(book_group)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_bible_book_number ON bible_book(book_number)');

  // Bible Verse Reference
  db.execute(`
    CREATE TABLE IF NOT EXISTS bible_verse_ref (
      verse_id INTEGER PRIMARY KEY,
      absolute_id INTEGER NOT NULL UNIQUE,
      book_id INTEGER NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      is_book_start INTEGER DEFAULT 0,
      is_division_start INTEGER DEFAULT 0,
      metadata TEXT,
      FOREIGN KEY (book_id) REFERENCES bible_book(book_id) ON DELETE CASCADE,
      CHECK (chapter > 0),
      CHECK (verse > 0),
      CHECK (is_book_start IN (0, 1)),
      CHECK (is_division_start IN (0, 1))
    )
  `);

  db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_verse_ref_absolute ON bible_verse_ref(absolute_id)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_verse_ref_book_chapter ON bible_verse_ref(book_id, chapter)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_verse_ref_location ON bible_verse_ref(book_id, chapter, verse)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_verse_ref_division_start ON bible_verse_ref(is_division_start) WHERE is_division_start = 1');

  // Chapter Info
  db.execute(`
    CREATE TABLE IF NOT EXISTS chapter_info (
      chapter_info_id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter INTEGER NOT NULL,
      verse_count INTEGER NOT NULL,
      first_absolute_id INTEGER NOT NULL,
      last_absolute_id INTEGER NOT NULL,
      metadata TEXT,
      FOREIGN KEY (book_id) REFERENCES bible_book(book_id) ON DELETE CASCADE,
      UNIQUE(book_id, chapter),
      CHECK (chapter > 0),
      CHECK (verse_count > 0)
    )
  `);

  db.execute('CREATE INDEX IF NOT EXISTS idx_chapter_info_book ON chapter_info(book_id, chapter)');

  // Module Metadata
  db.execute(`
    CREATE TABLE IF NOT EXISTS module_metadata (
      module_id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Stable identity across versions; NULL for pre-2.0 modules. Also added
      -- to existing databases by ensureModuleUuidColumn().
      module_uuid TEXT,
      module_type TEXT NOT NULL,
      module_name TEXT NOT NULL,
      abbreviation TEXT,
      version TEXT,
      language_code TEXT,
      installed_date TEXT DEFAULT CURRENT_TIMESTAMP,
      last_updated TEXT,
      database_path TEXT NOT NULL,
      size_bytes INTEGER,
      is_indexed INTEGER DEFAULT 0,
      last_indexed_date TEXT,
      features TEXT,
      sword_metadata TEXT,
      metadata TEXT,
      CHECK (module_type IN (${MODULE_TYPE_CHECK_VALUES.map(t => `'${t}'`).join(', ')})),
      CHECK (is_indexed IN (0, 1))
    )
  `);

  db.execute('CREATE INDEX IF NOT EXISTS idx_module_type ON module_metadata(module_type)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_module_language ON module_metadata(language_code)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_module_indexed ON module_metadata(is_indexed) WHERE is_indexed = 0');
  // One row per module file, enforced by the database rather than by the caller
  // remembering to check. moduleDetector previously compared a Windows
  // `modules\x.db` against the stored `modules/x.db`, never matched, and
  // re-registered every module on every launch. Migration 014 repairs existing
  // databases; this gives a freshly-created one the same guarantee.
  db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_module_metadata_path_unique ON module_metadata(database_path)');

  // Application Settings
  db.execute(`
    CREATE TABLE IF NOT EXISTS setting (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      metadata TEXT
    )
  `);

  // Initialize with current schema version
  db.execute("INSERT INTO setting (key, value) VALUES ('_schema', '1.0.0')");

  // Schema Version History
  db.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version_id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_number TEXT NOT NULL,
      applied_date TEXT DEFAULT CURRENT_TIMESTAMP,
      migration_script_up TEXT,
      migration_script_down TEXT,
      notes TEXT,
      metadata TEXT
    )
  `);

  // Insert initial version
  db.execute(`
    INSERT INTO schema_version (version_number, notes)
    VALUES ('1.0.0', 'Main database schema - Bible reference structure and module registry')
  `);

  log.info('[MainDB] Initial schema created successfully');
}

/**
 * Apply all migrations to bring database up to date
 */
function applyMigrations(db: SqliteProvider): void {
  log.info('[MainDB] Applying migrations...');

  // Check if setting table exists
  const settingTableExists = db.queryOne(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='setting'
  `);

  if (!settingTableExists) {
    log.warn('[MainDB] Setting table does not exist, cannot apply migrations');
    return;
  }

  // Get current schema version
  const currentVersion = db.queryOne(`SELECT value FROM setting WHERE key = '_schema'`) as { value: string } | undefined;
  const version = currentVersion?.value || '1.0.0';

  log.info('[MainDB] Current schema version:', version);

  // Ensure schema_version table exists (older databases may not have it)
  db.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version_id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_number TEXT NOT NULL,
      applied_date TEXT DEFAULT CURRENT_TIMESTAMP,
      migration_script_up TEXT,
      migration_script_down TEXT,
      notes TEXT,
      metadata TEXT
    )
  `);

  // Apply migration 002 if needed (module manager tables)
  if (version === '1.0.0') {
    log.info('[MainDB] Applying migration 002_module_manager...');
    applyMigration002(db);
  }

  // Apply migration 003 if needed (cross-reference module flag)
  const currentVer = db.queryOne(`SELECT value FROM setting WHERE key = '_schema'`) as { value: string } | undefined;
  if (currentVer?.value === '2.0.0') {
    log.info('[MainDB] Applying migration 003_cross_reference_flag...');
    applyMigration003(db);
  }

  // Apply migration 004 if needed (catalog signing columns)
  const verAfter003 = db.queryOne(`SELECT value FROM setting WHERE key = '_schema'`) as { value: string } | undefined;
  if (verAfter003?.value === '3.0.0') {
    log.info('[MainDB] Applying migration 004_catalog_signing...');
    applyMigration004(db);
  }

  // Apply migration 005 if needed (widen module_type CHECK)
  const verAfter004 = db.queryOne(`SELECT value FROM setting WHERE key = '_schema'`) as { value: string } | undefined;
  if (verAfter004?.value === '4.0.0') {
    log.info('[MainDB] Applying migration 005_module_type_widen...');
    applyMigration005(db);
  }

  log.info('[MainDB] Migrations complete');
}

/**
 * Apply migration 002: Module Manager tables
 */
function applyMigration002(db: SqliteProvider): void {
  // Module Repository Table
  db.execute(`
    CREATE TABLE IF NOT EXISTS module_repository (
      repository_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      abbreviation TEXT,
      url TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0,
      catalog_json TEXT,
      last_updated TEXT,
      last_fetched TEXT,
      metadata TEXT,
      signature_status TEXT,
      signing_public_key TEXT,
      CHECK (type IN ('official', 'crosswire', 'third_party', 'local')),
      CHECK (is_enabled IN (0, 1))
    )
  `);

  db.execute('CREATE INDEX IF NOT EXISTS idx_repo_enabled ON module_repository(is_enabled, priority)');

  // The official repository is seeded by `ensureDefaultRepository` on every
  // start, not here: most databases never run this migration.

  // Module Download Queue Table
  db.execute(`
    CREATE TABLE IF NOT EXISTS module_download_queue (
      queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id TEXT NOT NULL,
      module_name TEXT NOT NULL,
      download_url TEXT NOT NULL,
      download_size_bytes INTEGER,
      status TEXT DEFAULT 'pending',
      progress_bytes INTEGER DEFAULT 0,
      download_speed_bps INTEGER,
      started_date TEXT,
      completed_date TEXT,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      metadata TEXT,
      CHECK (status IN ('pending', 'downloading', 'completed', 'failed', 'paused'))
    )
  `);

  db.execute('CREATE INDEX IF NOT EXISTS idx_download_status ON module_download_queue(status)');

  // Module Update Table
  db.execute(`
    CREATE TABLE IF NOT EXISTS module_update (
      update_id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER NOT NULL,
      current_version TEXT NOT NULL,
      available_version TEXT NOT NULL,
      release_date TEXT,
      changelog TEXT,
      download_url TEXT NOT NULL,
      download_size_bytes INTEGER,
      is_critical INTEGER DEFAULT 0,
      user_ignored INTEGER DEFAULT 0,
      notified_date TEXT,
      metadata TEXT,
      FOREIGN KEY (module_id) REFERENCES module_metadata(module_id) ON DELETE CASCADE,
      CHECK (is_critical IN (0, 1)),
      CHECK (user_ignored IN (0, 1))
    )
  `);

  db.execute('CREATE INDEX IF NOT EXISTS idx_update_module ON module_update(module_id)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_update_available ON module_update(user_ignored) WHERE user_ignored = 0');

  // Extend module_metadata table - Use ALTER TABLE which is safe with IF NOT EXISTS logic
  try {
    db.execute('ALTER TABLE module_metadata ADD COLUMN repository_id INTEGER');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  try {
    db.execute('ALTER TABLE module_metadata ADD COLUMN update_available INTEGER DEFAULT 0');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  try {
    db.execute('ALTER TABLE module_metadata ADD COLUMN last_used_date TEXT');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  try {
    db.execute('ALTER TABLE module_metadata ADD COLUMN usage_count INTEGER DEFAULT 0');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  try {
    db.execute('ALTER TABLE module_metadata ADD COLUMN user_hidden INTEGER DEFAULT 0');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  // Add indexes for new columns
  db.execute('CREATE INDEX IF NOT EXISTS idx_module_repository ON module_metadata(repository_id)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_module_hidden ON module_metadata(user_hidden) WHERE user_hidden = 0');
  db.execute('CREATE INDEX IF NOT EXISTS idx_module_update ON module_metadata(update_available) WHERE update_available = 1');

  // Update schema version
  db.execute("UPDATE setting SET value = '2.0.0' WHERE key = '_schema'");

  db.execute(`
    INSERT INTO schema_version (version_number, notes)
    VALUES ('2.0.0', 'Module Manager tables - repository, download queue, updates, and extended module metadata')
  `);

  log.info('[MainDB] Migration 002 applied successfully');
}

/**
 * Apply migration 003: Cross-Reference Module Flag
 */
function applyMigration003(db: SqliteProvider): void {
  try {
    db.execute('ALTER TABLE module_metadata ADD COLUMN is_cross_reference_module INTEGER DEFAULT 0');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  db.execute('CREATE INDEX IF NOT EXISTS idx_module_xref_flag ON module_metadata(is_cross_reference_module) WHERE is_cross_reference_module = 1');

  // Update schema version
  db.execute("UPDATE setting SET value = '3.0.0' WHERE key = '_schema'");

  db.execute(`
    INSERT INTO schema_version (version_number, notes)
    VALUES ('3.0.0', 'Added is_cross_reference_module flag for Study Mode')
  `);

  log.info('[MainDB] Migration 003 applied successfully');
}

/**
 * Apply migration 004: Catalog signing columns
 *
 * The same columns are declared in core's canonical schema
 * (`packages/core/sql/schemas/initial/MainDatabase.sql`) - keep the two in
 * sync. (Numbered 004 because this legacy upgrader has its own sequence,
 * unrelated to core's `sql/migrations/` ledger, which currently ships no
 * files: a fresh database is built from the initial schema already current.)
 */
function applyMigration004(db: SqliteProvider): void {
  try {
    db.execute('ALTER TABLE module_repository ADD COLUMN signature_status TEXT');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  try {
    db.execute('ALTER TABLE module_repository ADD COLUMN signing_public_key TEXT');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  // Update schema version
  db.execute("UPDATE setting SET value = '4.0.0' WHERE key = '_schema'");

  db.execute(`
    INSERT INTO schema_version (version_number, notes)
    VALUES ('4.0.0', 'Added catalog signature_status/signing_public_key columns')
  `);

  log.info('[MainDB] Migration 004 applied successfully');
}

/**
 * Apply migration 005: widen the module_type CHECK constraint
 *
 * `createInitialSchema` declares `module_metadata` with a CHECK that already
 * includes `topical_index`/`cross_reference`/`tag_graph`, but `CREATE TABLE
 * IF NOT EXISTS` never retroactively alters an EXISTING table's CHECK - and
 * SQLite has no `ALTER TABLE ... DROP/MODIFY CHECK`. Every main.db created
 * before that widened CHECK existed (including the one
 * `apps/desktop/data/main.db` that `stage-build-data.js` copies verbatim
 * into every installer) is still stuck on the old, narrower constraint and
 * rejects `topical_index`/`cross_reference` inserts with SQLITE_CONSTRAINT.
 *
 * Uses the standard SQLite 12-step rebuild: create `module_metadata_v2` with
 * the widened CHECK, copy every row, drop the original, rename the shadow
 * table into place, recreate its indexes. By the time this migration runs
 * (gated on schema version 4.0.0), migrations 002 and 003 have already run in
 * this same pass, so the full column set - including the columns they add
 * (repository_id, update_available, last_used_date, usage_count,
 * user_hidden, is_cross_reference_module) - is guaranteed to already exist.
 */
function applyMigration005(db: SqliteProvider): void {
  const existing = db.queryOne(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'module_metadata'`
  ) as { sql: string } | undefined;

  const alreadyWidened =
    !!existing?.sql &&
    MODULE_TYPE_CHECK_VALUES.every(t => existing.sql.includes(`'${t}'`));

  if (alreadyWidened) {
    log.info('[MainDB] module_metadata module_type CHECK already widened, skipping rebuild');
  } else {
    log.info('[MainDB] Rebuilding module_metadata to widen module_type CHECK...');
    rebuildModuleMetadataWithWidenedCheck(db);
  }

  // Update schema version
  db.execute("UPDATE setting SET value = '5.0.0' WHERE key = '_schema'");

  db.execute(`
    INSERT INTO schema_version (version_number, notes)
    VALUES ('5.0.0', 'Rebuilt module_metadata to widen module_type CHECK (adds topical_index, cross_reference, tag_graph)')
  `);

  log.info('[MainDB] Migration 005 applied successfully');
}

/**
 * Standard SQLite 12-step table rebuild for `module_metadata`, needed
 * because SQLite cannot alter a CHECK constraint in place.
 */
function rebuildModuleMetadataWithWidenedCheck(db: SqliteProvider): void {
  // Recreating indexes after the rename needs their definitions; capture them
  // before the DROP TABLE removes them along with the table.
  const indexRows = db.queryAll(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'module_metadata' AND sql IS NOT NULL`
  ) as { sql: string }[];

  // PRAGMA foreign_keys is a no-op inside a transaction, so it must be
  // toggled outside the BEGIN/COMMIT the rebuild runs in.
  db.execute('PRAGMA foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.execute(`
        CREATE TABLE module_metadata_v2 (
          module_id INTEGER PRIMARY KEY AUTOINCREMENT,
          module_type TEXT NOT NULL,
          module_name TEXT NOT NULL,
          abbreviation TEXT,
          version TEXT,
          language_code TEXT,
          installed_date TEXT DEFAULT CURRENT_TIMESTAMP,
          last_updated TEXT,
          database_path TEXT NOT NULL,
          size_bytes INTEGER,
          is_indexed INTEGER DEFAULT 0,
          last_indexed_date TEXT,
          features TEXT,
          sword_metadata TEXT,
          metadata TEXT,
          repository_id INTEGER,
          update_available INTEGER DEFAULT 0,
          last_used_date TEXT,
          usage_count INTEGER DEFAULT 0,
          user_hidden INTEGER DEFAULT 0,
          is_cross_reference_module INTEGER DEFAULT 0,
          CHECK (module_type IN (${MODULE_TYPE_CHECK_VALUES.map(t => `'${t}'`).join(', ')})),
          CHECK (is_indexed IN (0, 1))
        )
      `);

      db.execute(`
        INSERT INTO module_metadata_v2 (
          module_id, module_type, module_name, abbreviation, version, language_code,
          installed_date, last_updated, database_path, size_bytes, is_indexed,
          last_indexed_date, features, sword_metadata, metadata, repository_id,
          update_available, last_used_date, usage_count, user_hidden, is_cross_reference_module
        )
        SELECT
          module_id, module_type, module_name, abbreviation, version, language_code,
          installed_date, last_updated, database_path, size_bytes, is_indexed,
          last_indexed_date, features, sword_metadata, metadata, repository_id,
          update_available, last_used_date, usage_count, user_hidden, is_cross_reference_module
        FROM module_metadata
      `);

      db.execute('DROP TABLE module_metadata');
      db.execute('ALTER TABLE module_metadata_v2 RENAME TO module_metadata');

      for (const { sql } of indexRows) {
        db.execute(sql);
      }

      const fkViolations = db.queryAll('PRAGMA foreign_key_check');
      if (fkViolations.length > 0) {
        throw new Error(`Foreign key check failed after rebuilding module_metadata: ${JSON.stringify(fkViolations)}`);
      }
    });
  } finally {
    db.execute('PRAGMA foreign_keys = ON');
  }

  log.info('[MainDB] module_metadata rebuilt with widened module_type CHECK');
}

/**
 * Ensure the database schema is up to date for existing databases
 */
function ensureSchemaUpToDate(db: SqliteProvider): void {
  // Check if setting table exists
  const settingTableExists = db.queryOne(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='setting'
  `);

  if (!settingTableExists) {
    log.warn('[MainDB] Database exists but has no schema - initializing from scratch');
    createInitialSchema(db);
    applyMigrations(db);
    return;
  }

  // Check current version
  const currentVersion = db.queryOne(`SELECT value FROM setting WHERE key = '_schema'`) as { value: string } | undefined;
  const version = currentVersion?.value || '1.0.0';

  log.info('[MainDB] Checking schema version:', version);

  // Apply any pending migrations
  if (version === '1.0.0' || version === '2.0.0' || version === '3.0.0' || version === '4.0.0') {
    log.info('[MainDB] Schema update needed, applying migrations...');
    applyMigrations(db);
  } else {
    log.info('[MainDB] Schema is up to date');
  }
}
