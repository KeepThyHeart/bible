import * as path from 'path';
import { loadSchemaSql } from '../../Data/Schema';
import { ISql } from '../../Data/Core/ISql';
import { TestSqliteProvider } from './TestSqliteProvider';

/**
 * Test helper for user database testing.
 * Creates an in-memory database with the full user_*.db schema from the SQL file.
 */
export class UserTestHelper {
  private static provider: TestSqliteProvider | null = null;

  static initialize(): void {
    this.provider = new TestSqliteProvider(':memory:');

    // Read and execute the user database schema using exec() which handles
    // multiple statements, comments, and trigger bodies with embedded semicolons.
    const schemaPath = path.resolve(__dirname, '../../../sql/schemas/initial/UserDatabase.sql');
    const schema = loadSchemaSql(schemaPath);

    // Strip PRAGMA statements (already set in constructor) and execute the rest
    const schemaWithoutPragmas = schema
      .split('\n')
      .map(line => line.match(/^\s*PRAGMA\s/i) ? `-- ${line}` : line)
      .join('\n');

    try {
      this.provider.exec(schemaWithoutPragmas);
    } catch (_e) {
      // FTS5 virtual tables or triggers may fail in some environments
    }

  }

  static getProvider(): ISql {
    if (!this.provider) {
      throw new Error('UserTestHelper not initialized. Call initialize() first.');
    }
    return this.provider;
  }

  static cleanup(): void {
    if (this.provider) {
      this.provider.close();
      this.provider = null;
    }
  }

  /**
   * Clear all user data tables (for test isolation between test cases).
   * Preserves schema but removes all rows.
   */
  static clearData(): void {
    const provider = this.getProvider();
    const tables = [
      'navigation_history',
      // The user database's copy is `user_search_history`;
      // `search_history` is main.db's table and never existed here after v2.
      'user_search_history',
      'verse_link',
      'note_verse_link',
      'user_text_markup',
      'user_cross_reference',
      'pinned_item',
      'collection',
      'user_note',
      'user_commentary',
      'session',
      'prayer_update',
      'prayer_item',
      'journal_verse_link',
      'journal_entry',
      'user_reading_progress',
      'reading_plan_passage',
      'reading_plan_day',
      'reading_plan',
      'layout_preset',
      'module_display_option',
      'user_data_item',
      'setting',
      'sync_metadata',
      'user_profile',
    ];

    for (const table of tables) {
      try {
        provider.execute(`DELETE FROM ${table}`);
      } catch (_e) {
        // Table may not exist if migration not applied
      }
    }
  }
}
