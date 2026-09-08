/**
 * Verse Indexing Utilities
 * Helper functions for indexing verse references in user content
 */

import { VerseReferenceIndexingService, ISql } from '@bible/core';
import log from 'electron-log/main';

/**
 * Content type for verse links
 */
export type ContentType = 'note' | 'journal' | 'prayer' | 'document';

/**
 * Index verse references in content and store them in content_verse_link table
 * Automatically detects Bible verse references and creates links
 */
export async function indexContentVerseReferences(
  db: ISql,
  contentType: ContentType,
  contentId: number,
  content: string,
  options?: {
    currentBook?: number;
    currentChapter?: number;
  }
): Promise<void> {
  try {
    const indexingService = new VerseReferenceIndexingService();

    // Extract verse references from content
    const references = indexingService.extractVerseReferences(content, {
      includeContext: true,
      currentBook: options?.currentBook,
      currentChapter: options?.currentChapter
    });

    log.debug(`Found ${references.length} verse references in ${contentType} ${contentId}`);

    // Clear old links for this content
    db.execute(
      `DELETE FROM content_verse_link WHERE content_type = ? AND content_id = ?`,
      [contentType, contentId]
    );

    // Insert new links
    for (const ref of references) {
      const metadata = ref.context
        ? JSON.stringify({ context: ref.context })
        : null;

      db.execute(
        `INSERT INTO content_verse_link
         (content_type, content_id, verse_id_start, verse_id_end, link_type, position, metadata)
         VALUES (?, ?, ?, ?, 'reference', ?, ?)`,
        [
          contentType,
          contentId,
          ref.verseIdStart,
          ref.verseIdEnd ?? null,
          ref.position,
          metadata
        ]
      );
    }

    log.info(`Indexed ${references.length} verse references for ${contentType} ${contentId}`);
  } catch (error) {
    log.error(`Error indexing verse references for ${contentType} ${contentId}:`, error);
    throw error;
  }
}

/**
 * Migrate existing note_verse_link data to content_verse_link
 * This is for backward compatibility with the old schema
 */
export function migrateNoteVerseLinks(db: ISql): void {
  try {
    // Check if old table exists
    const oldTableExists = db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM sqlite_master
       WHERE type='table' AND name='note_verse_link'`
    );

    if (!oldTableExists || oldTableExists.count === 0) {
      return;
    }

    log.info('Migrating note_verse_link to content_verse_link...');

    // Check if new table exists
    const newTableExists = db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM sqlite_master
       WHERE type='table' AND name='content_verse_link'`
    );

    if (!newTableExists || newTableExists.count === 0) {
      log.error('content_verse_link table does not exist, cannot migrate');
      return;
    }

    // Migrate data
    db.execute(`
      INSERT INTO content_verse_link (content_type, content_id, verse_id_start, verse_id_end, link_type, metadata)
      SELECT 'note', note_id, verse_id_start, verse_id_end, link_type, metadata
      FROM note_verse_link
      WHERE NOT EXISTS (
        SELECT 1 FROM content_verse_link
        WHERE content_type = 'note' AND content_id = note_verse_link.note_id
      )
    `);

    const migratedCount = db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM note_verse_link`
    );

    log.info(`Migrated ${migratedCount?.count || 0} records from note_verse_link to content_verse_link`);
  } catch (error) {
    log.error('Error migrating note_verse_link:', error);
  }
}

/**
 * Ensure content_verse_link table exists in user database
 */
export function ensureContentVerseLinkTable(db: ISql): void {
  try {
    // Check if table exists
    const tableExists = db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM sqlite_master
       WHERE type='table' AND name='content_verse_link'`
    );

    if (tableExists && tableExists.count > 0) {
      return; // Table already exists
    }

    log.info('Creating content_verse_link table...');

    // Create table
    db.execute(`
      CREATE TABLE IF NOT EXISTS content_verse_link (
        link_id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_type TEXT NOT NULL,
        content_id INTEGER NOT NULL,
        verse_id_start INTEGER NOT NULL,
        verse_id_end INTEGER,
        link_type TEXT DEFAULT 'reference',
        position INTEGER,
        metadata TEXT,
        CHECK (content_type IN ('note', 'journal', 'prayer', 'document'))
      )
    `);

    // Create indexes
    db.execute(`CREATE INDEX IF NOT EXISTS idx_content_verse_link_verse_start
                ON content_verse_link(verse_id_start)`);
    db.execute(`CREATE INDEX IF NOT EXISTS idx_content_verse_link_verse_end
                ON content_verse_link(verse_id_end)`);
    db.execute(`CREATE INDEX IF NOT EXISTS idx_content_verse_link_content
                ON content_verse_link(content_type, content_id)`);

    log.info('content_verse_link table created successfully');
  } catch (error) {
    log.error('Error creating content_verse_link table:', error);
    throw error;
  }
}
