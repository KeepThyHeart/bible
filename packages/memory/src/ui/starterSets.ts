/**
 * Starter sets: the suggested lists as one-tap chips (first open of Today, and
 * anywhere else a gallery is wanted).
 *
 * Extracted from the old Manage Passages screen's suggested-lists gallery. The
 * create logic is the same - reuse a list of the exact same name rather than
 * make a duplicate, so pressing a chip twice is harmless - but the references
 * are added with `addPassage`'s `collectionId`, so the user's focus (the
 * persisted scope) is never switched as a side effect.
 */

import type { PlanView } from '../core/types';
import { SUGGESTED_LISTS } from '../core/suggestedLists';
import type { SuggestedList } from '../core/suggestedLists';
import { el, replace } from './dom';
import { errorBanner } from './components';
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

  let added = 0;
  const failed: { reference: string; error: string }[] = [];
  for (const reference of set.references) {
    const reply = await host.request({ type: 'addPassage', reference, collectionId: targetId });
    if (reply.ok) added += 1;
    else failed.push({ reference, error: reply.error });
  }
  return { ok: true, outcome: { added, failed } };
}

/** One chip per starter set. Press creates the list, adds its verses and reloads. */
export function renderStarterChips(host: PanelHost, plan: PlanView): HTMLElement {
  const status = el('div', { class: 'sm-starter-status', attrs: { 'aria-live': 'polite' } });
  const chips: HTMLButtonElement[] = [];

  const row = el(
    'ul',
    { class: 'sm-starter-chips', attrs: { 'aria-label': tr('memory.ui.today.starterSets', 'Starter sets') } },
    SUGGESTED_LISTS.map((set) => {
      const chip = el('button', {
        class: 'sm-chip',
        text: tr('memory.ui.today.starterChip', '{name} ({count})', { name: set.name, count: set.references.length }),
        title: set.blurb,
        attrs: { type: 'button' },
      });
      chips.push(chip);
      chip.addEventListener('click', () => {
        void (async () => {
          for (const c of chips) c.disabled = true;
          replace(status, []);
          const result = await createStarterSet(host, plan, set);
          for (const c of chips) c.disabled = false;
          if (!result.ok) {
            replace(status, [errorBanner(result.error)]);
            return;
          }
          const { added, failed } = result.outcome;
          if (failed.length > 0) {
            replace(status, failed.map((f) => errorBanner(`${f.reference}: ${f.error}`)));
          }
          host.announce(
            failed.length === 0
              ? tr('memory.ui.today.starterCreated', 'Created {name} with {count, plural, one {# verse} other {# verses}}.', { name: set.name, count: added })
              : tr('memory.ui.today.starterSomeFailed', 'Created {name}: {added, plural, one {# verse} other {# verses}} added, {failed, plural, one {# reference} other {# references}} failed.', { name: set.name, added, failed: failed.length }),
          );
          if (added > 0) host.reload();
        })();
      });
      return el('li', { class: 'sm-starter-item' }, [chip]);
    }),
  );

  return el('div', { class: 'sm-starter-sets' }, [row, status]);
}
