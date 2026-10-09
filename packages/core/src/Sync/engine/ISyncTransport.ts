/** Transport contract and HTTP error (contracts 0063 §8; W3-A implements the HTTP side in SyncApiClient). */
import type { EncryptedRecord, RecordId } from '../types';
import type { ApiError, PushRecord } from '../api';

export interface ISyncTransport {
  pull(since: number, limit: number, signal?: AbortSignal): Promise<{ records: EncryptedRecord[]; next: number; more: boolean }>;
  push(records: PushRecord[], signal?: AbortSignal): Promise<{ accepted: Array<{ id: RecordId; seq: number }>; conflicts: Array<{ id: RecordId; current: EncryptedRecord }> }>;
}

export class SyncHttpError extends Error {
  constructor(readonly status: number, readonly body: ApiError | null) {
    super(body?.message ?? body?.error ?? `HTTP ${status}`);
    this.name = 'SyncHttpError';
  }
}

export interface HttpClientOptions {
  /** Origin; SYNC_API_PREFIX is appended. */
  baseUrl: string;
  auth: { kind: 'cookie' } | { kind: 'bearer'; token: () => Promise<string | null> };
  fetch?: typeof fetch; onUnauthorized?: () => void;
}
