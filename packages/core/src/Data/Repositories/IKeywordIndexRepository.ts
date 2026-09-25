/**
 * The durable record of one provider's keyword index for one module - the
 * `main.db` counterpart of `SidecarFts5Provider`'s own on-disk state machine
 * (task 0027 revision 2, F8; see that provider's file-level doc comment,
 * "What this provider does NOT do", for why the two are kept apart).
 *
 * Every field mirrors a `keyword_index` column one-to-one (see that table's
 * doc comment in `sql/schemas/initial/MainDatabase.sql`); `state` is
 * deliberately the open string `KeywordCapability['state']` uses minus
 * `'unavailable'` (which describes the environment, not a storable fact
 * about one module - see that same doc comment).
 */
export type KeywordIndexState = 'unbuilt' | 'building' | 'ready' | 'stale' | 'failed';

export interface KeywordIndexRecord {
  moduleUuid: string;
  providerId: string;
  /** The module revision this index was built FOR - the staleness key. */
  contentSha256: string;
  state: KeywordIndexState;
  tokenizer: string;
  /** Documents indexed. `null` until a build succeeds. */
  docCount: number | null;
  /** On-disk size of the artifact, snapshotted at build time. */
  sizeBytes: number | null;
  /** ISO-8601 UTC of the last successful build; `null` while unbuilt. */
  builtAt: string | null;
  /** Why the last build failed. Meaningful only with `state === 'failed'`. */
  error: string | null;
}

/**
 * Repository for the `main.db` `keyword_index` table.
 *
 * Keyed on `(moduleUuid, providerId)`, matching the table's own primary key -
 * two providers may each hold an index for the same module. Every write here
 * is driven by the install/rebuild/uninstall flow (F8), never by
 * `SidecarFts5Provider` itself, which never touches `main.db` on purpose.
 */
export interface IKeywordIndexRepository {
  /** One provider's record for one module, or `undefined` if it has never been built. */
  get(moduleUuid: string, providerId: string): KeywordIndexRecord | undefined;

  /**
   * Insert or overwrite the record for `(record.moduleUuid, record.providerId)`.
   * Every field is replaced wholesale - callers pass the record's full,
   * intended state, not a partial patch.
   */
  upsert(record: KeywordIndexRecord): void;

  /** Remove the record, if any. A no-op when none exists. */
  delete(moduleUuid: string, providerId: string): void;
}
