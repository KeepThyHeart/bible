/**
 * Shape checks for reading-plan data crossing a trust boundary (IPC, backups, stored JSON).
 * Each returns the value typed, or throws a ReadingPlanDataError naming the first problem.
 */
import type { BuilderSpec, Completion, Enrollment, PlanDefinition, Weekday } from './types';
import { isIsoDate } from './dates';
import { isValidVerseId } from './versification';
import { MAX_READINGS_PER_DAY } from './builder';

export class ReadingPlanDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadingPlanDataError';
  }
}

const MAX_DAYS = 3660;

function fail(msg: string): never {
  throw new ReadingPlanDataError(msg);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, path: string, max = 200): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) fail(`${path} must be a non-empty string (max ${max})`);
  return v;
}

function optStr(v: unknown, path: string, max = 2000): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || v.length > max) fail(`${path} must be a string (max ${max})`);
  return v;
}

export function validateWeekdays(v: unknown, path = 'readingDays'): Weekday[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 7) fail(`${path} must list 1-7 weekdays`);
  const out = new Set<Weekday>();
  for (const d of v) {
    if (!Number.isInteger(d) || d < 0 || d > 6) fail(`${path} has an invalid weekday`);
    out.add(d as Weekday);
  }
  return [...out].sort();
}

function range(v: unknown, path: string): { start: number; end: number } {
  if (!isObj(v) || !isValidVerseId(v.start as number) || !isValidVerseId(v.end as number) || (v.end as number) < (v.start as number)) {
    fail(`${path} must be a valid verse range`);
  }
  return { start: v.start as number, end: v.end as number };
}

export function validatePlanDefinition(raw: unknown): PlanDefinition {
  if (!isObj(raw)) fail('plan must be an object');
  const key = str(raw.key, 'key');
  if (!/^(stock|user|ext):/.test(key)) fail('key must start with stock:, user: or ext:');
  if (!Number.isInteger(raw.version) || (raw.version as number) < 0) fail('version must be a non-negative integer');
  const source = raw.source;
  if (source !== 'stock' && source !== 'user' && source !== 'extension') fail('source is invalid');
  if (!Array.isArray(raw.days) || raw.days.length === 0 || raw.days.length > MAX_DAYS) fail(`days must hold 1-${MAX_DAYS} days`);
  let tracks: PlanDefinition['tracks'];
  if (raw.tracks !== undefined) {
    if (!Array.isArray(raw.tracks) || raw.tracks.length > 8) fail('tracks must be an array (max 8)');
    tracks = raw.tracks.map((t, i) => {
      if (!isObj(t)) fail(`tracks[${i}] must be an object`);
      return { id: str(t.id, `tracks[${i}].id`, 40), name: str(t.name, `tracks[${i}].name`) };
    });
  }
  const trackIds = new Set(tracks?.map((t) => t.id));
  const days = raw.days.map((d, i) => {
    if (!isObj(d) || !Array.isArray(d.readings) || d.readings.length > MAX_READINGS_PER_DAY) fail(`days[${i}] is invalid`);
    return {
      readings: d.readings.map((r, j) => {
        const base = range(r, `days[${i}].readings[${j}]`);
        const track = (r as Record<string, unknown>).track;
        if (track === undefined) return base;
        if (typeof track !== 'string' || !trackIds.has(track)) fail(`days[${i}].readings[${j}].track is unknown`);
        return { ...base, track };
      }),
    };
  });
  const out: PlanDefinition = {
    key, version: raw.version as number, name: str(raw.name, 'name'), source, days,
  };
  const description = optStr(raw.description, 'description');
  if (description !== undefined) out.description = description;
  if (tracks) out.tracks = tracks;
  if (raw.spec !== undefined) out.spec = validateBuilderSpec(raw.spec);
  return out;
}

