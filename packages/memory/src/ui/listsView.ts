/**
 * The Lists section of the Settings tab (R2-12, design-r2 4e): every list with its count, create / rename / delete, the Practice focus,
 * and the selected list's verses in stored order with drag and Move up / Move down reordering.
 *
 * CALLER CONTRACT (mount.ts): `renderLists(host, all, { listId: view.listId })`
 *   - `all` is the cached all-scope plan (`host.data.get()` / `getPlan({ scope: { kind: 'all' } })`);
 *     `all.focus` ('all' | list id) says which list Today follows.
 *   - `view.listId` is the nav selection (`null` or a missing list selects the first list).
 *
 * Reordering is optimistic: the DOM moves first and `host.data.applyPlan` gets a locally reordered copy.
 * `reorderList` requests are serialized per list (a newer one waits for the one in flight) and only the
 * last reply is applied. On failure the cache is restored, `host.fail` is called and the view reloads.
 */

import type { ListSummary, PassageView, PlanView } from '../core/types';
import { button, el, focusQuietly } from './dom';
import { emptyState, menu, type MenuItem } from './components';
import { openAddVerseDialog } from './addVerseDialog';
import { createList, listRowMenuItems } from './listActions';
import type { PanelHost } from './host';
import { tr } from './i18n';
import { moveVerseMenuItems, removeVerse } from './verseActions';
import './styles/lists.css';

/** Stored order: positions first (NULL last), then added time, then id. */
export function storedOrder(a: PassageView, b: PassageView): number {
  const pa = a.passage.position ?? null;
  const pb = b.passage.position ?? null;
  if (pa !== pb) {
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  }
  if (a.passage.addedAt !== b.passage.addedAt) return a.passage.addedAt - b.passage.addedAt;
  return a.passage.id - b.passage.id;
}

interface ReorderState {
  sending: boolean;
  queued: number[] | null;
  /** The plan before the first optimistic move of this burst (restored on failure). */
  original: PlanView | null;
}
const reorderStates = new Map<number, ReorderState>();

/** Focus to put back after the next render of the same list (a re-render must not lose the control). */
let pendingFocus: { passageId: number; control: 'up' | 'down' | 'handle' } | null = null;

function stateFor(listId: number): ReorderState {
  let s = reorderStates.get(listId);
  if (!s) {
    s = { sending: false, queued: null, original: null };
    reorderStates.set(listId, s);
  }
  return s;
}

/** A copy of `plan` where the passages of `listId` take `ids` order, with positions renumbered. */
export function reorderedPlan(plan: PlanView, listId: number, ids: readonly number[]): PlanView {
  const slots: number[] = [];
  const byId = new Map<number, PassageView>();
  plan.passages.forEach((pv, i) => {
    if (pv.passage.collectionId === listId) {
      slots.push(i);
      byId.set(pv.passage.id, pv);
    }
  });
  const ordered: PassageView[] = [];
  for (const id of ids) {
    const pv = byId.get(id);
    if (pv) {
      ordered.push(pv);
      byId.delete(id);
    }
  }
  for (const pv of [...byId.values()].sort(storedOrder)) ordered.push(pv);
  const passages = plan.passages.slice();
  slots.forEach((slot, i) => {
    const pv = ordered[i]!;
    passages[slot] = { ...pv, passage: { ...pv.passage, position: i } };
  });
  return { ...plan, passages };
}

/** A stand-in "..." trigger; the real menu is built when it is first pressed (a long Lists tab stays cheap). */
function lazyMenuStub(label: string): HTMLElement {
  return el('div', { class: 'sm-menu sm-menu-lazy' }, [
    el(
      'button',
      {
        class: 'sm-btn sm-btn-quiet sm-btn-small sm-menu-btn',
        type: 'button',
        attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label },
      },
      [el('span', { class: 'sm-menu-btn-glyph', text: '\u2026', attrs: { 'aria-hidden': 'true' } })],
    ),
  ]);
}

/** Replaces the stub with the real menu and presses its trigger so it opens as usual. */
function openLazy(stub: Element, label: string, items: MenuItem[]): void {
  const real = menu({ label, items });
  stub.replaceWith(real);
  real.querySelector<HTMLElement>('.sm-menu-btn')?.click();
}

function failure(host: PanelHost, message: string): void {
  (host.fail ?? host.announce).call(host, message);
}

