/**
 * The plan: "just go" and a quiet list of what is underway.
 *
 * This is the default screen and, for a user in the habit, the only one they
 * need: open the panel, press Practice, work, close it. Task 0004's review
 * asked for this explicitly - "it should be possible, and easy, for the user
 * to just go" - and the one-click add-and-start path below for an empty plan
 * is the sharpest form of that: a brand new user should never see an empty
 * list with nothing to press.
 *
 * T10 reworked this screen: the title is now the literal string "Bible
 * Memory" rather than the current list's name (`PlanView.collectionName` no
 * longer drives it - see that field's own doc comment in `types.ts`), the
 * bordered "Start practicing" button is gone in favour of a chrome-free
 * six-tile activity grid, and the full
 * add-passage form (paste-batch flow included) has moved to the Manage
 * Passages screen (T11) - this file keeps only `renderAddAndStart`, the
 * one-press shortcut for a plan with nothing in it yet.
 */

import type { PassageSortOrder, PassageView, PlanView } from '../core/types';
import { append, button, el } from './dom';
import { activitySquares, breadcrumb, dueBadge, emptyState, icon, listSelector, menu } from './components';
import type { ListSelectorOption } from './components';
import { sortPassagesByNeed } from './format';
import { flowUnavailable } from './suggest';
import { ACTIVITY_TILES, RECITE_TILE, reciteDueEntry, reciteTileVisible, startReciteRun } from './activities';
import type { ActivityTile } from './activities';
import type { Flow } from './state';
import { MIN_VERSES_FOR_REFERENCE_ACTIVITIES } from '../core/ladder';
import type { PanelHost } from './host';
import { cardsWaitingBanner } from './cardsBanner';
import { tr } from './i18n';

export function renderPlan(host: PanelHost, plan: PlanView): HTMLElement {
  const now = host.now();
  const root = el('section', { class: 'sm-screen sm-screen-plan' });

  root.appendChild(
    breadcrumb({
      crumbs: [{ label: tr('memory.ui.plan.home', 'Home') }],
      menu: menu({
        label: tr('memory.ui.plan.menu', 'Menu'),
        items: [
          { label: tr('memory.ui.plan.managePassages', 'Manage Passages'), onClick: () => host.go({ type: 'goManagePassages' }) },
          { label: tr('memory.ui.plan.analytics', 'Analytics'), onClick: () => host.go({ type: 'goAnalytics' }) },
          { label: tr('memory.ui.plan.settings', 'Settings'), onClick: () => host.go({ type: 'goSettings' }) },
        ],
      }),
      actions: [],
    }),
  );

  if (plan.lists.length > 1) {
    root.appendChild(renderListPicker(host, plan));
  }

  if (plan.passages.length === 0) {
    root.appendChild(renderAddAndStart(host));
    root.appendChild(
      emptyState(
        tr('memory.ui.plan.nothingInPlan', 'Nothing in your plan yet.'),
        tr('memory.ui.plan.nothingInPlanHint', 'Add a reference above - a single verse, or a range like "Psalm 1:1-6" - and its activities will be built for you.'),
      ),
    );
    return root;
  }

  const banner = cardsWaitingBanner(host, plan.cardsWaiting ?? 0);
  if (banner) root.appendChild(banner);

  root.appendChild(renderActivityTiles(host, plan, now));
  root.appendChild(renderPassageListHeader(host, plan));

  // 'bible' is `plan.passages`'s own order (ORDER BY start_verse_id).
  const sortedPassages = plan.sortOrder === 'need' ? sortPassagesByNeed(plan.passages, now) : plan.passages;

  root.appendChild(
    el(
      'ul',
      { class: 'sm-list', attrs: { 'aria-label': tr('memory.ui.plan.passagesInPlan', 'Passages in this plan') } },
      sortedPassages.map((pv) => renderPassageRow(host, pv)),
    ),
  );

  return root;
}

// ---------------------------------------------------------------------------
// Activity tiles
// ---------------------------------------------------------------------------

/**
 * "Practice by Activity": the six-tile grid, one tile per
 * `activities.ts#ACTIVITY_TILES` entry. A tile press goes through
 * `host.startFlow`, which picks the passage with `suggest.ts#pickFlowTarget`
 * (main's weighted shuffle for Variety, a rung-filtered draw otherwise).
 *
 * Main's old "shuffle suggestion" target line is dropped: a tile starts a
 * fresh random pick each press, so there is no pending suggestion to show.
 */
