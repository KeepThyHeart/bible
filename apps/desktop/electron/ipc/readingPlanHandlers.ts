/**
 * IPC for reading plans (task 0073): the plan store over the shared user database
 * (`user_data_item`, owner `app:reading-plans`). The engine and ReadingPlanService run in the
 * renderer over this store (`src/ui/services/readingPlansAPI.ts`); stock plans ship in core and
 * only their snapshots cross this boundary. Every payload is validated here.
 *
 * Replies use the `Result<T>` envelope.
 */
import { UserDataRepository, ReadingPlans } from '@bible/core';
import { getSharedUserDb } from '../services/sharedUserDb';
import { initializeUserSchema } from '../schema/userSchema';
import { ipcHandler, IpcKnownError } from './handler-helper';

type Store = ReadingPlans.UserDataReadingPlanStore;
type PlanDefinition = ReadingPlans.PlanDefinition;
type Enrollment = ReadingPlans.Enrollment;
type Completion = ReadingPlans.Completion;
type CompletionChange = ReadingPlans.CompletionChange;

let storeInit: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storeInit) {
    storeInit = (async () => {
      const db = await getSharedUserDb();
      initializeUserSchema(db);
      return new ReadingPlans.UserDataReadingPlanStore(new UserDataRepository(db));
    })().catch((err: unknown) => {
      storeInit = null;
      throw err;
    });
  }
  return storeInit;
}

/** Forget the cached store (called when the user database is closed). */
export function resetReadingPlanStore(): void {
  storeInit = null;
}

function check<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new IpcKnownError('invalid_input', err instanceof Error ? err.message : String(err));
  }
}

function key(raw: unknown, what = 'key'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) throw new IpcKnownError('invalid_input', `A ${what} is required.`);
  return raw;
}

export function registerReadingPlanHandlers(): void {
  ipcHandler<[], PlanDefinition[]>('reading-plans:list-plans', async () => (await getStore()).listPlans());

  ipcHandler<[string], PlanDefinition | null>('reading-plans:get-plan', async (k) => (await getStore()).getPlan(key(k)));

  ipcHandler<[unknown], void>('reading-plans:put-plan', async (raw) => {
    const plan = check(() => ReadingPlans.validatePlanDefinition(raw));
    if (!plan.key.startsWith('user:') || plan.source !== 'user') throw new IpcKnownError('invalid_input', 'Only user plans can be saved.');
    await (await getStore()).putPlan(plan);
  });

  ipcHandler<[string], void>('reading-plans:remove-plan', async (k) => {
    const value = key(k);
    if (!value.startsWith('user:')) throw new IpcKnownError('invalid_input', 'Only user plans can be removed.');
    await (await getStore()).removePlan(value);
  });

  ipcHandler<[unknown], void>('reading-plans:put-snapshot', async (raw) => {
    const plan = check(() => ReadingPlans.validatePlanDefinition(raw));
    if (plan.source !== 'stock') throw new IpcKnownError('invalid_input', 'Only stock plans are snapshotted.');
    await (await getStore()).putSnapshot(plan);
  });

  ipcHandler<[], Enrollment[]>('reading-plans:list-enrollments', async () => (await getStore()).listEnrollments());

  ipcHandler<[unknown], void>('reading-plans:put-enrollment', async (raw) => {
    const e = check(() => ReadingPlans.validateEnrollment(raw));
    await (await getStore()).putEnrollment(e);
  });

  ipcHandler<[string], void>('reading-plans:remove-enrollment', async (id) => {
    await (await getStore()).removeEnrollment(key(id, 'enrollment id'));
  });

  ipcHandler<[string | undefined], Completion[]>('reading-plans:list-completions', async (id) => {
    return (await getStore()).listCompletions(id === undefined || id === null ? undefined : key(id, 'enrollment id'));
  });

  ipcHandler<[unknown], void>('reading-plans:set-completions', async (raw) => {
    if (!Array.isArray(raw) || raw.length > 200) throw new IpcKnownError('invalid_input', 'Expected a list of at most 200 changes.');
    const changes: CompletionChange[] = raw.map((c) => {
      if (typeof c !== 'object' || c === null || typeof (c as { done?: unknown }).done !== 'boolean') {
        throw new IpcKnownError('invalid_input', 'Each change needs a completion and done.');
      }
      return { completion: check(() => ReadingPlans.validateCompletion((c as { completion: unknown }).completion)), done: (c as { done: boolean }).done };
    });
    await (await getStore()).setCompletions(changes);
  });
}