export function renderLists(host: PanelHost, all: PlanView, view: { listId: number | null }): HTMLElement {
  const lists = all.lists;
  const focus = all.focus ?? 'all';
  const selected = lists.find((l) => l.id === view.listId) ?? lists[0] ?? null;

  const root = el('section', { class: 'sm-block sm-lists' });
  root.appendChild(el('h2', { class: 'sm-block-title sm-lists-title', text: tr('memory.ui.lists.title', 'Lists'), attrs: { tabindex: '-1' } }));
  const live = el('div', { class: 'sm-sr-only', attrs: { 'aria-live': 'polite', role: 'status' } });

  const cols = el('div', { class: 'sm-lists-cols' }, [
    renderIndex(host, all, lists, selected, focus),
    selected ? renderSelected(host, all, lists, selected, live) : null,
  ]);
  root.appendChild(cols);
  root.appendChild(live);

  if (pendingFocus) {
    const target = pendingFocus;
    pendingFocus = null;
    setTimeout(() => {
      if (!root.isConnected) return;
      const row = root.querySelector(`[data-passage-id="${target.passageId}"]`);
      const sel = target.control === 'up' ? '.sm-move-up' : target.control === 'down' ? '.sm-move-down' : '.sm-order-ref';
      const node = row?.querySelector<HTMLButtonElement>(sel);
      focusQuietly(node && !node.disabled ? node : (row?.querySelector<HTMLElement>('.sm-order-ref') ?? null));
    }, 0);
  }
  return root;
}

function renderIndex(
  host: PanelHost,
  _all: PlanView,
  lists: ListSummary[],
  selected: ListSummary | null,
  focus: 'all' | number,
): HTMLElement {
  const select = (id: number): void => host.go({ type: 'goLists', listId: id });
  const rows = lists.map((list) => {
    const focused = focus === list.id;
    const on = selected?.id === list.id;
    const pick = button('', () => select(list.id), {
      class: 'sm-list-pick',
      attrs: on ? { 'aria-current': 'true' } : {},
    });
    pick.append(
      el('span', { class: 'sm-list-name', text: list.name }),
      el('span', {
        class: 'sm-list-count',
        text: tr('memory.ui.lists.count', '{count, plural, one {# verse} other {# verses}}', { count: list.passageCount }),
      }),
    );
    if (focused) pick.append(el('span', { class: 'sm-list-today', text: tr('memory.ui.lists.focusTag', 'Practice focus') }));
    return el('li', { class: `sm-list-row${on ? ' sm-list-row-on' : ''}`, attrs: { 'data-list-id': String(list.id) } }, [
      pick,
      lazyMenuStub(tr('memory.ui.verses.listOptions', 'Options for {name}', { name: list.name })),
    ]);
  });


  const rowsUl = el('ul', { class: 'sm-list-rows', attrs: { 'aria-label': tr('memory.ui.verses.listsLabel', 'Lists') } }, rows);
  rowsUl.addEventListener('click', (ev) => {
    const stub = ev.target instanceof Element ? ev.target.closest('.sm-menu-lazy') : null;
    const id = Number(stub?.closest('li')?.getAttribute('data-list-id'));
    const list = lists.find((l) => l.id === id);
    if (!stub || !list) return;
    openLazy(
      stub,
      tr('memory.ui.verses.listOptions', 'Options for {name}', { name: list.name }),
      listRowMenuItems(host, list, lists, focus === list.id),
    );
  });

  return el('div', { class: 'sm-lists-index' }, [
    rowsUl,
    el('div', { class: 'sm-lists-tools' }, [
      button(tr('memory.ui.verses.newListChip', '+ New list'), () => createList(host, (id) => host.go({ type: 'goLists', listId: id })), {
        class: 'sm-btn sm-btn-quiet',
      }),
      button(tr('memory.ui.lists.browseStarters', 'Browse starter sets'), () => host.go({ type: 'goStarters' }), {
        class: 'sm-btn sm-btn-quiet sm-lists-browse',
      }),
    ]),
  ]);
}

