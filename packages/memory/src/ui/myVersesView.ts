/**
 * My verses (R2-7..R2-10): an overall progress bar, one "List:" picker, and one list of verses
 * sorted by need, each with its activity blocks.
 *
 * CALLER CONTRACT: `renderMyVerses(host, plan, view)`.
 *   - `plan` is the cached all-scope plan (`host.data.get()`); this view never fetches and a filter
 *     change is just a re-render from that cache (`goVerses`).
 *   - `view.list`: 'all' or a list id. A list id that no longer exists shows all lists.
 *   - `view.highlight`: a just-added verse id (shown highlighted with "Practice now").
 *
 * The "..." menu keeps Practice now / Move to list / Show in Bible / Remove. List management and the
 * focus control live on the Lists tab.
 */

import { activityBlocks, overallProgress, sortByNeed } from '../core/progress';
import { reciteEnabled } from '../core/features';
import { verseStatus } from '../core/today';
import type { ListSummary, PassageView, PlanView } from '../core/types';
import type { ActivityBlock } from '../core/progress';
import { blocksFocusin, blocksKeydown, fillActivitySummary, renderActivityBlocks, renderActivitySummary, startBlock } from './activityBlocks';
import { openAddVerseDialog } from './addVerseDialog';
import { button, el } from './dom';
import { emptyState, menu, translationTag } from './components';
import type { PanelHost } from './host';
import { tr } from './i18n';
import { renderStarterChips } from './starterSets';
import type { VersesFilter } from './state';
import { nextReviewText } from './verseStatusUi';
import { practiceVerse, verseMenuItems } from './verseActions';
import './styles/verses.css';

/** The filter actually in force: a number (one list) or 'all'. */
function effectiveFilter(plan: PlanView, wanted: VersesFilter): 'all' | number {
  if (typeof wanted === 'number' && plan.lists.some((l) => l.id === wanted)) return wanted;
  return 'all';
}

export function renderMyVerses(
  host: PanelHost,
  plan: PlanView,
  view: { list: VersesFilter; highlight?: number },
): HTMLElement {
  const now = host.now();
  const lists = plan.lists;
  const filter = effectiveFilter(plan, view.list);
  const listName = new Map(lists.map((l) => [l.id, l.name] as const));
  // While the speech probe has not answered, the recite block is hidden (it would wrongly read "not available").
  const speechUnknown = (plan.speech as { unknown?: boolean } | undefined)?.unknown === true;
  const reciteShown = reciteEnabled() && !speechUnknown;

  const root = el('section', { class: 'sm-screen sm-verses' });

  const addVerse = (): void =>
    openAddVerseDialog(host, {
      lists,
      listId: typeof filter === 'number' ? filter : null,
      onAdded: (passage) => {
        const list: VersesFilter = typeof filter === 'number' && filter !== passage.collectionId ? passage.collectionId : filter;
        host.go({ type: 'goVerses', list, highlight: passage.id });
      },
    });

  root.appendChild(
    el('div', { class: 'sm-verses-head' }, [
      el('h1', { class: 'sm-screen-title sm-verses-title', text: tr('memory.ui.verses.title', 'My verses') }),
      button(tr('memory.ui.verses.addVerse', 'Add verse'), addVerse, { class: 'sm-btn sm-btn-primary sm-verses-add-btn' }),
    ]),
  );

  const shown = plan.passages.filter((pv) => filter === 'all' || pv.passage.collectionId === filter);

  // --- overall progress (follows the List filter) ---
  if (shown.length > 0) root.appendChild(renderProgress(shown));

  // --- the one List picker ---
  root.appendChild(renderPicker(host, plan, filter));

  // --- rows ---
  if (plan.passages.length === 0) {
    root.appendChild(
      emptyState(
        tr('memory.ui.verses.emptyAll', 'No verses yet.'),
        tr('memory.ui.verses.emptyAllHint', 'Add a verse, or begin with a starter set.'),
        button(tr('memory.ui.verses.addVerse', 'Add verse'), addVerse, { class: 'sm-btn sm-btn-primary' }),
      ),
    );
  } else if (shown.length === 0) {
    root.appendChild(
      emptyState(
        tr('memory.ui.verses.emptyList', 'No verses in this list yet.'),
        tr('memory.ui.verses.emptyListHint', 'Add one with "Add verse".'),
      ),
    );
  } else {
    const showList = filter === 'all' && lists.length > 1;
    const derived = deriveRows(plan, shown, filter, now, reciteShown);
    const ctx: RowCtx = { host, lists, listName, now, showList, reciteShown, derived, byId: new Map() };
    const list = el('ul', { class: 'sm-list sm-verse-rows', attrs: { 'aria-label': tr('memory.ui.verses.rowsLabel', 'Your verses') } });
    installRowDelegation(list, ctx);
    renderRowsChunked(list, ctx, view.highlight);
    root.appendChild(list);
  }

  root.appendChild(renderStarters(host, plan, plan.passages.length === 0));
  return root;
}

