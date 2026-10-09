/** Merge policies (contracts 0063 §6; W2-B implements). */
import type { HlcString } from '../types';
import { notImplemented } from '../notImplemented';

export interface Version { d: Record<string, unknown>; h: HlcString; deleted: boolean }

export type MergeOutcome =
  | { kind: 'takeRemote' }                               // overwrite local, clear dirty
  | { kind: 'keepLocal' }                                // push local with the remote seq as base
  | { kind: 'merged'; d: Record<string, unknown> }       // write merged locally AND push it
  | { kind: 'conflictCopy'; winner: 'local' | 'remote'; copy: Record<string, unknown> }; // loser saved as a new linked record

export interface MergePolicy {
  /** Pure and deterministic: same inputs -> same outcome on every device. `base` = last common synced version. */
  merge(local: Version, remote: Version, base: Version | null): MergeOutcome;
}

/** Higher HLC wins; delete beats an OLDER edit only. */
export const lwwPolicy: MergePolicy = {
  merge(local: Version, remote: Version, base: Version | null): MergeOutcome {
    throw notImplemented(local, remote, base);
  },
};
/** Notes, prayer, journal. */
export function fieldLwwWithBodyCopy(bodyFields: string[], linkField: string): MergePolicy {
  throw notImplemented(bodyFields, linkField);
}
/** Table in design "Merge rules per data type". */
export function policyFor(type: string): MergePolicy {
  throw notImplemented(type);
}
/** Fractional index for collection/pinned ordering: keyBetween(a, b) with a < result < b, deviceId tiebreak. */
export function keyBetween(a: string | null, b: string | null, deviceId?: string): string {
  throw notImplemented(a, b, deviceId);
}
