/**
 * The user database's table definitions as string constants.
 *
 * Browser-safe on purpose: no `node:fs`, no file reads, no globals touched at module load. The web's
 * OPFS worker and the desktop main process both create their user database from these statements
 * (`createUserSchema` in `./index`), so the two platforms cannot drift apart.
 *
 * Everything is `CREATE ... IF NOT EXISTS`: running it on an existing database only adds what is
 * missing and never alters or rewrites a table (shape repairs live in `Migration/repairUserSchema`).
 *
 * Provenance:
 * - the first block is the desktop DDL verbatim (constraints, FK actions, CHECKs, the
 *   `porter unicode61` FTS table and its triggers, indexes) so desktop behaviour does not change;
 *   `user_note.sort_order` is added for fresh databases (older ones lack it, the registry marks it optional);
 * - the second block is the tables only core used to create, from `sql/schemas/initial/UserDatabase.sql`
 *   (which stays the documented reference; a drift test compares the two);
 * - the memory tables are in `./memory`.
 *
 * No `sync_*` tables: the change tracker owns those. No `sync_metadata`: it is gone (task 0150).
 */

/** Tables desktop already shipped, plus `extension_storage` (moved here from the extension schema). */
export const DESKTOP_USER_DDL: readonly string[] = [
  // --- User Commentary Collections --------------------------------------
  `CREATE TABLE IF NOT EXISTS user_commentary (
  user_commentary_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_date TEXT DEFAULT CURRENT_TIMESTAMP,
  modified_date TEXT DEFAULT CURRENT_TIMESTAMP,
  is_default INTEGER DEFAULT 0,
  color TEXT,
  metadata TEXT,
  CHECK (is_default IN (0, 1))
)`,
  // --- User Notes -------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS user_note (
  note_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_commentary_id INTEGER,
  parent_note_id INTEGER,
  verse_id_start INTEGER,
  verse_id_end INTEGER,
  title TEXT,
  content TEXT NOT NULL,
  content_format TEXT DEFAULT 'html',
  note_type TEXT DEFAULT 'verse_note',
  document_type TEXT,
  visibility TEXT DEFAULT 'private',
  created_date TEXT DEFAULT CURRENT_TIMESTAMP,
  modified_date TEXT DEFAULT CURRENT_TIMESTAMP,
  tags TEXT,
  series_name TEXT,
  entry_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  CHECK (content_format IN ('html', 'markdown', 'plain')),
  CHECK (note_type IN ('verse_note', 'document', 'sermon', 'study', 'journal', 'prayer')),
  CHECK (visibility IN ('private', 'public'))
)`,
  // --- Note <-> Verse Links --------------------------------------------
  `CREATE TABLE IF NOT EXISTS note_verse_link (
  link_id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  verse_id_start INTEGER NOT NULL,
  verse_id_end INTEGER NOT NULL,   -- R-1: inclusive; single verse is end = start
  link_type TEXT DEFAULT 'reference',
  word_start INTEGER,
  word_end INTEGER,
  metadata TEXT,
  FOREIGN KEY (note_id) REFERENCES user_note(note_id) ON DELETE CASCADE,
  CHECK (link_type IN ('reference', 'annotation', 'primary_passage'))
)`,
  // --- Note Indexes -----------------------------------------------------
  'CREATE INDEX IF NOT EXISTS idx_user_note_type ON user_note(note_type)',
  'CREATE INDEX IF NOT EXISTS idx_user_note_modified ON user_note(modified_date DESC)',
  'CREATE INDEX IF NOT EXISTS idx_user_note_verse_start ON user_note(verse_id_start)',
  'CREATE INDEX IF NOT EXISTS idx_note_link_verse_start ON note_verse_link(verse_id_start)',
  'CREATE INDEX IF NOT EXISTS idx_note_link_note ON note_verse_link(note_id)',
  // --- FTS for Notes ----------------------------------------------------
  `CREATE VIRTUAL TABLE IF NOT EXISTS user_note_fts USING fts5(
  note_id UNINDEXED,
  title,
  content,
  tags,
  content='user_note',
  content_rowid='note_id',
  tokenize='porter unicode61'
)`,
  `CREATE TRIGGER IF NOT EXISTS user_note_fts_insert AFTER INSERT ON user_note BEGIN
  INSERT INTO user_note_fts(rowid, note_id, title, content, tags)
  VALUES (new.note_id, new.note_id, new.title, new.content, new.tags);
