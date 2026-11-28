/**
 * Starter sets: creating a list from one of the suggested lists (the starter
 * browser, `starterBrowser.ts`, previews them first).
 *
 * Extracted from the old Manage Passages screen's suggested-lists gallery. The
 * create logic is the same - reuse a list of the exact same name rather than
 * make a duplicate, so adding a set twice is harmless - but the references
 * are added with `addPassage`'s `collectionId`, so the user's focus (the
 * persisted scope) is never switched as a side effect.
 */

import type { PlanView } from '../core/types';
import type { SuggestedList } from '../core/suggestedLists';
import type { PanelHost } from './host';
import { tr } from './i18n';

export interface StarterOutcome {
  /** Distinct verses now in the set's list that this call added or found. */
  added: number;
  failed: { reference: string; error: string }[];
}

/**
 * Creates (or reuses) the list named like `set` and adds the set's references
 * to it. Returns the outcome, or an error string when the list itself could
 * not be created.
 */
export async function createStarterSet(
  host: PanelHost,
  plan: PlanView,
  set: SuggestedList,
): Promise<{ ok: true; outcome: StarterOutcome } | { ok: false; error: string }> {
  const existing = plan.lists.find((l) => l.name === set.name);
  let targetId: number;
  if (existing) {
    targetId = existing.id;
  } else {
    const created = await host.request({ type: 'createList', name: set.name });
    if (!created.ok) return { ok: false, error: created.error };
    const made = created.data.lists.find((l) => l.name === set.name);
    if (!made) {
      return {
        ok: false,
        error: tr('memory.ui.today.couldNotFindCreatedList', 'Could not find the list that was just created.'),
      };
    }
    targetId = made.id;
  }

  const result = await addStarterSetToList(host, set, targetId);
  return { ok: true, outcome: { added: result.added + result.existing, failed: result.failed } };
}

export interface AddToListOutcome {
  /** References that became new rows in the list (a removed one coming back counts here). */
  added: number;
  /** References the list already held: `addPassage` answered `existed`, nothing was duplicated. */
  existing: number;
  failed: { reference: string; error: string }[];
}

/**
 * Adds the set's references to an existing list, one after another. A verse
 * the list already holds is not added twice: `addPassage` with a
 * `collectionId` answers with the existing row (`existed`), which is counted
 * separately so the summary can say how many were already there.
 */
export async function addStarterSetToList(host: PanelHost, set: SuggestedList, listId: number): Promise<AddToListOutcome> {
  let added = 0;
  let existing = 0;
  const failed: { reference: string; error: string }[] = [];
  for (const reference of set.references) {
    const reply = await host.request({ type: 'addPassage', reference, collectionId: listId });
    if (!reply.ok) failed.push({ reference, error: reply.error });
    else if (reply.data.existed) existing += 1;
    else added += 1;
  }
  return { added, existing, failed };
}
