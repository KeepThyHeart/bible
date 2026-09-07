/**
 * In-place repair of user databases created by older builds.
 *
 * WHY THIS EXISTS
 * ---------------
 * `initializeUserSchema` applies its DDL with `CREATE TABLE IF NOT EXISTS`,
 * which is a no-op on a database that already has the table. That is correct
 * for a *fresh* profile and useless for an *upgraded* one: a table created by
 * an older build keeps that build's constraints forever.
 *
 * Highlighting and underlining were dead on every upgraded profile because of
 * exactly this. An older revision created the table with
 *
 *     CHECK (color IN ('yellow','green','blue','red','purple','orange'))
 *
 * and the write path now always emits canonical hex (`normalizeMarkupColor` in
 * `UserTextMarkupRepository.create`). Every INSERT therefore failed with
 * "CHECK constraint failed", the failure was swallowed on the way back to the
 * renderer, and the toolbar dismissed itself as if the gesture had worked.
 * A fresh install worked, so the e2e suite - which deletes the whole userData
 * directory per worker - never saw it.
 *
 * `MigrationRunner` plus `007_markup_color_hex.sql` would fix this, but the
 * desktop app cannot run them: `@bible/core` is *bundled* into
 * `out/main/index.js` (see the comment in `electron.vite.config.ts`), so no
 * `__dirname`-relative walk reaches the `.sql` files, and they are not shipped
 * in the package either. Rather than ship a second copy of the SQL as an
 * extra resource, the two shape fixes the user DB actually needs are
 * expressed here as inline, idempotent, shape-detected repairs - matching how
 * the desktop's `initMainDatabase.ts` already handles `main.db`. Being pure
 * `ISql`, this runs anywhere a user database is opened, bundled or not.
 *
 * DESIGN RULES
 * ------------
 * * **Shape-detected, not ledger-driven.** The decision to repair is made from
 *   `sqlite_master.sql`, so it is correct even for a database whose migration
 *   ledger is missing or lying. Running it twice is a no-op.
 * * **Never lossy.** The original colour name is preserved in `metadata.colorName`
 *   before the value is rewritten, so the mapping is reversible. Values that are
 *   already hex, or that are not one of the six known names, are left untouched.
 * * **Atomic.** The rebuild runs in one transaction with foreign keys disabled
 *   (SQLite requires that to rebuild a table), and `PRAGMA foreign_key_check`
 *   runs before commit so a violation rolls back instead of persisting.
 *
 * The colour mapping below MUST stay identical to `HIGHLIGHT_COLOR_HEX` in
 * `packages/core/src/Data/Core/Colors.ts` and to migration
 * `007_markup_color_hex.sql`. `markupColorName()` reverse-maps hex back to a
 * palette name so the UI shows the right swatch as selected; a value that
 * differs by one digit silently becomes an unnamed "custom" colour.
 */
import type { ISql } from '../Core/ISql';

/** Palette name -> canonical hex. Mirrors `HIGHLIGHT_COLOR_HEX`. */
const LEGACY_COLOR_HEX: Readonly<Record<string, string>> = {
  yellow: '#FFF3A3',
  green: '#B7E4C7',
  blue: '#B8DDF5',
  red: '#F7B7B7',
  purple: '#D9C2F0',
  orange: '#FBD1A2',
};

/** What `repairUserSchema` found and did. Returned so startup can log it. */
export interface UserSchemaRepairReport {
  /** True when the stored DDL carried the six-name `CHECK` on `color`. */
  hadLegacyColorCheck: boolean;
  /** True when `verse_id_end` was still nullable (pre-R-1 shape). */
  hadNullableVerseEnd: boolean;
  /** True when the table was actually rebuilt. */
  rebuilt: boolean;
  /** Rows whose colour was converted from a palette name to hex. */
  colorsConverted: number;
  /** Rows whose NULL `verse_id_end` was backfilled from `verse_id_start`. */
  verseEndsBackfilled: number;
}

const NO_REPAIR: UserSchemaRepairReport = {
  hadLegacyColorCheck: false,
  hadNullableVerseEnd: false,
  rebuilt: false,
  colorsConverted: 0,
  verseEndsBackfilled: 0,
};

/** The stored `CREATE TABLE` text for a table, or undefined if it has none. */
function storedDdl(db: ISql, table: string): string | undefined {
  const row = db.queryOne<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table]
  );
  return row?.sql ?? undefined;
}

/**
 * Bring `user_text_markup` up to the current shape if an older build created it.
 *
 * Two drifts are detected and fixed together, because both require the same
 * table rebuild and doing them in one pass halves the risk:
 *
 * 1. **The six-name colour CHECK.** Rejects every hex colour
 *    the app writes - this is what broke highlight and underline outright.
 * 2. **A nullable `verse_id_end`** (pre R-1). A NULL end made a single-verse
 *    markup match every range query starting after it, which mis-selected in
 *    `getForVerseRange` and silently deleted out-of-range markups in
 *    `deleteForVerseRange`.
 *
 * Safe to call on every open; returns immediately when the table is already
 * current or does not exist.
 */