function renderSelected(host: PanelHost, all: PlanView, lists: ListSummary[], list: ListSummary, live: HTMLElement): HTMLElement {
  const items = all.passages.filter((pv) => pv.passage.collectionId === list.id).sort(storedOrder);

  const head = el('div', { class: 'sm-list-verses-head' }, [
    el('h3', { class: 'sm-list-verses-title', text: list.name }),
    button(
      tr('memory.ui.lists.addVerse', 'Add verse'),
      () =>
        openAddVerseDialog(host, {
          lists,
          listId: list.id,
          onAdded: (passage) => {
            if (passage.collectionId !== list.id) host.go({ type: 'goLists', listId: passage.collectionId });
          },
        }),
      { class: 'sm-btn sm-btn-primary sm-btn-small' },
    ),
  ]);

  if (items.length === 0) {
    return el('div', { class: 'sm-list-verses' }, [
      head,
      emptyState(tr('memory.ui.verses.emptyList', 'No verses in this list yet.'), tr('memory.ui.lists.emptyHint', 'Use Add verse, or a starter set.')),
    ]);
  }

  const ol = el('ol', {
    class: 'sm-order-rows',
    attrs: { 'aria-label': tr('memory.ui.lists.versesIn', 'Verses in {name}, in practice order', { name: list.name }) },
  });
  const rowOf = new Map<number, HTMLElement>();
  const ref = new Map(items.map((pv) => [pv.passage.id, pv.passage.reference] as const));

  const idsInDom = (): number[] => Array.from(ol.children).map((c) => Number((c as HTMLElement).dataset.passageId));

  const refreshButtons = (): void => {
    const kids = Array.from(ol.children) as HTMLElement[];
    kids.forEach((row, i) => {
      const up = row.querySelector<HTMLButtonElement>('.sm-move-up');
      const down = row.querySelector<HTMLButtonElement>('.sm-move-down');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === kids.length - 1;
    });
  };

  const announceMove = (id: number): void => {
    const pos = idsInDom().indexOf(id) + 1;
    live.textContent = tr('memory.ui.lists.movedTo', '{reference} moved to position {position} of {total}.', {
      reference: ref.get(id) ?? '',
      position: pos,
      total: items.length,
    });
  };

  const commit = (id: number, control: 'up' | 'down' | 'handle'): void => {
    refreshButtons();
    announceMove(id);
    pendingFocus = { passageId: id, control };
    sendOrder(host, list.id, idsInDom());
  };

  const step = (pv: PassageView, dir: -1 | 1): void => {
    const row = rowOf.get(pv.passage.id)!;
    const other = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!other) return;
    if (dir < 0) ol.insertBefore(row, other);
    else ol.insertBefore(other, row);
    const control = dir < 0 ? 'up' : 'down';
    commit(pv.passage.id, control);
    const btn = row.querySelector<HTMLButtonElement>(dir < 0 ? '.sm-move-up' : '.sm-move-down');
    focusQuietly(btn && !btn.disabled ? btn : row.querySelector<HTMLButtonElement>(dir < 0 ? '.sm-move-down' : '.sm-move-up'));
  };

  for (const pv of items) {
    const reference = pv.passage.reference;
    const row = el('li', { class: 'sm-order-row', attrs: { 'data-passage-id': String(pv.passage.id) } }, [
      el('span', { class: 'sm-drag-handle', text: '⋮⋮', attrs: { 'aria-hidden': 'true' }, style: { touchAction: 'none' } }),
      button(reference, () => undefined, {
        class: 'sm-order-ref',
        attrs: { 'aria-label': tr('memory.ui.verses.openRef', 'Open {reference}', { reference }) },
      }),
      el('div', { class: 'sm-order-moves' }, [
        button('↑', () => undefined, {
          class: 'sm-btn sm-btn-quiet sm-btn-small sm-move-up',
          attrs: { 'aria-label': tr('memory.ui.lists.moveUp', 'Move {reference} up', { reference }) },
        }),
        button('↓', () => undefined, {
          class: 'sm-btn sm-btn-quiet sm-btn-small sm-move-down',
          attrs: { 'aria-label': tr('memory.ui.lists.moveDown', 'Move {reference} down', { reference }) },
        }),
      ]),
      lazyMenuStub(tr('memory.ui.verses.rowMenu', 'Actions for {reference}', { reference })),
    ]);
    rowOf.set(pv.passage.id, row);
    ol.appendChild(row);
  }

  // One set of listeners for the whole list (click and pointer drag), instead of several per row.
  const byId = new Map(items.map((pv) => [pv.passage.id, pv] as const));
  const hitRow = (t: EventTarget | null): { pv: PassageView; row: HTMLElement; target: Element } | null => {
    const target = t instanceof Element ? t : null;
    const row = target?.closest<HTMLElement>('li.sm-order-row') ?? null;
    const pv = row ? byId.get(Number(row.dataset.passageId)) : undefined;
    return target && row && pv ? { pv, row, target } : null;
  };
  ol.addEventListener('click', (ev) => {
    const hit = hitRow(ev.target);
    if (!hit) return;
    const { pv, target } = hit;
    if (target.closest('.sm-move-up')) step(pv, -1);
    else if (target.closest('.sm-move-down')) step(pv, 1);
    else if (target.closest('.sm-order-ref')) host.go({ type: 'goVerse', passageId: pv.passage.id });
    else {
      const stub = target.closest('.sm-menu-lazy');
      if (stub) {
        openLazy(stub, tr('memory.ui.verses.rowMenu', 'Actions for {reference}', { reference: pv.passage.reference }), [
          ...moveVerseMenuItems(host, pv, lists),
          { label: tr('memory.ui.verses.remove', 'Remove'), onClick: () => removeVerse(host, pv, () => host.reload()) },
        ]);
      }
    }
  });
  attachDrag(ol, (id) => commit(id, 'handle'));
  refreshButtons();

  return el('div', { class: 'sm-list-verses' }, [head, ol]);
}

