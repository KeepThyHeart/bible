/** Sync engine (contracts 0063 §8; W3-A implements). */
import type { ISql } from '../../Data/Core/ISql';
import type { ChangeTracker } from '../tracking/ChangeTracker';
import type { HlcClock } from '../tracking/Hlc';
import type { CodecRegistry, ModuleRefResolver, RecordCodec } from '../codecs/RecordCodec';
import type { RecordCipher } from '../crypto/RecordCipher';
import type { UnlockedAccount } from '../crypto/keys';
import type { ISyncTransport } from './ISyncTransport';
import type { SyncStatusStore } from './SyncStatus';
import { notImplemented } from '../notImplemented';

export interface SyncEngineOptions {
  sql: ISql; tracker: ChangeTracker; codecs: CodecRegistry; cipher: RecordCipher; transport: ISyncTransport;
  unlocked: UnlockedAccount; hlc: HlcClock; status: SyncStatusStore; modules: ModuleRefResolver;
  /** Extra sources that are not rows of `sql` (desktop .bn files, extension DBs). */
  adapters?: SyncAdapter[];
  now?: () => number; pageSize?: number;           // default 500
}
export interface SyncAdapter {
  kind: string;                                    // e.g. 'bn.file', 'ext.db:<ext>/<db>/<table>'
  codec: RecordCodec;
  /** Called before each push to let the adapter mark its own dirty rows (e.g. scan .bn mtimes). */
  collect?(): Promise<void>;
  /** Called after applyRemote committed, outside the SQL transaction (file writes, extension events). */
  afterApply?(changed: Array<{ kind: string; localKey: string; deleted: boolean }>): Promise<void>;
}
export interface SyncResult { pulled: number; pushed: number; conflicts: number; conflictCopies: number; opaque: number }
export class SyncEngine {
  constructor(o: SyncEngineOptions) {
    throw notImplemented(o);
  }
  /** pull -> merge -> push; retries conflicts up to 3 times; single-flight (concurrent calls share one run). */
  syncNow(signal?: AbortSignal): Promise<SyncResult> {
    throw notImplemented(signal);
  }
  /** Called after a local edit; debounced 5 s. */
  notifyLocalChange(): void {
    throw notImplemented();
  }
  /** Start/stop the 5 min timer + online/visibility hooks supplied by the host. */
  start(scheduler: SyncScheduler): void {
    throw notImplemented(scheduler);
  }
  stop(): void {
    throw notImplemented();
  }
}
export interface SyncScheduler { every(ms: number, fn: () => void): () => void; onOnline(fn: () => void): () => void }
