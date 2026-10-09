/** Record codecs: user-DB rows <-> RecordPlaintext.d (contracts 0063 §5; W2-A implements). */
import type { ISql } from '../../Data/Core/ISql';
import type { Row } from '../../Backup/Registry';
import type { RecordId, RecordType } from '../types';
import type { ChangeTracker } from '../tracking/ChangeTracker';
import { notImplemented } from '../notImplemented';

export interface ModuleRefResolver {
  /** Local module install id -> portable ref (module uuid, else abbreviation). null = unknown module. */
  toPortable(localModuleId: number | string): string | null;
  toLocal(portable: string): number | string | null;
}

export interface CodecContext {
  sql: ISql;
  tracker: ChangeTracker;
  modules: ModuleRefResolver;
  /** Resolve a parent's local key to its record id, assigning a random one if it has none yet. */
  recordIdFor(kind: string, localKey: string): RecordId;
  /** Resolve a record id to a local key; undefined when the parent has not arrived yet. */
  localKeyFor(recordId: RecordId): string | undefined;
}

export type DecodeResult =
  | { ok: true; row: Row }                  // ready to upsert
  | { ok: false; missing: RecordId[] };      // park in sync_pending until the parents arrive

export interface RecordCodec {
  type: RecordType | string;
  kind: string;                              // sync_record.table_name it tracks
  version: number;                           // RecordPlaintext.cv written
  /** Null when this row must not sync (e.g. registry skipInMerge rows, default commentary flag). */
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
/** One per synced registry table, generic over TableSpec. */
export function createCoreCodecs(): RecordCodec[] {
  throw notImplemented();
}
export function createCodecRegistry(codecs: RecordCodec[]): CodecRegistry {
  throw notImplemented(codecs);
}
