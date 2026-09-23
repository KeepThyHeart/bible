import { ISql } from '../Core/ISql';
import { KeywordIndexRow } from '../Core/RowTypes';
import { IKeywordIndexRepository, KeywordIndexRecord, KeywordIndexState } from './IKeywordIndexRepository';

/**
 * Repository for the `main.db` `keyword_index` table (task 0027 revision 2,
 * F8). See {@link IKeywordIndexRepository}'s doc comment for what this table
 * is for and how it relates to `SidecarFts5Provider`'s own on-disk state.
 */
export class KeywordIndexRepository implements IKeywordIndexRepository {
  constructor(private sql: ISql) {}

  get(moduleUuid: string, providerId: string): KeywordIndexRecord | undefined {
    const row = this.sql.queryOne<KeywordIndexRow>(
      'SELECT * FROM keyword_index WHERE module_uuid = ? AND provider_id = ?',
      [moduleUuid, providerId]
    );
    return row ? mapRowToRecord(row) : undefined;
  }

  /**
   * `ON CONFLICT ... DO UPDATE` rather than `INSERT OR REPLACE`: the table has
   * no surrogate id for a replace to churn, but the same reasoning
   * `UserDataRepository.put()` documents still applies in spirit - an
   * `UPDATE` is the honest description of what a rebuild does to an existing
   * record, and there is no reason to make SQLite delete-then-reinsert the row
   * when every write here already carries the record's full intended state.
   */
  upsert(record: KeywordIndexRecord): void {
    this.sql.execute(
      `INSERT INTO keyword_index (
         module_uuid, provider_id, content_sha256, state, tokenizer, doc_count, size_bytes, built_at, error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(module_uuid, provider_id) DO UPDATE SET
         content_sha256 = excluded.content_sha256,
         state          = excluded.state,
         tokenizer      = excluded.tokenizer,
         doc_count      = excluded.doc_count,
         size_bytes     = excluded.size_bytes,
         built_at       = excluded.built_at,
         error          = excluded.error`,
      [
        record.moduleUuid,
        record.providerId,
        record.contentSha256,
        record.state,
        record.tokenizer,
        record.docCount,
        record.sizeBytes,
        record.builtAt,
        record.error,
      ]
    );
  }

  delete(moduleUuid: string, providerId: string): void {
    this.sql.execute('DELETE FROM keyword_index WHERE module_uuid = ? AND provider_id = ?', [moduleUuid, providerId]);
  }
}

function mapRowToRecord(row: KeywordIndexRow): KeywordIndexRecord {
  return {
    moduleUuid: row.module_uuid,
    providerId: row.provider_id,
    contentSha256: row.content_sha256,
    state: row.state as KeywordIndexState,
    tokenizer: row.tokenizer,
    docCount: row.doc_count ?? null,
    sizeBytes: row.size_bytes ?? null,
    builtAt: row.built_at ?? null,
    error: row.error ?? null,
  };
}
