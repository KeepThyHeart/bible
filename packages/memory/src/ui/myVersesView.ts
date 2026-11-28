/**
 * My verses (R2-7..R2-10): an overall progress bar, one "List:" picker, and one compact table of verses
 * sorted by need: one line per verse, one square column per activity.
 *
 * CALLER CONTRACT: `renderMyVerses(host, plan, view)`.
 *   - `plan` is the cached all-scope plan (`host.data.get()`); this view never fetches and a filter
 *     change is just a re-render from that cache (`goVerses`).
 *   - `view.list`: 'all' or a list id. A list id that no longer exists shows all lists.
 *   - `view.highlight`: a just-added verse id (shown highlighted with "Practice now").
 *
 * The "..." menu keeps Practice now / Move to list / Show in Bible / Remove. List management and the
 * focus control live on the Lists tab; starter sets have their own screen (`goStarters`).
 */

import { activityBlocks, BLOCK_RUNGS, overallProgress, sortByNeed } from '../core/progress';
import { reciteEnabled } from '../core/features';
import { verseStatus } from '../core/today';
import type { ListSummary, PassageView, PlanView, Rung } from '../core/types';
import type { ActivityBlock } from '../core/progress';
import { blocksFocusin, blocksKeydown, blockTag, notNeededBlock, renderBlockLegend, renderBlockSquare, startBlock } from './activityBlocks';
import { openAddVerseDialog } from './addVerseDialog';
import { button, el } from './dom';
import { emptyState, menu, translationTag } from './components';
import { RUNG_LABEL } from './format';
import type { PanelHost } from './host';
import { tr } from './i18n';
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

  // The shell draws the page h1 and the tab bar (which already says "My verses"); this h2 is the focus target.
  root.appendChild(
    el('h2', {
      class: 'sm-screen-title sm-verses-title sm-sr-only',
      text: tr('memory.ui.verses.title', 'My verses'),
      attrs: { tabindex: '-1' },
    }),
  );

  const shown = plan.passages.filter((pv) => filter === 'all' || pv.passage.collectionId === filter);

  // --- overall progress (follows the List filter) ---
  if (shown.length > 0) root.appendChild(renderProgress(shown));

  // --- the one List picker, and Add verse ---
  root.appendChild(
    el('div', { class: 'sm-verses-head' }, [
      renderPicker(host, plan, filter),
      button(tr('memory.ui.verses.addVerse', 'Add verse'), addVerse, { class: 'sm-btn sm-btn-primary sm-verses-add-btn' }),
    ]),
  );

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
    const ctx: RowCtx = { host, lists, listName, now, showList, derived, byId: new Map() };
    const table = el('table', {
      class: 'kth-table sm-verses-table',
      attrs: {
        'aria-label': tr('memory.ui.verses.rowsLabel', 'Your verses'),
        'aria-rowcount': String(derived.sorted.length + 1),
      },
    });
    table.appendChild(renderHead(ctx));
    const body = el('tbody');
    table.appendChild(body);
    installRowDelegation(body, ctx);
    renderRowsChunked(body, ctx, view.highlight);
    root.appendChild(el('div', { class: 'kth-table-wrap sm-verses-table-wrap' }, [table]));
    root.appendChild(renderBlockLegend());
  }

  root.appendChild(
    el('div', { class: 'sm-verses-starters' }, [
      button(tr('memory.ui.lists.browseStarters', 'Browse starter sets'), () => host.go({ type: 'goStarters' }), {
        class: 'sm-btn sm-btn-quiet sm-verses-starters-btn',
      }),
    ]),
  );
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

/** Rows painted before the first frame; the rest follow in chunks. */
const FIRST_ROWS = 40;
const CHUNK_ROWS = 60;

interface Derived {
  sorted: PassageView[];
  blocks: Map<number, Map<Rung, ActivityBlock>>;
  /** The activity columns: the union of the shown rows' blocks, in `BLOCK_RUNGS` order. */
  columns: Rung[];
}

interface RowCtx {
  host: PanelHost;
  lists: ListSummary[];
  listName: Map<number, string>;
  now: number;
  showList: boolean;
  derived: Derived;
  /** Verses of the rows built so far, by passage id (for the delegated handlers). */
  byId: Map<number, PassageView>;
}

/** The sorted rows, their blocks and the columns, computed once per cache version (plan object), filter and minute. */
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
    const blocks = new Map<number, Map<Rung, ActivityBlock>>();
    const used = new Set<Rung>();
    for (const pv of shown) {
      const byRung = new Map<Rung, ActivityBlock>();
      for (const b of activityBlocks(pv, { reciteShown })) {
        byRung.set(b.rung, b);
        used.add(b.rung);
      }
      blocks.set(pv.passage.id, byRung);
    }
    hit = { sorted: sortByNeed(shown, now), blocks, columns: BLOCK_RUNGS.filter((r) => used.has(r)) };
    perPlan.set(key, hit);
  }
  return hit;
}

function blockOf(ctx: RowCtx, pv: PassageView, rung: Rung): ActivityBlock {
  return ctx.derived.blocks.get(pv.passage.id)?.get(rung) ?? notNeededBlock(rung);
}

