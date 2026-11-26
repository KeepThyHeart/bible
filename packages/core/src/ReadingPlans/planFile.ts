/**
 * Reading plan files (task 0222, R3-14): one user plan as a small JSON document, for sharing between installs.
 * Import goes through `ReadingPlanService.savePlan`, which validates every range, so a file never bypasses checks.
 */
import type { PlanDay, PlanDefinition, PlanTrack } from './types';
import type { SavePlanInput } from './service';
import { MAX_PLAN_DAYS } from './builder';
import { ReadingPlanDataError } from './validate';

export const PLAN_FILE_FORMAT = 'kth-reading-plan';

/** A plan file larger than this is refused before it is parsed (a full 3660-day plan is well under 1 MB). */
export const MAX_PLAN_FILE_BYTES = 2_000_000;

/** A safe download name for a plan: no path or reserved characters, bounded length, `.readingplan.json`. */
export function planFileName(name: string): string {
  const base = name
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  return `${base || 'reading-plan'}.readingplan.json`;
}

export interface PlanFileV1 {
  format: typeof PLAN_FILE_FORMAT;
  version: 1;
  name: string;
  description?: string;
  tracks?: PlanTrack[];
  days: PlanDay[];
}

/** The plan as a file body (2-space JSON; no key, source, spec or enrollment data). */
export function serializePlanFile(plan: PlanDefinition): string {
  const file: PlanFileV1 = {
    format: PLAN_FILE_FORMAT,
    version: 1,
    name: plan.name,
    ...(plan.description ? { description: plan.description } : {}),
    ...(plan.tracks?.length ? { tracks: plan.tracks.map((t) => ({ id: t.id, name: t.name })) } : {}),
    days: plan.days.map((d) => ({
      readings: d.readings.map((r) => (r.track !== undefined ? { start: r.start, end: r.end, track: r.track } : { start: r.start, end: r.end })),
    })),
  };
  return JSON.stringify(file, null, 2);
}

/** Parse a plan file into a `savePlan` input (a new plan). Throws `ReadingPlanDataError` for anything that is not one. */
export function parsePlanFile(text: string): SavePlanInput {
  if (typeof text !== 'string') throw new ReadingPlanDataError('This is not a reading plan file.');
  if (text.length > MAX_PLAN_FILE_BYTES) throw new ReadingPlanDataError('This file is too large to be a reading plan.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ReadingPlanDataError('This is not a reading plan file (invalid JSON).');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ReadingPlanDataError('This is not a reading plan file.');
  const o = raw as Record<string, unknown>;
  if (o.format !== PLAN_FILE_FORMAT) throw new ReadingPlanDataError('This is not a reading plan file.');
  if (o.version !== 1) throw new ReadingPlanDataError('This reading plan file is from a newer version of the app.');
  if (typeof o.name !== 'string' || o.name.trim().length < 1) throw new ReadingPlanDataError('The plan file has no name.');
  if (!Array.isArray(o.days) || o.days.length < 1) throw new ReadingPlanDataError('The plan file has no days.');
  if (o.days.length > MAX_PLAN_DAYS) throw new ReadingPlanDataError(`A plan can have at most ${MAX_PLAN_DAYS} days.`);
  if (o.name.length > 200) throw new ReadingPlanDataError('The plan name is too long.');
  if (o.description !== undefined && (typeof o.description !== 'string' || o.description.length > 2000)) throw new ReadingPlanDataError('The plan description must be text.');
  const out: SavePlanInput = { name: o.name, days: o.days as PlanDay[] };
  if (typeof o.description === 'string' && o.description) out.description = o.description;
  if (o.tracks !== undefined) {
    if (!Array.isArray(o.tracks) || o.tracks.length > 8) throw new ReadingPlanDataError('The plan file tracks are invalid.');
    const seen = new Set<string>();
    out.tracks = o.tracks.map((t, i) => {
      const x = t as Record<string, unknown> | null;
      if (
        !x || typeof x.id !== 'string' || typeof x.name !== 'string' || x.id.length < 1 || x.id.length > 40
        || x.name.trim().length < 1 || x.name.length > 200 || seen.has(x.id)
      ) throw new ReadingPlanDataError(`Track ${i + 1} is invalid.`);
      seen.add(x.id);
      return { id: x.id, name: x.name };
    });
  }
  return out;
}
