/**
 * RPC envelope shared by the host (main process), each extension worker
 * (utilityProcess), and each UI iframe (`ext-ui://`).
 *
 * Spec A section "RPC envelope". The router on each side validates the envelope
 * shape, rejects malformed messages with an `RpcProtocolError`, and never
 * lets a malformed message reach business logic.
 *
 * All payloads MUST be JSON-serializable. No class instances, no functions,
 * no circular references - the same envelope travels over `MessageChannelMain`
 * (host <-> worker) and `postMessage` (renderer <-> iframe).
 */

export type RpcRequestId = string; // uuid

export interface RpcRequest {
  kind: 'request';
  id: RpcRequestId;
  /** Dotted method name, e.g. 'bible.getVerse'. */
  method: string;
  /** Positional arguments - JSON-serializable values only. */
  args: unknown[];
}

export interface RpcResponse {
  kind: 'response';
  id: RpcRequestId;
  /** Present on success. JSON-serializable. */
  result?: unknown;
  /** Present on failure. */
  error?: RpcErrorPayload;
}

export interface RpcErrorPayload {
  /** Stable error code, e.g. 'PermissionDeniedError'. See ExtensionApiTypes.ts. */
  code: string;
  message: string;
  /** Optional structured data attached to the error. */
  data?: unknown;
}

export interface RpcEvent {
  kind: 'event';
  /** Channel name the subscriber registered for, e.g. 'verse.activeChanged'. */
  channel: string;
  payload: unknown;
}

export interface RpcSubscribe {
  kind: 'subscribe';
  /** Reused as the unsubscribe handle. */
  id: RpcRequestId;
  channel: string;
}

export interface RpcUnsubscribe {
  kind: 'unsubscribe';
  id: RpcRequestId;
}

export interface RpcHeartbeat {
  kind: 'heartbeat';
  /** Epoch milliseconds the sender stamped. */
  ts: number;
}

export type RpcEnvelope =
  | RpcRequest
  | RpcResponse
  | RpcEvent
  | RpcSubscribe
  | RpcUnsubscribe
  | RpcHeartbeat;

/**
 * Type guard - narrow an unknown message off the channel into an `RpcEnvelope`.
 * The router uses this BEFORE touching any field. Anything that fails this
 * guard is dropped with an `RpcProtocolError`.
 */
export function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  switch (v.kind) {
    case 'request':
    case 'response':
    case 'event':
    case 'subscribe':
    case 'unsubscribe':
    case 'heartbeat':
      return true;
    default:
      return false;
  }
}