function renderHead(ctx: RowCtx): HTMLElement {
  const th = (cls: string, children: Array<Node | string>, attrs: Record<string, string> = {}): HTMLElement =>
    el('th', { class: `kth-table__head ${cls}`, attrs: { scope: 'col', ...attrs } }, children);
  const cells: HTMLElement[] = [th('sm-verses-col-ref', [tr('memory.ui.verses.colReference', 'Reference')])];
  if (ctx.showList) cells.push(th('sm-verses-col-list', [tr('memory.ui.verses.colList', 'List')]));
  for (const rung of ctx.derived.columns) {
    const name = RUNG_LABEL[rung];
    cells.push(
      th('sm-verses-col-block', [el('span', { text: blockTag(rung), attrs: { 'aria-hidden': 'true' } }), el('span', { class: 'sm-sr-only', text: name })], {
        title: name,
        'data-rung': rung,
      }),
    );
  }
  cells.push(th('sm-verses-col-next', [tr('memory.ui.verses.colNext', 'Next review')]));
  cells.push(th('sm-verses-col-acts', [el('span', { class: 'sm-sr-only', text: tr('memory.ui.verses.colActions', 'Actions') })]));
  return el('thead', {}, [el('tr', { attrs: { 'aria-rowindex': '1' } }, cells)]);
}

/** One set of listeners for the whole table body instead of several per row. */
function installRowDelegation(body: HTMLElement, ctx: RowCtx): void {
  body.addEventListener('click', (ev) => {
    const target = ev.target instanceof Element ? ev.target : null;
    const row = target?.closest('tr.sm-verse-row');
    const pv = row ? ctx.byId.get(Number(row.getAttribute('data-passage-id'))) : undefined;
    if (!target || !pv) return;
    const blockBtn = target.closest('.sm-block-btn');
    if (blockBtn) {
      startBlock(ctx.host, pv, blockOf(ctx, pv, blockBtn.getAttribute('data-rung') as Rung));
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
  body.addEventListener('keydown', blocksKeydown);
  body.addEventListener('focusin', blocksFocusin);
}

/** Builds the first rows now and the rest in later frames; stops if the table is replaced meanwhile. */
function renderRowsChunked(body: HTMLElement, ctx: RowCtx, highlightId: number | undefined): void {
  const all = ctx.derived.sorted;
  const total = all.length;
  const hi = highlightId === undefined ? -1 : all.findIndex((pv) => pv.passage.id === highlightId);
  let next = 0;
  const build = (until: number): void => {
    const frag = document.createDocumentFragment();
    for (; next < Math.min(until, total); next++) {
      const pv = all[next]!;
      ctx.byId.set(pv.passage.id, pv);
      const tr = renderRow(ctx, pv, highlightId === pv.passage.id);
      tr.setAttribute('aria-rowindex', String(next + 2));
      frag.appendChild(tr);
    }
    body.appendChild(frag);
  };
  build(Math.max(FIRST_ROWS, hi + 1));
  if (next >= total || typeof requestAnimationFrame !== 'function') {
    build(total);
    return;
  }
  let wasConnected = false;
  const step = (): void => {
    if (body.isConnected) wasConnected = true;
    else if (wasConnected) return; // the screen was replaced (filter change, tab switch): stop
    build(next + CHUNK_ROWS);
    if (next < total) requestAnimationFrame(step);
  };
  // Skip the frame that is being measured / painted, then fill in.
  requestAnimationFrame(() => {
    wasConnected = body.isConnected;
    requestAnimationFrame(step);
  });
}

function renderRow(ctx: RowCtx, pv: PassageView, highlighted: boolean): HTMLElement {
  const { host, listName, now, showList } = ctx;
  const ref = pv.passage.reference;

  const open = el('button', {
    class: 'sm-verse-ref',
    text: ref,
    type: 'button',
    // The reference may be cut short with an ellipsis to keep the row on one line; the title shows it whole.
    title: ref,
    attrs: { 'aria-label': tr('memory.ui.verses.openRef', 'Open {reference}', { reference: ref }) },
  });

  const cells: HTMLElement[] = [
    el('th', { class: 'kth-table__cell sm-verses-col-ref', attrs: { scope: 'row', 'data-nowrap': '' } }, [
      el('span', { class: 'sm-verse-main' }, [open, translationTag(pv.passage.moduleId)]),
    ]),
  ];
  if (showList) {
    const name = listName.get(pv.passage.collectionId) ?? '';
    cells.push(
      el('td', { class: 'kth-table__cell sm-verses-col-list', attrs: { 'data-muted': '', 'data-nowrap': '' } }, [
        el('span', { class: 'sm-verses-list-name', text: name, title: name }),
      ]),
    );
  }
  let tabStopGiven = false;
  for (const rung of ctx.derived.columns) {
    const block = blockOf(ctx, pv, rung);
    const tabStop = !tabStopGiven && block.startable;
    if (tabStop) tabStopGiven = true;
    cells.push(el('td', { class: 'kth-table__cell sm-verses-col-block' }, [renderBlockSquare(block, { tabStop })]));
  }
  cells.push(
    el('td', {
      class: 'kth-table__cell sm-verses-col-next',
      text: nextReviewText(verseStatus(pv, now), now),
      attrs: { 'data-muted': '', 'data-nowrap': '' },
    }),
  );

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
      [el('span', { class: 'sm-menu-btn-glyph', text: '…', attrs: { 'aria-hidden': 'true' } })],
    ),
  ]);
  cells.push(
    el('td', { class: 'kth-table__cell sm-verses-col-acts', attrs: { 'data-nowrap': '' } }, [
      el('span', { class: 'sm-verse-acts' }, [
        highlighted
          ? button(tr('memory.ui.verses.practiceNow', 'Practice now'), () => practiceVerse(host, pv), {
              class: 'sm-btn sm-btn-primary sm-btn-small sm-verse-practice',
              attrs: { 'aria-label': tr('memory.ui.verses.practiceRefNow', 'Practice {reference} now', { reference: ref }) },
            })
          : null,
        lazyMenu,
      ]),
    ]),
  );

  return el(
    'tr',
    { class: `sm-verse-row sm-blocks${highlighted ? ' sm-verse-row-new' : ''}`, attrs: { 'data-passage-id': String(pv.passage.id) } },
    cells,
  );
}