export function validateBuilderSpec(raw: unknown): BuilderSpec {
  if (!isObj(raw)) fail('spec must be an object');
  const order = raw.order;
  if (order !== 'as-listed' && order !== 'canonical' && order !== 'chronological') fail('spec.order is invalid');
  const split = raw.split;
  if (split !== 'chapter' && split !== 'verse') fail('spec.split is invalid');
  if (!Array.isArray(raw.scope) || raw.scope.length > 2000) fail('spec.scope must be an array');
  const pace = raw.pace;
  if (!isObj(pace)) fail('spec.pace is invalid');
  let p: BuilderSpec['pace'];
  switch (pace.by) {
    case 'days':
      if (!Number.isInteger(pace.days) || (pace.days as number) < 1 || (pace.days as number) > MAX_DAYS) fail('spec.pace.days is invalid');
      p = { by: 'days', days: pace.days as number };
      break;
    case 'endDate':
      if (!isIsoDate(pace.startDate) || !isIsoDate(pace.endDate)) fail('spec.pace dates are invalid');
      p = { by: 'endDate', startDate: pace.startDate as string, endDate: pace.endDate as string };
      break;
    case 'chaptersPerDay':
      if (!Number.isInteger(pace.chapters) || (pace.chapters as number) < 1 || (pace.chapters as number) > 1189) fail('spec.pace.chapters is invalid');
      p = { by: 'chaptersPerDay', chapters: pace.chapters as number };
      break;
    case 'versesPerDay':
      if (!Number.isInteger(pace.verses) || (pace.verses as number) < 1 || (pace.verses as number) > 31102) fail('spec.pace.verses is invalid');
      p = { by: 'versesPerDay', verses: pace.verses as number };
      break;
    default:
      fail('spec.pace.by is invalid');
  }
  const out: BuilderSpec = {
    name: str(raw.name, 'spec.name'),
    scope: raw.scope.map((r, i) => range(r, `spec.scope[${i}]`)),
    order, pace: p, split,
  };
  const description = optStr(raw.description, 'spec.description');
  if (description !== undefined) out.description = description;
  if (raw.readingDays !== undefined) out.readingDays = validateWeekdays(raw.readingDays, 'spec.readingDays');
  if (raw.tracks !== undefined) {
    if (!Array.isArray(raw.tracks) || raw.tracks.length > 8) fail('spec.tracks must be an array (max 8)');
    out.tracks = raw.tracks.map((t, i) => {
      if (!isObj(t) || !Array.isArray(t.scope)) fail(`spec.tracks[${i}] is invalid`);
      return { id: str(t.id, `spec.tracks[${i}].id`, 40), name: str(t.name, `spec.tracks[${i}].name`), scope: t.scope.map((r, j) => range(r, `spec.tracks[${i}].scope[${j}]`)) };
    });
  }
  return out;
}

export function validateEnrollment(raw: unknown): Enrollment {
  if (!isObj(raw)) fail('enrollment must be an object');
  if (raw.pacing !== 'flexible' && raw.pacing !== 'fixed') fail('pacing is invalid');
  if (raw.status !== 'active' && raw.status !== 'paused' && raw.status !== 'completed') fail('status is invalid');
  if (!isIsoDate(raw.startDate)) fail('startDate is invalid');
  if (!Number.isInteger(raw.planVersion)) fail('planVersion is invalid');
  const out: Enrollment = {
    id: str(raw.id, 'id', 80),
    planKey: str(raw.planKey, 'planKey'),
    planVersion: raw.planVersion as number,
    planName: str(raw.planName, 'planName'),
    startDate: raw.startDate as string,
    pacing: raw.pacing,
    readingDays: validateWeekdays(raw.readingDays),
    status: raw.status,
    createdAt: str(raw.createdAt, 'createdAt', 40),
  };
  const completedAt = optStr(raw.completedAt, 'completedAt', 40);
  if (completedAt !== undefined) out.completedAt = completedAt;
  if (raw.reminder !== undefined) {
    if (raw.reminder === null) out.reminder = null;
    else if (isObj(raw.reminder) && typeof raw.reminder.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.reminder.time)) {
      out.reminder = { time: raw.reminder.time };
    } else fail('reminder is invalid');
  }
  return out;
}

export function validateCompletion(raw: unknown): Completion {
  if (!isObj(raw)) fail('completion must be an object');
  if (!Number.isInteger(raw.day) || (raw.day as number) < 1 || (raw.day as number) > MAX_DAYS) fail('day is invalid');
  if (!Number.isInteger(raw.reading) || (raw.reading as number) < 0 || (raw.reading as number) >= MAX_READINGS_PER_DAY) fail('reading is invalid');
  const via = raw.via;
  if (via !== 'manual' && via !== 'reader' && via !== 'audio') fail('via is invalid');
  return {
    enrollmentId: str(raw.enrollmentId, 'enrollmentId', 80),
    day: raw.day as number,
    reading: raw.reading as number,
    at: str(raw.at, 'at', 40),
    via,
  };
}
