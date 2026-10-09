/** Transport contract and HTTP error (contracts 0063 §8; W3-A implements the HTTP side in SyncApiClient). */
import type { EncryptedRecord, RecordId } from '../types';
import type { ApiError, PushRecord } from '../api';

export interface ISyncTransport {
  pull(since: number, limit: number, signal?: AbortSignal): Promise<{ records: EncryptedRecord[]; next: number; more: boolean }>;
  push(records: PushRecord[], signal?: AbortSignal): Promise<{ accepted: Array<{ id: RecordId; seq: number }>; conflicts: Array<{ id: RecordId; current: EncryptedRecord }> }>;
}

/**
 * A non-2xx answer. `body` is the server's `ApiError` when the body was one (parsed defensively), else null. The
 * message comes from the server's error body, never from the request.
 */
export class SyncHttpError extends Error {
  constructor(readonly status: number, readonly body: ApiError | null) {
    super(body?.message ?? body?.error ?? `HTTP ${status}`);
    this.name = 'SyncHttpError';
  }
}

/** The request never got an HTTP answer (offline, DNS, TLS, CORS). The engine maps it to status 'offline'. */
export class SyncNetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'SyncNetworkError';
  }
}

/** A 2xx answer whose body does not have the documented shape; it is rejected instead of reaching the engine. */
export class SyncResponseError extends Error {
  constructor(message = 'Malformed server response') {
    super(message);
    this.name = 'SyncResponseError';
  }
}

export interface HttpClientOptions {
  /** Origin; SYNC_API_PREFIX is appended. */
  baseUrl: string;
  auth: { kind: 'cookie' } | { kind: 'bearer'; token: () => Promise<string | null> };
  fetch?: typeof fetch; onUnauthorized?: () => void;
}
