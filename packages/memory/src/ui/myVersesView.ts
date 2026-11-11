/**
 * My verses (A6): every verse with a status and a next review, filtered by list.
 *
 * CALLER CONTRACT: `renderMyVerses(host, plan, allPlan, view)`.
 *   - `plan` is the ordinary (focus-scoped) plan: it tells us the focus
 *     (`plan.scope`) and the shell chip uses it.
 *   - `allPlan` MUST be `getPlan({ scope: { kind: 'all' } })`: it holds every
 *     list's verses even when a focus is set. The coordinator fetches both for
 *     the verses tab; this view never fetches.
 *   - `view.list`: `'focus'` follows the focus (all lists when there is none),
 *     `'all'` or a list id is an explicit chip. A list id that no longer
 *     exists shows all lists.
 *
 * Lists are filters here, not a mode: pressing a chip changes only what is
 * listed. "Focus Today on this list" (chip menu) is the one thing that changes
 * what Today does. The add field adds to the filtered list (or the Default one
 * when showing all), with a picker when there are several lists.
 */

import type { ListSummary, PassageView, PlanView } from '../core/types';
import { verseStatus } from '../core/today';
import { button, el } from './dom';
import { emptyState, menu, translationTag } from './components';
import { renderAddVerseForm } from './addVerseForm';
import { createList, listMenuItems } from './listActions';
import type { PanelHost } from './host';
import { tr } from './i18n';
import { renderStarterChips } from './starterSets';
import type { VersesFilter } from './state';
import { nextReviewText, statusChip } from './verseStatusUi';
import { practiceVerse, verseMenuItems } from './verseActions';
import './styles/verses.css';

/** The filter actually in force: a number (one list) or 'all'. */
function effectiveFilter(plan: PlanView, allPlan: PlanView, view: { list: VersesFilter }): 'all' | number {
  const wanted: VersesFilter = view.list === 'focus' ? plan.scope : view.list;
  if (typeof wanted === 'number' && allPlan.lists.some((l) => l.id === wanted)) return wanted;
  return 'all';
}

export function renderMyVerses(
  host: PanelHost,
  plan: PlanView,
  allPlan: PlanView,
  view: { list: VersesFilter; highlight?: number },
): HTMLElement {
  const now = host.now();
  const lists = allPlan.lists;
  const filter = effectiveFilter(plan, allPlan, view);
  const listName = new Map(lists.map((l) => [l.id, l.name] as const));

  const root = el('section', { class: 'sm-screen sm-verses' });
  root.appendChild(el('h1', { class: 'sm-screen-title sm-verses-title', text: tr('memory.ui.verses.title', 'My verses') }));

  // --- add area ---
  const defaultListId = typeof filter === 'number' ? filter : plan.collectionId;
  const form = renderAddVerseForm(host, {
    lists,
    defaultListId,
    onAdded: (passage) => {
      // Show the new row highlighted, in a filter that contains it.
      const list: VersesFilter = typeof filter === 'number' && filter !== passage.collectionId ? passage.collectionId : filter;
      host.go({ type: 'goVerses', list, highlight: passage.id });
      host.reload();
    },
  });
  root.appendChild(form.element);
  root.appendChild(renderStarters(host, allPlan, allPlan.passages.length === 0));

  // --- list chips ---
  root.appendChild(renderChips(host, plan, allPlan, filter));

  // --- rows ---
  const shown = allPlan.passages.filter((pv) => filter === 'all' || pv.passage.collectionId === filter);
  if (allPlan.passages.length === 0) {
    root.appendChild(
      emptyState(
        tr('memory.ui.verses.emptyAll', 'No verses yet.'),
        tr('memory.ui.verses.emptyAllHint', 'Add one above, or begin with a starter set.'),
      ),
    );
  } else if (shown.length === 0) {
    root.appendChild(
      emptyState(
        tr('memory.ui.verses.emptyList', 'No verses in this list yet.'),
        tr('memory.ui.verses.emptyListHint', 'Add one above.'),
      ),
    );
  } else {
    root.appendChild(
      el(
        'ul',
        { class: 'sm-list sm-verse-rows', attrs: { 'aria-label': tr('memory.ui.verses.rowsLabel', 'Your verses') } },
        shown.map((pv) => renderRow(host, pv, lists, listName, now, filter === 'all' && lists.length > 1, view.highlight === pv.passage.id)),
      ),
    );
  }
  return root;
}