/** Pointer-event dragging of a row within `ol` by its handle (delegated: one listener set for the list). Calls `onDrop(id)` if the order changed. */
function attachDrag(ol: HTMLElement, onDrop: (passageId: number) => void): void {
  let startOrder = '';
  let drag: { row: HTMLElement; handle: HTMLElement } | null = null;
  const order = (): string => Array.from(ol.children).map((c) => (c as HTMLElement).dataset.passageId).join(',');

  ol.addEventListener('pointerdown', (ev: PointerEvent) => {
    const handle = ev.target instanceof Element ? ev.target.closest<HTMLElement>('.sm-drag-handle') : null;
    const row = handle?.closest<HTMLElement>('li.sm-order-row') ?? null;
    if (!handle || !row) return;
    if (ev.button !== undefined && ev.button !== 0) return;
    drag = { row, handle };
    startOrder = order();
    row.classList.add('sm-order-row-drag');
    try {
      handle.setPointerCapture?.(ev.pointerId);
    } catch {
      /* capture is best effort */
    }
    ev.preventDefault();
  });
  ol.addEventListener('pointermove', (ev: PointerEvent) => {
    if (!drag) return;
    const row = drag.row;
    for (const other of Array.from(ol.children) as HTMLElement[]) {
      if (other === row) continue;
      const r = other.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const before = other.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING; // other is before row
      if (before && ev.clientY < mid) {
        ol.insertBefore(row, other);
        break;
      }
      if (!before && ev.clientY > mid) {
        ol.insertBefore(row, other.nextSibling);
        break;
      }
    }
  });
  const end = (): void => {
    if (!drag) return;
    const { row } = drag;
    drag = null;
    row.classList.remove('sm-order-row-drag');
    if (order() !== startOrder) onDrop(Number(row.dataset.passageId));
  };
  // A cancelled gesture puts the rows back in their starting order and sends nothing.
  const cancel = (): void => {
    if (!drag) return;
    const { row } = drag;
    drag = null;
    row.classList.remove('sm-order-row-drag');
    const byId = new Map((Array.from(ol.children) as HTMLElement[]).map((c) => [c.dataset.passageId ?? '', c] as const));
    for (const id of startOrder.split(',')) {
      const child = byId.get(id);
      if (child) ol.appendChild(child);
    }
  };
  ol.addEventListener('pointerup', end);
  ol.addEventListener('pointercancel', cancel);
}

/** Optimistic apply, then a serialized request; only the last reply is applied. */
function sendOrder(host: PanelHost, listId: number, ids: number[]): void {
  const st = stateFor(listId);
  const cur = host.data?.get() ?? null;
  if (cur) {
    if (!st.original) st.original = cur;
    host.data?.applyPlan(reorderedPlan(cur, listId, ids));
  }
  st.queued = ids;
  if (st.sending) return;
  st.sending = true;
  void (async () => {
    try {
      while (st.queued) {
        const next = st.queued;
        st.queued = null;
        let reply: { ok: true; data: PlanView } | { ok: false; error: string };
        try {
          reply = await host.request({ type: 'reorderList', collectionId: listId, passageIds: next });
        } catch (e) {
          failure(host, e instanceof Error ? e.message : String(e));
          if (st.original) host.data?.applyPlan(st.original);
          host.reload();
          st.original = null;
          st.queued = null;
          break;
        }
        if (st.queued) continue; // a newer order is waiting: this reply is stale
        if (reply.ok) {
          host.data?.applyPlan(reply.data);
        } else {
          failure(host, reply.error);
          if (st.original) host.data?.applyPlan(st.original);
          host.reload();
        }
        st.original = null;
      }
    } finally {
      st.sending = false;
    }
  })();
}