export function repairUserTextMarkup(db: ISql): UserSchemaRepairReport {
  const ddl = storedDdl(db, 'user_text_markup');
  if (!ddl) return NO_REPAIR;

  // Matched against the stored DDL rather than a version number so a database
  // with a lost or wrong ledger still gets the right answer.
  const hadLegacyColorCheck = /CHECK\s*\(\s*color\s+IN\s*\(/i.test(ddl);
  const hadNullableVerseEnd = !/verse_id_end\s+INTEGER\s+NOT\s+NULL/i.test(ddl);

  if (!hadLegacyColorCheck && !hadNullableVerseEnd) return NO_REPAIR;

  // PRAGMA foreign_keys is a no-op inside a transaction, so it must be toggled
  // around one. Rebuilding a table with FKs on would cascade the DROP into
  // referencing rows.
  //
  // The prior value is read and restored rather than assumed: every connection
  // this runs on today enables foreign keys at open, but a caller that had them
  // off should not have them silently switched on by a repair.
  const foreignKeysWereOn =
    db.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys === 1;
  db.execute('PRAGMA foreign_keys = OFF');
  try {
    return db.transaction(() => {
      // ORDER MATTERS. The colour rewrite cannot run first: the old table still
      // carries the CHECK it is trying to escape, so every UPDATE to hex would
      // fail exactly the way the app's INSERTs did. Rebuild first, convert
      // inside the new, unconstrained table.

      // A single-verse markup is end = start. This one must happen BEFORE the
      // rebuild, whose target column is NOT NULL - and it is safe there because
      // the legacy CHECK only ever covered `color`.
      const verseEndsBackfilled = db.execute(
        'UPDATE user_text_markup SET verse_id_end = verse_id_start WHERE verse_id_end IS NULL'
      ).changes;

      // SQLite has no ALTER TABLE ... DROP CONSTRAINT, so a rebuild is the only
      // way to shed the CHECK and to tighten verse_id_end.
      db.execute(`
        CREATE TABLE user_text_markup_repaired (
          markup_id INTEGER PRIMARY KEY AUTOINCREMENT,
          module_id INTEGER NOT NULL,
          verse_id_start INTEGER NOT NULL,
          verse_id_end INTEGER NOT NULL,
          text_start INTEGER,
          text_end INTEGER,
          color TEXT NOT NULL,
          note_id INTEGER,
          created_date TEXT DEFAULT CURRENT_TIMESTAMP,
          metadata TEXT,
          FOREIGN KEY (note_id) REFERENCES user_note(note_id) ON DELETE SET NULL
        )
      `);

      db.execute(`
        INSERT INTO user_text_markup_repaired
          (markup_id, module_id, verse_id_start, verse_id_end,
           text_start, text_end, color, note_id, created_date, metadata)
        SELECT markup_id, module_id, verse_id_start, verse_id_end,
               text_start, text_end, color, note_id, created_date, metadata
        FROM user_text_markup
      `);

      db.execute('DROP TABLE user_text_markup');
      db.execute('ALTER TABLE user_text_markup_repaired RENAME TO user_text_markup');

      // Indexes live with the table, so the DROP took them with it.
      db.execute('CREATE INDEX IF NOT EXISTS idx_markup_verse_start ON user_text_markup(verse_id_start)');
      db.execute('CREATE INDEX IF NOT EXISTS idx_markup_verse_end ON user_text_markup(verse_id_end)');
      db.execute('CREATE INDEX IF NOT EXISTS idx_markup_module ON user_text_markup(module_id)');
      db.execute('CREATE INDEX IF NOT EXISTS idx_markup_color ON user_text_markup(color)');
      db.execute('CREATE INDEX IF NOT EXISTS idx_markup_note ON user_text_markup(note_id)');

      // Preserve the original name before the value is rewritten, so the
      // conversion stays reversible. Rows whose metadata is not a JSON object
      // are skipped - rewriting an opaque blob would itself be data loss.
      db.execute(`
        UPDATE user_text_markup
        SET metadata = json_patch(COALESCE(metadata, '{}'), json_object('colorName', color))
        WHERE color IN ('yellow', 'green', 'blue', 'red', 'purple', 'orange')
          AND json_valid(COALESCE(metadata, '{}'))
          AND json_type(COALESCE(metadata, '{}')) = 'object'
      `);

      const colorsConverted = db.execute(
        `UPDATE user_text_markup
         SET color = CASE color
                       WHEN 'yellow' THEN ?
                       WHEN 'green'  THEN ?
                       WHEN 'blue'   THEN ?
                       WHEN 'red'    THEN ?
                       WHEN 'purple' THEN ?
                       WHEN 'orange' THEN ?
                       ELSE color
                     END
         WHERE color IN ('yellow', 'green', 'blue', 'red', 'purple', 'orange')`,
        [
          LEGACY_COLOR_HEX.yellow!,
          LEGACY_COLOR_HEX.green!,
          LEGACY_COLOR_HEX.blue!,
          LEGACY_COLOR_HEX.red!,
          LEGACY_COLOR_HEX.purple!,
          LEGACY_COLOR_HEX.orange!,
        ]
      ).changes;

      // Inside the transaction on purpose: a violation must roll the whole
      // rebuild back rather than leave a half-migrated table behind.
      const violations = db.queryAll('PRAGMA foreign_key_check');
      if (violations.length > 0) {
        throw new Error(
          `user_text_markup rebuild left ${violations.length} foreign key violation(s); rolled back`
        );
      }

      return {
        hadLegacyColorCheck,
        hadNullableVerseEnd,
        rebuilt: true,
        colorsConverted,
        verseEndsBackfilled,
      };
    });
  } finally {
    db.execute(`PRAGMA foreign_keys = ${foreignKeysWereOn ? 'ON' : 'OFF'}`);
  }
}

/**
 * Every user-database repair, in one call. Run after `initializeUserSchema`,
 * which guarantees the tables exist before their shape is inspected.
 */
export function repairUserSchema(db: ISql): UserSchemaRepairReport {
  return repairUserTextMarkup(db);
}
