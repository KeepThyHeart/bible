/** Builds the sync server (contracts 0063 §11; W1-F implements: store, auth, router). */
import type { SyncServer, SyncServerOptions } from './types';

export function createSyncServer(o: SyncServerOptions): SyncServer {
  void o;
  throw new Error('not implemented');
}
