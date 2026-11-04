/**
 * Hybrid logical clock (contracts 0063 §4).
 *
 * Format `${ms 12 hex}:${counter 4 hex}:${deviceId 16 hex}`, all lowercase and fixed width, so plain string
 * comparison is the causal order (ties broken by device id). Browser-safe and side-effect free: the wall
 * clock is read only when `tick`/`receive` are called without `wallMs`.
 */
import type { DeviceId, HlcString } from '../types';

export interface HlcClock {
  /** Local event at wall time `wallMs` (default Date.now()). Monotonic even if the wall clock goes back. */
  tick(wallMs?: number): HlcString;
  /** Merge a remote timestamp (on pull). Rejects remote HLCs more than `maxDriftMs` (default 24 h) ahead of wall time. */
  receive(remote: HlcString, wallMs?: number): HlcString;
  readonly last: HlcString;
}

const DEFAULT_MAX_DRIFT_MS = 24 * 60 * 60 * 1000;
const MAX_MS = 0xffffffffffff; // 12 hex digits
const MAX_COUNTER = 0xffff; // 4 hex digits
const HLC_RE = /^([0-9a-f]{12}):([0-9a-f]{4}):([0-9a-f]{16})$/;
const DEVICE_RE = /^[0-9a-f]{16}$/;

function formatHlc(ms: number, counter: number, deviceId: DeviceId): HlcString {
  return `${ms.toString(16).padStart(12, '0')}:${counter.toString(16).padStart(4, '0')}:${deviceId}`;
}

function checkWall(wallMs: number): number {
  if (!Number.isFinite(wallMs) || wallMs < 0) throw new Error(`HLC: invalid wall time ${wallMs}`);
  return Math.floor(wallMs);
}

export function createHlc(deviceId: DeviceId, last?: HlcString, maxDriftMs: number = DEFAULT_MAX_DRIFT_MS): HlcClock {
  if (!DEVICE_RE.test(deviceId)) throw new Error(`HLC: device id must be 16 lowercase hex chars, got "${deviceId}"`);
  let ms = 0;
  let counter = 0;
  if (last !== undefined) {
    const p = parseHlc(last);
    ms = p.ms;
    counter = p.counter;
  }

  /** Commit (nextMs, nextCounter), carrying a counter overflow into the millisecond field. */
  const commit = (nextMs: number, nextCounter: number): HlcString => {
    if (nextCounter > MAX_COUNTER) {
      nextMs += 1;
      nextCounter = 0;
    }
    if (nextMs > MAX_MS) throw new Error('HLC: timestamp out of range');
    ms = nextMs;
    counter = nextCounter;
    return formatHlc(ms, counter, deviceId);
  };

  return {
    tick(wallMs?: number): HlcString {
      const wall = checkWall(wallMs ?? Date.now());
      if (wall > ms) return commit(wall, 0);
      return commit(ms, counter + 1);
    },
    receive(remote: HlcString, wallMs?: number): HlcString {
      const wall = checkWall(wallMs ?? Date.now());
      const r = parseHlc(remote);
      if (r.ms - wall > maxDriftMs) {
        throw new Error(`HLC: remote clock ${remote} is more than ${maxDriftMs} ms ahead of local time`);
      }
      const next = Math.max(ms, r.ms, wall);
      let nextCounter: number;
      if (next === ms && next === r.ms) nextCounter = Math.max(counter, r.counter) + 1;
      else if (next === ms) nextCounter = counter + 1;
      else if (next === r.ms) nextCounter = r.counter + 1;
      else nextCounter = 0;
      return commit(next, nextCounter);
    },
    get last(): HlcString {
      return formatHlc(ms, counter, deviceId);
    },
  };
}

/** Total order of two HLC strings: negative, zero or positive. Equivalent to comparing the parsed fields. */
export function compareHlc(a: HlcString, b: HlcString): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function parseHlc(s: HlcString): { ms: number; counter: number; deviceId: DeviceId } {
  const m = HLC_RE.exec(s);
  if (!m) throw new Error(`HLC: malformed timestamp "${s}"`);
  return { ms: parseInt(m[1], 16), counter: parseInt(m[2], 16), deviceId: m[3] };
}
