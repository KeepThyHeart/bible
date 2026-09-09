/**
 * Centralized user database schema.
 *
 * All user_*.db tables are defined here and applied idempotently via
 * CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS. Handlers no
 * longer carry their own inline DDL; they call initializeUserSchema()
 * instead.
 */
import type { ISql } from '@bible/core';
import { repairUserSchema } from '@bible/core';

/**
 * Create all user database tables, indexes, triggers, and FTS tables.
 * Safe to call multiple times (idempotent via IF NOT EXISTS).
 */
export function initializeUserSchema(db: ISql): void {
  // --- User Commentary Collections --------------------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS user_commentary (
      user_commentary_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_date TEXT DEFAULT CURRENT_TIMESTAMP,
      modified_date TEXT DEFAULT CURRENT_TIMESTAMP,
      is_default INTEGER DEFAULT 0,
      color TEXT,
      metadata TEXT,
      CHECK (is_default IN (0, 1))
    )
  `);

  // --- User Notes -------------------------------------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS user_note (
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
      metadata TEXT,
      CHECK (content_format IN ('html', 'markdown', 'plain')),
      CHECK (note_type IN ('verse_note', 'document', 'sermon', 'study', 'journal', 'prayer')),
      CHECK (visibility IN ('private', 'public'))
    )
  `);

  // --- Note <-> Verse Links --------------------------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS note_verse_link (
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
    )
  `);

  // --- Note Indexes -----------------------------------------------------
  db.execute('CREATE INDEX IF NOT EXISTS idx_user_note_type ON user_note(note_type)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_user_note_modified ON user_note(modified_date DESC)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_user_note_verse_start ON user_note(verse_id_start)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_note_link_verse_start ON note_verse_link(verse_id_start)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_note_link_note ON note_verse_link(note_id)');

  // --- FTS for Notes ----------------------------------------------------
  db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS user_note_fts USING fts5(
      note_id UNINDEXED,
      title,
      content,
      tags,
      content='user_note',
      content_rowid='note_id',
      tokenize='porter unicode61'
    )
  `);

  db.execute(`
    CREATE TRIGGER IF NOT EXISTS user_note_fts_insert AFTER INSERT ON user_note BEGIN
      INSERT INTO user_note_fts(rowid, note_id, title, content, tags)
      VALUES (new.note_id, new.note_id, new.title, new.content, new.tags);
    END
  `);

  db.execute(`
    CREATE TRIGGER IF NOT EXISTS user_note_fts_update AFTER UPDATE ON user_note BEGIN
      UPDATE user_note_fts
      SET title = new.title, content = new.content, tags = new.tags
      WHERE rowid = new.note_id;
    END
  `);

  db.execute(`
    CREATE TRIGGER IF NOT EXISTS user_note_fts_delete AFTER DELETE ON user_note BEGIN
      DELETE FROM user_note_fts WHERE rowid = old.note_id;
    END
  `);

  // --- Text Markup (Highlights) -----------------------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS user_text_markup (
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
    )
  `);

  db.execute('CREATE INDEX IF NOT EXISTS idx_markup_verse_start ON user_text_markup(verse_id_start)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_markup_verse_end ON user_text_markup(verse_id_end)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_markup_module ON user_text_markup(module_id)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_markup_color ON user_text_markup(color)');

  // --- Collections ------------------------------------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS collection (
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
    )
  `);

  db.execute(`
    CREATE TABLE IF NOT EXISTS pinned_item (
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
    )
  `);

  db.execute('CREATE INDEX IF NOT EXISTS idx_collection_parent ON collection(parent_collection_id)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_pinned_collection ON pinned_item(collection_id, sort_order)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_pinned_verse_start ON pinned_item(verse_id_start)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_pinned_verse_end ON pinned_item(verse_id_end)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_pinned_reference ON pinned_item(reference_id)');

  // --- Session ----------------------------------------------------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS session (
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
    )
  `);

  db.execute('CREATE INDEX IF NOT EXISTS idx_session_autosave ON session(is_autosave)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_session_default ON session(is_default)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_session_last_opened ON session(last_opened DESC)');

  // --- Content <-> Verse Links (auto-indexed references) ---------------
  db.execute(`
    CREATE TABLE IF NOT EXISTS content_verse_link (
      link_id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_type TEXT NOT NULL,
      content_id INTEGER NOT NULL,
      verse_id_start INTEGER NOT NULL,
      verse_id_end INTEGER NOT NULL,   -- R-1: inclusive; single verse is end = start
      link_type TEXT DEFAULT 'reference',
      position INTEGER,
      metadata TEXT,
      CHECK (content_type IN ('note', 'journal', 'prayer', 'document'))
    )
  `);

  db.execute('CREATE INDEX IF NOT EXISTS idx_content_verse_link_verse_start ON content_verse_link(verse_id_start)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_content_verse_link_verse_end ON content_verse_link(verse_id_end)');
  db.execute('CREATE INDEX IF NOT EXISTS idx_content_verse_link_content ON content_verse_link(content_type, content_id)');

  // --- User Keybindings -------------------------------------------------
  // Persisted user-rebinds. Loaded at app startup, registered with
  // source='user' in KeybindingService so they outrank built-in bindings.
  db.execute(`
    CREATE TABLE IF NOT EXISTS user_keybindings (
      command_id  TEXT NOT NULL,
      key         TEXT NOT NULL,
      mac         TEXT,
      when_clause TEXT,
      PRIMARY KEY (command_id, key)
    )
  `);

  // --- Command History --------------------------------------------------
  // Recency + frequency tracking for command palette ordering. Updated by
  // CommandRegistry.execute() on every successful invocation; queried at
  // boot to seed the in-memory CommandHistorySink.
  db.execute(`
    CREATE TABLE IF NOT EXISTS command_history (
      command_id TEXT PRIMARY KEY,
      last_used  INTEGER NOT NULL,
      use_count  INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.execute('CREATE INDEX IF NOT EXISTS idx_command_history_last_used ON command_history(last_used DESC)');

  // Everything above is CREATE ... IF NOT EXISTS, which is a no-op on a
  // database an older build already created - so an upgraded profile keeps the
  // old build's constraints forever. That is not hypothetical: it is why
  // highlighting and underlining were dead on every profile older than the
  // hex-colour change. Repair runs last, once the tables are known to exist.
  repairUserSchema(db);
}
