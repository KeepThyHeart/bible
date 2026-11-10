/**
 * Send-then-queue timing for Give Feedback / Report an Issue.
 *
 * By the time this runs the report is already durably queued on disk (the
 * submit IPC wrote it), so nothing here can lose it. What this decides is only
 * what the user is told:
 *
 *  - Delivery usually finishes in well under a second. If it settles before
 *    the deadline, the dialog reports the real outcome ("Sent", or why it is
 *    still queued) - no "Did it send?" moment.
 *  - If it is still going at the deadline, the dialog stops waiting and says
 *    the report will finish in the background. The delivery promise is handed
 *    back as `later` so a dialog that is still open can update itself when it
 *    does settle; the main process carries on regardless.
 */

/** How long the dialog waits for a delivery before saying "in the background". */
export const DELIVERY_DEADLINE_MS = 3000;

/** Mirrors `DeliveryQueuedReason` in electron/services/DiagnosticsUploader.ts. */
export type DeliveryQueuedReason =
  | 'web-requests-off'
  | 'no-connection'
  | 'unreachable'
  | 'rate-limited'
  | 'no-endpoint'
  | 'not-eligible';

/** Mirrors `DeliveryResult` in electron/services/DiagnosticsUploader.ts. */
export type DeliveryResult =
  | { status: 'sent' }
  | { status: 'queued'; reason: DeliveryQueuedReason }
  | { status: 'rejected' };

export type DeadlineOutcome =
  | { kind: 'settled'; result: DeliveryResult }
  | { kind: 'late'; later: Promise<DeliveryResult> };

const QUEUED_REASONS: readonly DeliveryQueuedReason[] = [
  'web-requests-off',
  'no-connection',
  'unreachable',
  'rate-limited',
  'no-endpoint',
  'not-eligible',
];

/**
 * Read a `diagnostics:deliver-report` envelope (`{ ok, value }`) into a
 * `DeliveryResult`. Anything unrecognised - an IPC error, a thrown call, a
 * shape from a different version - reads as "still queued, unreachable": the
 * report IS on disk, so that is the claim that cannot be wrong. It is never
 * read as "sent".
 */
export function parseDeliveryEnvelope(raw: unknown): DeliveryResult {
  const fallback: DeliveryResult = { status: 'queued', reason: 'unreachable' };
  if (!raw || typeof raw !== 'object' || (raw as { ok?: unknown }).ok !== true) return fallback;
  const value = (raw as { value?: unknown }).value;
  if (!value || typeof value !== 'object') return fallback;
  const status = (value as { status?: unknown }).status;
  if (status === 'sent') return { status: 'sent' };
  if (status === 'rejected') return { status: 'rejected' };
  if (status === 'queued') {
    const reason = (value as { reason?: unknown }).reason;
    if (typeof reason === 'string' && (QUEUED_REASONS as readonly string[]).includes(reason)) {
      return { status: 'queued', reason: reason as DeliveryQueuedReason };
    }
  }
  return fallback;
}

/**
 * Race a delivery attempt against the deadline.
 *
 * `deliver` is called immediately. A rejection from it is folded into the
 * queued fallback (see {@link parseDeliveryEnvelope}), so the returned promise
 * never rejects and `later` never rejects either.
 */
export function deliverWithDeadline(
  deliver: () => Promise<unknown>,
  deadlineMs: number = DELIVERY_DEADLINE_MS,
): Promise<DeadlineOutcome> {
  let attempt: Promise<DeliveryResult>;
  try {
    attempt = Promise.resolve(deliver()).then(parseDeliveryEnvelope, () => parseDeliveryEnvelope(null));
  } catch {
    attempt = Promise.resolve(parseDeliveryEnvelope(null));
  }

  return new Promise<DeadlineOutcome>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ kind: 'late', later: attempt });
    }, deadlineMs);
    void attempt.then((result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ kind: 'settled', result });
    });
  });
}
