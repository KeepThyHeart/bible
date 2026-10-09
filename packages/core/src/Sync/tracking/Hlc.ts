/** Hybrid logical clock (contracts 0063 §4; W1-C implements). */
import type { DeviceId, HlcString } from '../types';
import { notImplemented } from '../notImplemented';

export interface HlcClock {
  /** Local event at wall time `wallMs` (default Date.now()). Monotonic even if the wall clock goes back. */
  tick(wallMs?: number): HlcString;
  /** Merge a remote timestamp (on pull). Rejects remote HLCs more than `maxDriftMs` (default 24 h) ahead of wall time. */
  receive(remote: HlcString, wallMs?: number): HlcString;
  readonly last: HlcString;
}
export function createHlc(deviceId: DeviceId, last?: HlcString, maxDriftMs?: number): HlcClock {
  throw notImplemented(deviceId, last, maxDriftMs);
}
export function compareHlc(a: HlcString, b: HlcString): number {
  throw notImplemented(a, b);
}
export function parseHlc(s: HlcString): { ms: number; counter: number; deviceId: DeviceId } {
  throw notImplemented(s);
}
