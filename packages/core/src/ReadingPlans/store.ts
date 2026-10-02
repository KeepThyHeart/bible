/**
 * Reading-plan persistence. The service talks to IReadingPlanStore; desktop backs it with the
 * shared user database (`user_data_item`, owner `app:reading-plans`) behind IPC, and later sync
 * (0063) syncs those rows like any other user data.
 *
 * Owner `app:reading-plans`, collections (value = JSON):
 *   plans        itemKey `user:<uuid>`             PlanDefinition of a user-built plan
 *   snapshots    itemKey `stock:<id>@<version>`     the stock plan's days as they were when started
 *   enrollments  itemKey `<enrollment id>`          Enrollment
 *   completions  itemKey `<enrollment id>/<day>/<reading>`  { at, via }  (one row per ticked reading,
 *                so merges and sync are a union, never a lost update of one big blob)
 */
import { UserDataItem, appOwner } from '../Data/Models/User/UserDataItem';
import type { IUserDataRepository } from '../Data/Repositories/IUserDataRepository';
import type { Completion, CompletionVia, Enrollment, PlanDefinition } from './types';
import { validateEnrollment, validatePlanDefinition } from './validate';

export const READING_PLANS_OWNER = appOwner('reading-plans');
export const PLANS_COLLECTION = 'plans';
export const SNAPSHOTS_COLLECTION = 'snapshots';
export const ENROLLMENTS_COLLECTION = 'enrollments';
export const COMPLETIONS_COLLECTION = 'completions';

export interface CompletionChange {
  completion: Completion;
  done: boolean;
}

export interface IReadingPlanStore {
  /** User-built plans (not snapshots). */
  listPlans(): Promise<PlanDefinition[]>;
  /** A user plan by key, or a snapshot by `<key>@<version>`. */
  getPlan(key: string): Promise<PlanDefinition | null>;
  putPlan(plan: PlanDefinition): Promise<void>;
  removePlan(key: string): Promise<void>;
  /** Store a stock plan's days under `<key>@<version>` (no-op when already there). */
  putSnapshot(plan: PlanDefinition): Promise<void>;
  listEnrollments(): Promise<Enrollment[]>;
  putEnrollment(e: Enrollment): Promise<void>;
  /** Removes the enrollment and its completions. */
  removeEnrollment(id: string): Promise<void>;
  listCompletions(enrollmentId?: string): Promise<Completion[]>;
  setCompletions(changes: CompletionChange[]): Promise<void>;
}

export function snapshotKey(key: string, version: number): string {
  return `${key}@${version}`;
}

function completionKey(c: Pick<Completion, 'enrollmentId' | 'day' | 'reading'>): string {
  return `${c.enrollmentId}/${c.day}/${c.reading}`;
}

function parseCompletion(item: UserDataItem): Completion | null {
  const m = /^(.+)\/(\d+)\/(\d+)$/.exec(item.itemKey);
  if (!m) return null;
  const v = item.parsedValue() as { at?: unknown; via?: unknown } | undefined;
  const via: CompletionVia = v?.via === 'reader' || v?.via === 'audio' ? v.via : 'manual';
  return { enrollmentId: m[1], day: Number(m[2]), reading: Number(m[3]), at: typeof v?.at === 'string' ? v.at : '', via };
}

/** IReadingPlanStore over the generic user-data store (SQLite on desktop, MemoryUserDb in tests/web). */
export class UserDataReadingPlanStore implements IReadingPlanStore {
  constructor(private readonly repo: IUserDataRepository) {}

  private readPlans(collection: string): PlanDefinition[] {
    const out: PlanDefinition[] = [];
    for (const item of this.repo.list(READING_PLANS_OWNER, collection)) {
      try {
        out.push(validatePlanDefinition(item.parsedValue()));
      } catch { /* skip a corrupt row rather than fail the list */ }
    }
    return out;
  }

  async listPlans(): Promise<PlanDefinition[]> {
    return this.readPlans(PLANS_COLLECTION);
  }

  async getPlan(key: string): Promise<PlanDefinition | null> {
    const item = this.repo.get(READING_PLANS_OWNER, key.includes('@') ? SNAPSHOTS_COLLECTION : PLANS_COLLECTION, key);
    if (!item) return null;
    try {
      return validatePlanDefinition(item.parsedValue());
    } catch {
      return null;
    }
  }

  async putPlan(plan: PlanDefinition): Promise<void> {
    this.repo.put(UserDataItem.json(READING_PLANS_OWNER, PLANS_COLLECTION, plan.key, plan));
  }

  async removePlan(key: string): Promise<void> {
    this.repo.remove(READING_PLANS_OWNER, PLANS_COLLECTION, key);
  }

  async putSnapshot(plan: PlanDefinition): Promise<void> {
    const key = snapshotKey(plan.key, plan.version);
    if (this.repo.get(READING_PLANS_OWNER, SNAPSHOTS_COLLECTION, key)) return;
    this.repo.put(UserDataItem.json(READING_PLANS_OWNER, SNAPSHOTS_COLLECTION, key, plan));
  }

  async listEnrollments(): Promise<Enrollment[]> {
    const out: Enrollment[] = [];
    for (const item of this.repo.list(READING_PLANS_OWNER, ENROLLMENTS_COLLECTION)) {
      try {
        out.push(validateEnrollment(item.parsedValue()));
      } catch { /* skip */ }
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async putEnrollment(e: Enrollment): Promise<void> {
    this.repo.put(UserDataItem.json(READING_PLANS_OWNER, ENROLLMENTS_COLLECTION, e.id, e));
  }

  async removeEnrollment(id: string): Promise<void> {
    this.repo.remove(READING_PLANS_OWNER, ENROLLMENTS_COLLECTION, id);
    for (const c of await this.listCompletions(id)) {
      this.repo.remove(READING_PLANS_OWNER, COMPLETIONS_COLLECTION, completionKey(c));
    }
  }

  async listCompletions(enrollmentId?: string): Promise<Completion[]> {
    const out: Completion[] = [];
    for (const item of this.repo.list(READING_PLANS_OWNER, COMPLETIONS_COLLECTION)) {
      const c = parseCompletion(item);
      if (c && (enrollmentId === undefined || c.enrollmentId === enrollmentId)) out.push(c);
    }
    return out;
  }

  async setCompletions(changes: CompletionChange[]): Promise<void> {
    const puts: UserDataItem[] = [];
    for (const { completion: c, done } of changes) {
      if (done) puts.push(UserDataItem.json(READING_PLANS_OWNER, COMPLETIONS_COLLECTION, completionKey(c), { at: c.at, via: c.via }));
      else this.repo.remove(READING_PLANS_OWNER, COMPLETIONS_COLLECTION, completionKey(c));
    }
    if (puts.length) this.repo.putAll(puts);
  }
}