END`,
  `CREATE TRIGGER IF NOT EXISTS user_note_fts_update AFTER UPDATE ON user_note BEGIN
  UPDATE user_note_fts
  SET title = new.title, content = new.content, tags = new.tags
  WHERE rowid = new.note_id;
END`,
  `CREATE TRIGGER IF NOT EXISTS user_note_fts_delete AFTER DELETE ON user_note BEGIN
  DELETE FROM user_note_fts WHERE rowid = old.note_id;
END`,
  // --- Text Markup (Highlights) -----------------------------------------
  `CREATE TABLE IF NOT EXISTS user_text_markup (
  markup_id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL,
  verse_id_start INTEGER NOT NULL,
  -- R-1: inclusive and NOT NULL; a single verse is end = start. A NULL end
  -- made every single-verse markup match every range query starting after
  -- it, which mis-selected in getForVerseRange and silently DELETED
  -- out-of-range markups in deleteForVerseRange.
  verse_id_end INTEGER NOT NULL,
  text_start INTEGER,
  text_end INTEGER,
  -- hex #RRGGBB. The six-name palette is a UI constant, not a storage
  -- format; the old CHECK rejected every hex colour the app now writes, so a
  -- fresh database could not store a highlight at all.
  color TEXT NOT NULL,
  note_id INTEGER,
  created_date TEXT DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT,
  FOREIGN KEY (note_id) REFERENCES user_note(note_id) ON DELETE SET NULL
)`,
  'CREATE INDEX IF NOT EXISTS idx_markup_verse_start ON user_text_markup(verse_id_start)',
  'CREATE INDEX IF NOT EXISTS idx_markup_verse_end ON user_text_markup(verse_id_end)',
  'CREATE INDEX IF NOT EXISTS idx_markup_module ON user_text_markup(module_id)',
  'CREATE INDEX IF NOT EXISTS idx_markup_color ON user_text_markup(color)',
  // --- Collections ------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS collection (
  collection_id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_collection_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  icon TEXT,
  created_date TEXT DEFAULT CURRENT_TIMESTAMP,
  modified_date TEXT DEFAULT CURRENT_TIMESTAMP,
  sort_order INTEGER DEFAULT 0,
  metadata TEXT,
  FOREIGN KEY (parent_collection_id) REFERENCES collection(collection_id) ON DELETE CASCADE
)`,
  `CREATE TABLE IF NOT EXISTS pinned_item (
  pin_id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  verse_id_start INTEGER,
  verse_id_end INTEGER,
  reference_id INTEGER,
  reference_text TEXT,
  module_id INTEGER,
  title TEXT,
  notes TEXT,
  created_date TEXT DEFAULT CURRENT_TIMESTAMP,
  sort_order INTEGER DEFAULT 0,
  metadata TEXT,
  FOREIGN KEY (collection_id) REFERENCES collection(collection_id) ON DELETE CASCADE,
  CHECK (item_type IN ('verse', 'passage', 'note', 'commentary', 'dictionary_entry', 'book_section', 'image'))
)`,
  'CREATE INDEX IF NOT EXISTS idx_collection_parent ON collection(parent_collection_id)',
  'CREATE INDEX IF NOT EXISTS idx_pinned_collection ON pinned_item(collection_id, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_pinned_verse_start ON pinned_item(verse_id_start)',
  'CREATE INDEX IF NOT EXISTS idx_pinned_verse_end ON pinned_item(verse_id_end)',
  'CREATE INDEX IF NOT EXISTS idx_pinned_reference ON pinned_item(reference_id)',
  // --- Session ----------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS session (
  session_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_date TEXT DEFAULT CURRENT_TIMESTAMP,
  modified_date TEXT DEFAULT CURRENT_TIMESTAMP,
  last_opened TEXT,
  is_autosave INTEGER DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  session_data TEXT NOT NULL,
  metadata TEXT,
  CHECK (is_autosave IN (0, 1)),
  CHECK (is_default IN (0, 1))
)`,
  'CREATE INDEX IF NOT EXISTS idx_session_autosave ON session(is_autosave)',
  'CREATE INDEX IF NOT EXISTS idx_session_default ON session(is_default)',
  'CREATE INDEX IF NOT EXISTS idx_session_last_opened ON session(last_opened DESC)',
  // --- Content <-> Verse Links (auto-indexed references) ---------------
  `CREATE TABLE IF NOT EXISTS content_verse_link (
  link_id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  verse_id_start INTEGER NOT NULL,
  verse_id_end INTEGER NOT NULL,   -- R-1: inclusive; single verse is end = start
  link_type TEXT DEFAULT 'reference',
  position INTEGER,
  metadata TEXT,
  CHECK (content_type IN ('note', 'journal', 'prayer', 'document'))
)`,
  'CREATE INDEX IF NOT EXISTS idx_content_verse_link_verse_start ON content_verse_link(verse_id_start)',
  'CREATE INDEX IF NOT EXISTS idx_content_verse_link_verse_end ON content_verse_link(verse_id_end)',
  'CREATE INDEX IF NOT EXISTS idx_content_verse_link_content ON content_verse_link(content_type, content_id)',
  // --- User Keybindings -------------------------------------------------
  // Persisted user-rebinds. Loaded at app startup, registered with
  // source='user' in KeybindingService so they outrank built-in bindings.
  `CREATE TABLE IF NOT EXISTS user_keybindings (
  command_id  TEXT NOT NULL,
  key         TEXT NOT NULL,
  mac         TEXT,
  when_clause TEXT,
  PRIMARY KEY (command_id, key)
)`,
  // --- Command History --------------------------------------------------
  // Recency + frequency tracking for command palette ordering. Updated by
  // CommandRegistry.execute() on every successful invocation; queried at
  // boot to seed the in-memory CommandHistorySink.
  `CREATE TABLE IF NOT EXISTS command_history (
  command_id TEXT PRIMARY KEY,
  last_used  INTEGER NOT NULL,
  use_count  INTEGER NOT NULL DEFAULT 0
)`,
  'CREATE INDEX IF NOT EXISTS idx_command_history_last_used ON command_history(last_used DESC)',
  // --- Generic user data store ------------------------------------------
  // Same table core's UserDatabase.sql defines (section 4.7). Keyword marks
  // (task 0065) keep their sets here as owner 'app:keyword-marks'. Created
  // with IF NOT EXISTS, so it appears on an existing profile on next launch;
  // no row upgrade is needed, hence no USER_SCHEMA_VERSION bump.
  `CREATE TABLE IF NOT EXISTS user_data_item (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_uuid TEXT NOT NULL,
  collection TEXT NOT NULL,
  item_key TEXT NOT NULL,
  value TEXT,
  value_type TEXT NOT NULL DEFAULT 'json',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_date TEXT DEFAULT CURRENT_TIMESTAMP,
  modified_date TEXT DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT,
  UNIQUE(owner_uuid, collection, item_key),
  CHECK (value_type IN ('string', 'int', 'bool', 'json'))
)`,
  'CREATE INDEX IF NOT EXISTS idx_user_data_owner_collection ON user_data_item(owner_uuid, collection, sort_order)',
  // --- Extension key-value storage (tracked for sync as kind ext.kv) ----
  `CREATE TABLE IF NOT EXISTS extension_storage (
    extension_id TEXT NOT NULL,
    key          TEXT NOT NULL,
    value        TEXT NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (extension_id, key)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_extension_storage_ext ON extension_storage(extension_id)',
];

