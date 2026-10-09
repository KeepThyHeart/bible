/**
 * Record codecs: user-DB rows <-> RecordPlaintext.d (contracts 0063 §5; task 0150 W2-A).
 * Browser-safe: pure `ISql`, no globals touched at module load.
 *
 * Shape of `d` for a core table (codec version 1): the registry column names as keys, in the table's own
 * spelling. Left out: autoincrement ids (local only), columns listed as local-only in `tableCodec.ts`
 * (`user_commentary.is_default`). Translated: every foreign key becomes the parent's RecordId (including the
 * polymorphic `verse_link.source_id` and `pinned_item.reference_id`, which depend on a type column), and the
 * local module install ids of `user_text_markup.module_id` / `pinned_item.module_id` become portable module
 * refs (`memory_passage.module_id` is already portable and passes through). `extension_storage` is kind
 * `ext.kv` with the contracts §10 shape `{ ext, key, value, updatedAt }`.
 *
 * Record-id scopes (`naturalKey().scope`; `key` parts are joined with U+001F; foreign keys inside a key are
 * the parent's RecordId so the key is stable across devices). Everything else gets a random id.
 *
 *   ext.kv                 ext + U+001F + key                                      (contracts §10)
 *   user_reading_progress  plan_id + U+001F + start_date                           (contracts §10 / design)
 *   user_data_item         owner_uuid + U+001F + collection + U+001F + item_key    (UNIQUE in the DDL)
 *   memory_setting         key                                                     (primary key)
 *   memory_resume_state    card_id                                                 (primary key, 1:1 with a card)
 *   memory_recite_detail   attempt_id                                              (primary key, 1:1 with an attempt)
 *   memory_passage         collection_id U+001F module_id U+001F start_verse_id U+001F end_verse_id (unique index)
 *   memory_card            passage_id U+001F rung                                  (unique index)
 *   reading_plan_day       plan_id U+001F day_number                               (UNIQUE in the DDL)
 *
 * Unknown module on encode: the row is NOT dropped. The value `local:<id>` (never resolvable on another
 * device) is written and the codec calls `ctx.report` with an `unknownModule` note. On decode, a portable
 * module that `ctx.modules.toLocal` cannot resolve gives `{ ok: false, missing: [], unknownModules: [...] }`:
 * the engine keeps the record pending (not lost) and retries it when a module is installed.
 *
 * Malformed records (a column value that is not a string, number or null; a foreign key that is not a record
 * id) make `decode` throw `RecordDecodeError`. Its message never contains record content; the engine keeps
 * such a record opaque.
 */
import type { ISql } from '../../Data/Core/ISql';
import type { Row } from '../../Backup/Registry';
import type { RecordId, RecordType } from '../types';
import type { ChangeTracker } from '../tracking/ChangeTracker';
import { coreTrackedTables } from '../tracking/ChangeTracker';
import { tableSpec } from '../../Backup/Registry';
import { createTableCodec } from './tableCodec';
import { createExtKvCodec } from './extKv';
import { RecordDecodeError } from './errors';

export interface ModuleRefResolver {
  /** Local module install id -> portable ref (module uuid, else abbreviation). null = unknown module. */
  toPortable(localModuleId: number | string): string | null;
  toLocal(portable: string): number | string | null;
}

/** Something the engine may want to surface: an encode that had to keep a value it could not make portable. */
export interface CodecNote {
  kind: string;
  localKey: string;
  code: 'unknownModule';
  column: string;
  /** The local value that could not be resolved (a local module install id). */
  value: string | number;
}

export interface CodecContext {
  sql: ISql;
  tracker: ChangeTracker;
  modules: ModuleRefResolver;
  /** Resolve a parent's local key to its record id, assigning a random one if it has none yet. */
  recordIdFor(kind: string, localKey: string): RecordId;
  /** Resolve a record id to a local key; undefined when the parent has not arrived yet. */
  localKeyFor(recordId: RecordId): string | undefined;
  /** Optional sink for `CodecNote`s raised during `encode`. */
  report?(note: CodecNote): void;
}

export type DecodeResult =
  | { ok: true; row: Row }                  // ready to upsert
  | {
      ok: false;                             // park in sync_pending until the parents arrive
      missing: RecordId[];
      /** Portable module refs this device cannot resolve yet; retry when a module is installed. */
      unknownModules?: string[];
    };

export interface RecordCodec {
  type: RecordType | string;
  kind: string;                              // sync_record.table_name it tracks
  version: number;                           // RecordPlaintext.cv written
  /** Null when this row must not sync (e.g. registry skipInMerge rows, a dangling parent). */
  encode(localKey: string, ctx: CodecContext): Record<string, unknown> | null;
  decode(d: Record<string, unknown>, ctx: CodecContext): DecodeResult;
  /** Write a decoded row; returns the local key. Insert when localKey is undefined. */
  upsert(row: Row, localKey: string | undefined, ctx: CodecContext): string;
  remove(localKey: string, ctx: CodecContext): void;
  /** Natural-key records get a derived id; others random. */
  naturalKey?(d: Record<string, unknown>): { scope: string; key: string } | null;
}

export interface CodecRegistry {
  byType(t: string): RecordCodec | undefined;
  byKind(kind: string): RecordCodec | undefined;
  all(): RecordCodec[];
}

export { RecordDecodeError };

/** One per synced registry table, generic over TableSpec. */
export function createCoreCodecs(): RecordCodec[] {
  return coreTrackedTables().map((t) => {
    if (t.kind === 'ext.kv') return createExtKvCodec();
    const spec = tableSpec(t.table);
    if (!spec) throw new Error(`No registry spec for tracked table ${t.table}`);
    return createTableCodec(spec);
  });
}

export function createCodecRegistry(codecs: RecordCodec[]): CodecRegistry {
  const list = [...codecs];
  const types = new Map<string, RecordCodec>();
  const kinds = new Map<string, RecordCodec>();
  for (const c of list) {
    if (types.has(c.type)) throw new Error(`Duplicate codec for type ${c.type}`);
    if (kinds.has(c.kind)) throw new Error(`Duplicate codec for kind ${c.kind}`);
    types.set(c.type, c);
    kinds.set(c.kind, c);
  }
  return {
    byType: (t) => types.get(t),
    byKind: (kind) => kinds.get(kind),
    all: () => [...list],
  };
}