function renderStarters(host: PanelHost, allPlan: PlanView, open: boolean): HTMLElement {
  const details = el('details', { class: 'sm-verses-starters' }, [
    el('summary', { text: tr('memory.ui.verses.starterSets', 'Starter sets') }),
    el('p', { class: 'sm-hint', text: tr('memory.ui.verses.starterHint', 'A ready-made list of well-known verses. Each makes its own list.') }),
    renderStarterChips(host, allPlan),
  ]);
  if (open) details.open = true;
  return details;
}

function renderChips(host: PanelHost, plan: PlanView, allPlan: PlanView, filter: 'all' | number): HTMLElement {
  const lists = allPlan.lists;
  const countOf = (id: number): number => allPlan.passages.filter((pv) => pv.passage.collectionId === id).length;
  const go = (list: VersesFilter): void => host.go({ type: 'goVerses', list });

  const chip = (label: string, pressed: boolean, onClick: () => void, extra?: HTMLElement): HTMLButtonElement => {
    const b = button(label, onClick, {
      class: `sm-chip sm-list-chip${pressed ? ' sm-chip-on' : ''}`,
      attrs: { 'aria-pressed': String(pressed) },
    });
    if (extra) b.appendChild(extra);
    return b;
  };

  const items: HTMLElement[] = [
    el('li', { class: 'sm-chip-item' }, [
      chip(tr('memory.ui.verses.chipAll', 'All ({count})', { count: allPlan.passages.length }), filter === 'all', () => go('all')),
    ]),
  ];
  for (const list of lists) {
    const focused = plan.scope === list.id;
    const focusTag = focused ? el('span', { class: 'sm-chip-focus', text: tr('memory.ui.verses.focusTag', 'Focus') }) : undefined;
    items.push(
      el('li', { class: 'sm-chip-item sm-chip-group' }, [
        chip(
          tr('memory.ui.verses.chipList', '{name} ({count})', { name: list.name, count: countOf(list.id) }),
          filter === list.id,
          () => go(list.id),
          focusTag,
        ),
        menu({
          label: tr('memory.ui.verses.listOptions', 'Options for {name}', { name: list.name }),
          items: listMenuItems(host, list, lists, focused),
        }),
      ]),
    );
  }
  items.push(
    el('li', { class: 'sm-chip-item' }, [
      button(tr('memory.ui.verses.newListChip', '+ New list'), () => createList(host), { class: 'sm-chip sm-list-chip sm-chip-new' }),
    ]),
  );
  return el('ul', { class: 'sm-chips sm-list-chips', attrs: { 'aria-label': tr('memory.ui.verses.listsLabel', 'Lists') } }, items);
}

function renderRow(
  host: PanelHost,
  pv: PassageView,
  lists: ListSummary[],
  listName: Map<number, string>,
  now: number,
  showList: boolean,
  highlighted: boolean,
): HTMLElement {
  const info = verseStatus(pv, now);
  const ref = pv.passage.reference;

  const open = button(ref, () => host.go({ type: 'goVerse', passageId: pv.passage.id }), {
    class: 'sm-verse-ref',
    attrs: { 'aria-label': tr('memory.ui.verses.openRef', 'Open {reference}', { reference: ref }) },
  });

  const row = el('li', { class: `sm-verse-row${highlighted ? ' sm-verse-row-new' : ''}`, attrs: { 'data-passage-id': String(pv.passage.id) } }, [
    el('div', { class: 'sm-verse-main' }, [
      open,
      translationTag(pv.passage.moduleId),
      showList ? el('span', { class: 'sm-row-meta sm-verse-list', text: listName.get(pv.passage.collectionId) ?? '' }) : null,
    ]),
    el('div', { class: 'sm-verse-state' }, [
      statusChip(info.status),
      el('span', { class: 'sm-verse-next', text: nextReviewText(info, now) }),
    ]),
    el('div', { class: 'sm-verse-acts' }, [
      highlighted
        ? button(tr('memory.ui.verses.practiceNow', 'Practice now'), () => practiceVerse(host, pv), {
            class: 'sm-btn sm-btn-primary sm-btn-small sm-verse-practice',
            attrs: { 'aria-label': tr('memory.ui.verses.practiceRefNow', 'Practice {reference} now', { reference: ref }) },
          })
        : null,
      menu({
        label: tr('memory.ui.verses.rowMenu', 'Actions for {reference}', { reference: ref }),
        items: verseMenuItems(host, pv, lists, {
          practice: true,
          open: true,
          onRemoved: () => host.reload(),
        }),
      }),
    ]),
  ]);
  return row;
}