function renderProgress(shown: readonly PassageView[]): HTMLElement {
  const p = overallProgress(shown);
  const label = tr('memory.ui.verses.progressActivities', '{percent}% of activities complete · {learned} of {verses} verses learned', {
    percent: p.percent,
    learned: p.versesLearned,
    verses: p.verses,
  });
  return el('div', { class: 'sm-verses-progress' }, [
    el(
      'div',
      {
        class: 'sm-bar sm-progress-bar',
        attrs: {
          role: 'progressbar',
          'aria-label': tr('memory.ui.verses.progressName', 'Overall progress'),
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': String(p.percent),
          'aria-valuetext': label,
        },
      },
      [el('div', { class: 'sm-bar-fill sm-progress-fill', style: { width: `${p.percent}%` } })],
    ),
    el('p', { class: 'sm-progress-text', text: label }),
  ]);
}

function renderPicker(host: PanelHost, plan: PlanView, filter: 'all' | number): HTMLElement {
  const countOf = (id: number): number => plan.passages.filter((pv) => pv.passage.collectionId === id).length;
  const select = el('select', { class: 'sm-select sm-list-picker', id: 'sm-verses-list' });
  select.appendChild(el('option', { text: tr('memory.ui.verses.listAll', '(All)'), value: 'all' }));
  for (const list of plan.lists) {
    select.appendChild(
      el('option', { text: tr('memory.ui.verses.chipList', '{name} ({count})', { name: list.name, count: countOf(list.id) }), value: String(list.id) }),
    );
  }
  select.value = String(filter);
  select.addEventListener('change', () => {
    host.go({ type: 'goVerses', list: select.value === 'all' ? 'all' : Number(select.value) });
  });
  return el('div', { class: 'sm-verses-picker' }, [
    el('label', { class: 'sm-label sm-label-inline', text: tr('memory.ui.verses.listLabel', 'List:'), attrs: { for: 'sm-verses-list' } }),
    select,
  ]);
}

function renderStarters(host: PanelHost, plan: PlanView, open: boolean): HTMLElement {
  const details = el('details', { class: 'sm-verses-starters' }, [
    el('summary', { text: tr('memory.ui.verses.starterSets', 'Starter sets') }),
    el('p', { class: 'sm-hint', text: tr('memory.ui.verses.starterHint', 'A ready-made list of well-known verses. Each makes its own list.') }),
    renderStarterChips(host, plan),
  ]);
  if (open) details.open = true;
  return details;
}

/** Rows painted before the first frame; the rest follow in chunks. */
const FIRST_ROWS = 40;
const CHUNK_ROWS = 60;

interface Derived {
  sorted: PassageView[];
  blocks: Map<number, ActivityBlock[]>;
}

interface RowCtx {
  host: PanelHost;
  lists: ListSummary[];
  listName: Map<number, string>;
  now: number;
  showList: boolean;
  reciteShown: boolean;
  derived: Derived;
  /** Verses of the rows built so far, by passage id (for the delegated handlers). */
  byId: Map<number, PassageView>;
}

/** The sorted rows and their blocks, computed once per cache version (plan object), filter and minute. */
const derivedCache = new WeakMap<PlanView, Map<string, Derived>>();

function deriveRows(
  plan: PlanView,
  shown: readonly PassageView[],
  filter: 'all' | number,
  now: number,
  reciteShown: boolean,
): Derived {
  let perPlan = derivedCache.get(plan);
  if (!perPlan) derivedCache.set(plan, (perPlan = new Map()));
  const key = `${filter}|${reciteShown ? 1 : 0}|${Math.floor(now / 60_000)}`;
  let hit = perPlan.get(key);
  if (!hit) {
    if (perPlan.size > 24) perPlan.clear();
    perPlan.set(key, (hit = { sorted: sortByNeed(shown, now), blocks: new Map() }));
  }
  return hit;
}

function blocksOf(ctx: RowCtx, pv: PassageView): ActivityBlock[] {
  let b = ctx.derived.blocks.get(pv.passage.id);
  if (!b) ctx.derived.blocks.set(pv.passage.id, (b = activityBlocks(pv, { reciteShown: ctx.reciteShown })));
  return b;
}

