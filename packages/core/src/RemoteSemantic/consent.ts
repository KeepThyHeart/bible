/**
 * First-use consent for the online meaning search (task 0190).
 *
 * The consent record is shared by web (localStorage) and desktop (settings
 * store). `version` is the notice version the user saw: bump
 * `REMOTE_SEMANTIC_NOTICE_VERSION` whenever the notice text changes in a way
 * that matters and everyone is asked again.
 *
 * States:
 *  - no record / outdated version: `unset`, the user has not been asked.
 *  - `granted`: Agree was pressed; remote calls are allowed.
 *  - `declined`: Not now, or consent withdrawn in settings. Not asked again
 *    until the user re-enables the option in settings (which clears the record).
 */

export const REMOTE_SEMANTIC_NOTICE_VERSION = 1;

export type ConsentDecision = 'granted' | 'declined';
export type ConsentStatus = ConsentDecision | 'unset';

export interface ConsentRecord {
  version: number;
  decision: ConsentDecision;
  /** ISO timestamp of the decision. */
  at: string;
}

export function makeConsentRecord(
  decision: ConsentDecision,
  now: Date = new Date(),
  version: number = REMOTE_SEMANTIC_NOTICE_VERSION,
): ConsentRecord {
  return { version, decision, at: now.toISOString() };
}

/** Tolerant parse of a stored value (object or JSON string); null when unusable. */
export function parseConsentRecord(value: unknown): ConsentRecord | null {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<ConsentRecord>;
  if (r.decision !== 'granted' && r.decision !== 'declined') return null;
  if (typeof r.version !== 'number' || !Number.isFinite(r.version)) return null;
  return { version: r.version, decision: r.decision, at: typeof r.at === 'string' ? r.at : '' };
}

export function consentStatus(
  record: ConsentRecord | null | undefined,
  currentVersion: number = REMOTE_SEMANTIC_NOTICE_VERSION,
): ConsentStatus {
  if (!record || record.version !== currentVersion) return 'unset';
  return record.decision;
}