/** Tables core alone used to create (now created on every platform). */
export const CORE_USER_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS user_profile (
    profile_id INTEGER PRIMARY KEY CHECK (profile_id = 1),
    username TEXT NOT NULL UNIQUE,
    display_name TEXT,
    email TEXT,
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    last_login TEXT,
    preferences TEXT,
    metadata TEXT
)`,
  `CREATE TABLE IF NOT EXISTS verse_link (
    link_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type     TEXT NOT NULL,
    source_id       INTEGER NOT NULL,
    verse_id_start  INTEGER NOT NULL,
    verse_id_end    INTEGER NOT NULL,
    link_type       TEXT NOT NULL DEFAULT 'reference',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    context         TEXT,
    metadata        TEXT
)`,
  `CREATE INDEX IF NOT EXISTS idx_verse_link_source ON verse_link(source_type, source_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_verse_link_range  ON verse_link(verse_id_start, verse_id_end)`,
  `CREATE INDEX IF NOT EXISTS idx_verse_link_covering ON verse_link(verse_id_end, verse_id_start)`,
  `CREATE TABLE IF NOT EXISTS user_cross_reference (
    user_xref_id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_verse_id_start INTEGER NOT NULL,
    from_verse_id_end INTEGER NOT NULL,
    to_verse_id_start INTEGER NOT NULL,
    to_verse_id_end INTEGER NOT NULL,
    notes TEXT,
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    CHECK (from_verse_id_end >= from_verse_id_start),
    CHECK (to_verse_id_end >= to_verse_id_start)
)`,
  `CREATE INDEX IF NOT EXISTS idx_user_xref_from ON user_cross_reference(from_verse_id_start, from_verse_id_end)`,
  `CREATE INDEX IF NOT EXISTS idx_user_xref_from_covering ON user_cross_reference(from_verse_id_end, from_verse_id_start)`,
  `CREATE INDEX IF NOT EXISTS idx_user_xref_to ON user_cross_reference(to_verse_id_start, to_verse_id_end)`,
  `CREATE INDEX IF NOT EXISTS idx_user_xref_to_covering ON user_cross_reference(to_verse_id_end, to_verse_id_start)`,
  `CREATE TABLE IF NOT EXISTS reading_plan (
    plan_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    plan_type TEXT,
    duration_days INTEGER,
    is_builtin INTEGER DEFAULT 0,
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    CHECK (is_builtin IN (0, 1))
)`,
  `CREATE TABLE IF NOT EXISTS reading_plan_day (
    day_id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    day_number INTEGER NOT NULL,
    metadata TEXT,
    FOREIGN KEY (plan_id) REFERENCES reading_plan(plan_id) ON DELETE CASCADE,
    UNIQUE(plan_id, day_number)
)`,
  `CREATE INDEX IF NOT EXISTS idx_plan_day ON reading_plan_day(plan_id, day_number)`,
  `CREATE TABLE IF NOT EXISTS reading_plan_passage (
    passage_id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id INTEGER NOT NULL,
    session_name TEXT,
    verse_id_start INTEGER NOT NULL,
    verse_id_end INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    metadata TEXT,
    FOREIGN KEY (day_id) REFERENCES reading_plan_day(day_id) ON DELETE CASCADE
)`,
  `CREATE INDEX IF NOT EXISTS idx_reading_passage_day ON reading_plan_passage(day_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_reading_passage_session ON reading_plan_passage(day_id, session_name)`,
  `CREATE TABLE IF NOT EXISTS user_reading_progress (
    progress_id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    current_day INTEGER DEFAULT 1,
    completed_days TEXT,
    notes TEXT,
    status TEXT DEFAULT 'active',
    estimated_completion_date TEXT,
    streak_days INTEGER DEFAULT 0,
    metadata TEXT,
    FOREIGN KEY (plan_id) REFERENCES reading_plan(plan_id) ON DELETE CASCADE,
    CHECK (status IN ('active', 'paused', 'completed'))
)`,
  `CREATE INDEX IF NOT EXISTS idx_reading_progress_plan ON user_reading_progress(plan_id, status)`,
  `CREATE TABLE IF NOT EXISTS prayer_item (
    prayer_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    priority INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    answered_date TEXT,
    reminder_date TEXT,
    reminder_recurrence TEXT,
    tags TEXT,
    linked_verses TEXT,
    metadata TEXT,
    CHECK (priority BETWEEN 0 AND 5),
    CHECK (status IN ('active', 'answered', 'ongoing', 'archived')),
    CHECK (reminder_recurrence IN ('daily', 'weekly', 'monthly', 'once', NULL))
)`,
  `CREATE INDEX IF NOT EXISTS idx_prayer_status ON prayer_item(status)`,
  `CREATE INDEX IF NOT EXISTS idx_prayer_reminder ON prayer_item(reminder_date)`,
  `CREATE TABLE IF NOT EXISTS prayer_update (
    update_id INTEGER PRIMARY KEY AUTOINCREMENT,
    prayer_id INTEGER NOT NULL,
    update_text TEXT NOT NULL,
    update_date TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    FOREIGN KEY (prayer_id) REFERENCES prayer_item(prayer_id) ON DELETE CASCADE
)`,
  `CREATE INDEX IF NOT EXISTS idx_prayer_update_prayer ON prayer_update(prayer_id, update_date DESC)`,
  `CREATE TABLE IF NOT EXISTS journal_entry (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT NOT NULL,
    content_format TEXT DEFAULT 'html',
    entry_date TEXT NOT NULL,
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    modified_date TEXT DEFAULT CURRENT_TIMESTAMP,
    tags TEXT,
    mood TEXT,
    is_encrypted INTEGER DEFAULT 0,
    metadata TEXT,
    CHECK (content_format IN ('html', 'markdown', 'plain')),
    CHECK (is_encrypted IN (0, 1))
)`,
  `CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entry(entry_date DESC)`,
  `CREATE TABLE IF NOT EXISTS setting (
    setting_id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL DEFAULT 'general',
    key TEXT NOT NULL,
    value TEXT,
    value_type TEXT DEFAULT 'string',
    description TEXT,
    metadata TEXT,
    UNIQUE(category, key),
    CHECK (value_type IN ('string', 'int', 'bool', 'json'))
)`,
  `CREATE TABLE IF NOT EXISTS user_search_history (
    search_id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    search_type TEXT,
    scope TEXT,
    module_id INTEGER,
    result_count INTEGER,
    search_date TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT
)`,
  `CREATE INDEX IF NOT EXISTS idx_user_search_history_date ON user_search_history(search_date DESC)`,
  `CREATE TABLE IF NOT EXISTS navigation_history (
    nav_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    tab_id TEXT NOT NULL,
    module_id INTEGER NOT NULL,
    module_type TEXT,
    verse_id_start INTEGER NOT NULL,
    verse_id_end INTEGER NOT NULL,
    navigation_date TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    FOREIGN KEY (session_id) REFERENCES session(session_id) ON DELETE CASCADE
)`,
  `CREATE INDEX IF NOT EXISTS idx_nav_history_session ON navigation_history(session_id, tab_id, navigation_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_nav_history_module_type ON navigation_history(module_type, navigation_date DESC)`,
  `CREATE TABLE IF NOT EXISTS layout_preset (
    layout_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    is_stock INTEGER DEFAULT 0,
    layout_data TEXT NOT NULL,
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    CHECK (is_stock IN (0, 1))
)`,
  `CREATE TABLE IF NOT EXISTS module_display_option (
    option_id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL,
    option_key TEXT NOT NULL,
    option_value TEXT,
    metadata TEXT,
    UNIQUE(module_id, option_key)
)`,
  `CREATE INDEX IF NOT EXISTS idx_module_option ON module_display_option(module_id, option_key)`,

];

/** Every statement of the user schema except the memory tables, in creation order. */
export const USER_SCHEMA_DDL: readonly string[] = [...DESKTOP_USER_DDL, ...CORE_USER_DDL];