/** One set of listeners for the whole list instead of several per row. */
function installRowDelegation(list: HTMLElement, ctx: RowCtx): void {
  const rowOf = (t: EventTarget | null): { pv: PassageView; target: Element } | null => {
    const target = t instanceof Element ? t : null;
    const li = target?.closest('li.sm-verse-row');
    const pv = li ? ctx.byId.get(Number(li.getAttribute('data-passage-id'))) : undefined;
    return target && pv ? { pv, target } : null;
  };
  list.addEventListener('click', (ev) => {
    const hit = rowOf(ev.target);
    if (!hit) return;
    const { pv, target } = hit;
    const blockBtn = target.closest('.sm-block-btn');
    if (blockBtn) {
      const block = blocksOf(ctx, pv).find((b) => b.rung === blockBtn.getAttribute('data-rung'));
      if (block) startBlock(ctx.host, pv, block);
      return;
    }
    if (target.closest('.sm-verse-ref')) {
      ctx.host.go({ type: 'goVerse', passageId: pv.passage.id });
      return;
    }
    const lazy = target.closest('.sm-menu-lazy');
    if (lazy) {
      // Build the real menu on first use, then press its trigger so it opens as usual.
      const real = menu({
        label: tr('memory.ui.verses.rowMenu', 'Actions for {reference}', { reference: pv.passage.reference }),
        items: verseMenuItems(ctx.host, pv, ctx.lists, { practice: true, open: true, onRemoved: () => ctx.host.reload() }),
      });
      lazy.replaceWith(real);
      real.querySelector<HTMLElement>('.sm-menu-btn')?.click();
    }
  });
  list.addEventListener('keydown', blocksKeydown);
  list.addEventListener('focusin', blocksFocusin);
  // `toggle` does not bubble; capture it to fill a row's text summary the first time it opens.
  list.addEventListener(
    'toggle',
    (ev) => {
      const details = ev.target instanceof Element && ev.target.matches('details.sm-block-summary') ? ev.target : null;
      const hit = details ? rowOf(details) : null;
      if (details && hit) fillActivitySummary(details, blocksOf(ctx, hit.pv));
    },
    true,
  );
}

/** Builds the first rows now and the rest in later frames; stops if the list is replaced meanwhile. */
function renderRowsChunked(list: HTMLElement, ctx: RowCtx, highlightId: number | undefined): void {
  const all = ctx.derived.sorted;
  const total = all.length;
  const hi = highlightId === undefined ? -1 : all.findIndex((pv) => pv.passage.id === highlightId);
  let next = 0;
  const build = (until: number): void => {
    const frag = document.createDocumentFragment();
    for (; next < Math.min(until, total); next++) {
      const pv = all[next]!;
      ctx.byId.set(pv.passage.id, pv);
      const li = renderRow(ctx, pv, highlightId === pv.passage.id);
      li.setAttribute('aria-setsize', String(total));
      li.setAttribute('aria-posinset', String(next + 1));
      frag.appendChild(li);
    }
    list.appendChild(frag);
  };
  build(Math.max(FIRST_ROWS, hi + 1));
  if (next >= total || typeof requestAnimationFrame !== 'function') {
    build(total);
    return;
  }
  let wasConnected = false;
  const step = (): void => {
    if (list.isConnected) wasConnected = true;
    else if (wasConnected) return; // the screen was replaced (filter change, tab switch): stop
    build(next + CHUNK_ROWS);
    if (next < total) requestAnimationFrame(step);
  };
  // Skip the frame that is being measured / painted, then fill in.
  requestAnimationFrame(() => {
    wasConnected = list.isConnected;
    requestAnimationFrame(step);
  });
}

function renderRow(ctx: RowCtx, pv: PassageView, highlighted: boolean): HTMLElement {
  const { host, listName, now, showList } = ctx;
  const info = verseStatus(pv, now);
  const ref = pv.passage.reference;
  const blocks = blocksOf(ctx, pv);

  const open = el('button', {
    class: 'sm-verse-ref',
    text: ref,
    type: 'button',
    attrs: { 'aria-label': tr('memory.ui.verses.openRef', 'Open {reference}', { reference: ref }) },
  });

  const details = [nextReviewText(info, now)];
  if (showList) details.push(listName.get(pv.passage.collectionId) ?? '');

  const menuLabel = tr('memory.ui.verses.rowMenu', 'Actions for {reference}', { reference: ref });
  // A stand-in trigger; the real menu (five buttons) is built when it is first pressed.
  const lazyMenu = el('div', { class: 'sm-menu sm-menu-lazy' }, [
    el(
      'button',
      {
        class: 'sm-btn sm-btn-quiet sm-btn-small sm-menu-btn',
        type: 'button',
        title: menuLabel,
        attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': menuLabel },
      },
      [el('span', { class: 'sm-menu-btn-glyph', text: '\u2026', attrs: { 'aria-hidden': 'true' } })],
    ),
  ]);

  return el('li', { class: `sm-verse-row${highlighted ? ' sm-verse-row-new' : ''}`, attrs: { 'data-passage-id': String(pv.passage.id) } }, [
    el('div', { class: 'sm-verse-line' }, [
      el('div', { class: 'sm-verse-main' }, [open, translationTag(pv.passage.moduleId)]),
      renderActivityBlocks(host, pv, blocks, { delegated: true }),
      el('div', { class: 'sm-verse-acts' }, [
        highlighted
          ? button(tr('memory.ui.verses.practiceNow', 'Practice now'), () => practiceVerse(host, pv), {
              class: 'sm-btn sm-btn-primary sm-btn-small sm-verse-practice',
              attrs: { 'aria-label': tr('memory.ui.verses.practiceRefNow', 'Practice {reference} now', { reference: ref }) },
            })
          : null,
        lazyMenu,
      ]),
    ]),
    el('div', { class: 'sm-verse-details' }, [el('span', { class: 'sm-verse-detail-text', text: details.join(' · ') })]),
    renderActivitySummary(blocks, { lazy: true }),
  ]);
}