function renderActivityTiles(host: PanelHost, plan: PlanView, now: number): HTMLElement {
  const grid = ACTIVITY_TILES.map((tile) => renderActivityTile(host, plan, tile, now));
  if (reciteTileVisible(plan)) {
    // Recite starts a recite run (tap mode) on the most due-ish passage, not a session flow.
    const due = reciteDueEntry(plan);
    const recite = button(RECITE_TILE.title, () => void startReciteRun(host, { kind: 'due' }, 'tap'), {
      class: 'sm-tile sm-tile-recite',
      text: '',
      disabled: due === null || !due.enabled,
    });
    append(recite, [
      el('span', { class: 'sm-tile-head' }, [icon('recite'), el('span', { class: 'sm-tile-title', text: RECITE_TILE.title })]),
      el('span', { class: 'sm-tile-sub', text: RECITE_TILE.subtext }),
      due !== null && !due.enabled
        ? el('span', { class: 'sm-tile-warning', text: tr('memory.ui.plan.nothingDueToRecite', 'Nothing due to recite yet. Switch it on for a passage first.') })
        : null,
    ]);
    grid.push(recite);
  }
  const dueEntry = reciteDueEntry(plan);
  return el('section', { class: 'sm-tile-section' }, [
    el('h2', { class: 'sm-block-title', text: tr('memory.ui.plan.practiceByActivity', 'Practice by Activity') }),
    el('div', { class: 'sm-tile-grid' }, grid),
    dueEntry === null
      ? null
      : button(dueEntry.label, () => void startReciteRun(host, { kind: 'due' }, 'handsfree'), {
          class: 'sm-btn sm-btn-quiet sm-recite-due',
          disabled: !dueEntry.enabled,
        }),
  ]);
}

function tileFlow(tile: ActivityTile): Flow {
  return tile.id === 'variety' ? { kind: 'variety' } : { kind: 'activity', rung: tile.rung! };
}

/**
 * One tile: icon, title, subtext and, when it cannot be pressed, a warning
 * line. Locked reference tiles show the reference-hint text; the tile stays
 * visible but disabled so a gap in the grid never reads as a bug.
 */
function renderActivityTile(host: PanelHost, plan: PlanView, tile: ActivityTile, now: number): HTMLElement {
  const flow = tileFlow(tile);
  const unavailable = flowUnavailable(plan, flow, now);
  const warning =
    unavailable === 'locked'
      ? referenceHintText(plan)
      : unavailable === 'empty'
        ? tr('memory.ui.plan.nothingToPractise', 'Nothing to practise for this activity yet.')
        : null;

  const tileButton = button(tile.title, () => void host.startFlow(flow), {
    class: 'sm-tile',
    text: '',
    disabled: unavailable !== null,
  });

  append(tileButton, [
    el('span', { class: 'sm-tile-head' }, [icon(tile.id), el('span', { class: 'sm-tile-title', text: tile.title })]),
    el('span', { class: 'sm-tile-sub', text: tile.subtext }),
    warning === null ? null : el('span', { class: 'sm-tile-warning', text: warning }),
  ]);

  return tileButton;
}

/** Why the two reference tiles are locked, and how far from unlocking. */
function referenceHintText(plan: PlanView): string {
  const needed = MIN_VERSES_FOR_REFERENCE_ACTIVITIES;
  const short = Math.max(0, needed - plan.scopeVerseCount);
  return tr(
    'memory.ui.plan.referenceHint',
    'Match references and Provide reference need {needed} verses in this list - {short} more to go ({sofar} so far). Add passages in Manage Passages.',
    { needed, short, sofar: plan.scopeVerseCount },
  );
}

// ---------------------------------------------------------------------------
// Passage list heading and sort control
// ---------------------------------------------------------------------------

/**
 * "Practice by Passage" heading plus the Bible-order / Needs-practice sort
 * `<select>`. The choice persists through the `setPassageSortOrder` request
 * (`PlanView.sortOrder`); `host.reload()` re-fetches the plan afterwards.
 */
function renderPassageListHeader(host: PanelHost, plan: PlanView): HTMLElement {
  const select = el('select', {
    class: 'sm-select',
    id: 'sm-passage-sort',
    attrs: { 'aria-label': tr('memory.ui.plan.sortPassages', 'Sort passages') },
  }) as HTMLSelectElement;

  const options: { value: PassageSortOrder; label: string }[] = [
    { value: 'bible', label: tr('memory.ui.plan.bibleOrder', 'Bible order') },
    { value: 'need', label: tr('memory.ui.plan.needsPractice', 'Needs practice') },
  ];
  for (const opt of options) {
    const optionEl = el('option', { value: opt.value, text: opt.label });
    if (plan.sortOrder === opt.value) optionEl.selected = true;
    select.appendChild(optionEl);
  }

  select.addEventListener('change', () => {
    const order = select.value as PassageSortOrder;
    select.disabled = true;
    void host.request({ type: 'setPassageSortOrder', order }).then((reply) => {
      select.disabled = false;
      if (!reply.ok) {
        host.announce(reply.error);
        return;
      }
      host.reload();
    });
  });

  return el('div', { class: 'sm-list-header' }, [
    el('h2', { class: 'sm-block-title', text: tr('memory.ui.plan.practiceByPassage', 'Practice by Passage') }),
    select,
  ]);
}

function renderListPicker(host: PanelHost, plan: PlanView): HTMLElement {
  const options: ListSelectorOption[] = [
    { id: 'all', name: tr('memory.ui.plan.allLists', 'All Lists') },
    ...plan.lists.map((list) => ({ id: list.id, name: list.name })),
  ];
  // `selected` is always read from `plan.scope`, never from local state - the
  // worker owns scope, so a `planChanged` push that rebuilds this whole
  // screen still shows the right selection rather than silently resetting to
  // "All Lists".
  return listSelector(options, plan.scope, (id) => {
    void host
      .request({ type: 'setScope', scope: id === 'all' ? { kind: 'all' } : { kind: 'list', id } })
      .then((reply) => {
        if (reply.ok) host.reload();
        else host.announce(reply.error);
      });
  });
}

// ---------------------------------------------------------------------------
// The one-click empty-plan shortcut
// ---------------------------------------------------------------------------

/**
 * On an empty plan, "Practice" becomes a one-click "Add <verse> and start",
 * using whatever the host says the reader is currently looking at. That is
 * the whole point of the worker pushing `activeVerse` in the first place:
 * someone who has just read a verse and reached for this panel should not
 * have to type it back in before they can begin. The full add-passage form
 * (batches, paste handling) lives on the Manage Passages screen now; this is
 * the one thing a brand-new user must still have to press.
 */
function renderAddAndStart(host: PanelHost): HTMLElement {
  const reference = host.activeReference;

  if (!reference) {
    return el('div', { class: 'sm-callout' }, [
      el('p', { class: 'sm-callout-text', text: tr('memory.ui.plan.addVerseToStart', 'Add a verse from Manage Passages to get started.') }),
    ]);
  }

  const action = button(
    tr('memory.ui.plan.addAndStart', 'Add {reference} and start', { reference }),
    () => {
      action.disabled = true;
      void host
        .request({ type: 'addPassage', reference })
        .then((reply) => {
          if (!reply.ok) {
            action.disabled = false;
            host.announce(reply.error);
            return;
          }
          void host.startSession(reply.data.passage.id);
        });
    },
    { class: 'sm-btn sm-btn-primary sm-btn-block sm-btn-large' },
  );

  return el('div', { class: 'sm-callout sm-callout-action' }, [action]);
}

// ---------------------------------------------------------------------------
// One passage
// ---------------------------------------------------------------------------

/**
 * A plan row: one compact, tabular line - reference and due badge on the
 * left, activity squares on the right - rather than a labelled strip per
 * activity, per the task 0004 review ("a lot more compact... a single row of
 * squares"). Row-level actions (Practice, Show in Bible) are gone too - the
 * review asked for them to stay hidden until a passage is actually selected,
 * and opening the passage screen already puts both one click away.
 *
 * A follow-up review round asked for the row to be tighter still: the verse
 * count ("6 verses") is dropped as extraneous once the reference itself often
 * says the same thing ("Psalm 23:1-6"), and so is the separate "Well
 * learned" text pill - an all-green square row already says exactly that,
 * and a second label for the same fact was the extraneous one, not the due
 * badge, which stays.
 *
 * The whole row is a real `<button>`, so it is reachable by Tab and
 * activates on Enter and Space without any of that being reimplemented.
 */
function renderPassageRow(host: PanelHost, pv: PassageView): HTMLElement {
  const main = button(
    pv.passage.reference,
    () => host.go({ type: 'goPassage', passageId: pv.passage.id }),
    { class: 'sm-row-main', text: '' },
  );
  append(main, [
    el('span', { class: 'sm-row-title' }, [
      el('span', { class: 'sm-row-ref', text: pv.passage.reference }),
      dueBadge(pv.dueCount),
    ]),
    activitySquares(pv.rungs),
  ]);

  return el('li', { class: 'sm-row' }, [main]);
}
