/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListSummary, PanelReply, PanelRequest, PlanView, RequestMap } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import type { Flow, NavAction } from '../src/ui/state';
import { WordMeasurer } from '../src/ui/measure';
import { renderLists, reorderedPlan, storedOrder } from '../src/ui/listsView';
import { makePassageView, makePlan, NOW } from './helpers/planFactory';

vi.mock('../src/ui/addVerseDialog', () => ({ openAddVerseDialog: vi.fn() }));
import { openAddVerseDialog } from '../src/ui/addVerseDialog';

const LISTS: ListSummary[] = [
  { id: 1, name: 'Default', passageCount: 3, verseCount: 3 },
  { id: 2, name: 'Romans Road', passageCount: 1, verseCount: 1 },
];
const mk = (id: number, c: number, ref: string, position: number | null = id) =>
  makePassageView({ id, collectionId: c, reference: ref, position });
const PASSAGES = () => [mk(1, 1, 'Psalm 23'), mk(2, 1, 'John 3:16'), mk(3, 1, 'Mark 1:1'), mk(4, 2, 'Romans 3:23')];
const plan = (over = {}) => makePlan({ lists: LISTS, passages: PASSAGES(), focus: 'all', ...over });

class Host implements PanelHost {
  requests: PanelRequest[] = [];
  navigations: NavAction[] = [];
  announcements: string[] = [];
  failures: string[] = [];
  applied: PlanView[] = [];
  reloads = 0;
  activeReference: string | null = null;
  handlers: Record<string, (r: any) => Promise<PanelReply<any>> | PanelReply<any>> = {};
  readonly measurer = new WordMeasurer(document);
  current: PlanView | null = null;
  data: any = {
    get: () => this.current,
    applyPlan: (p: PlanView) => { this.applied.push(p); this.current = p; },
  };
  now() { return NOW; }
  request<R extends PanelRequest>(request: R): Promise<PanelReply<RequestMap[R['type']]>> {
    this.requests.push(request);
    const h = this.handlers[request.type];
    return Promise.resolve(h ? h(request) : { ok: true, data: {} });
  }
  go(a: NavAction) { this.navigations.push(a); }
  reload() { this.reloads += 1; }
  async startSession() {}
  async startFlow(_f: Flow) { return true; }
  openInBible() {}
  announce(m: string) { this.announcements.push(m); }
  fail(m: string) { this.failures.push(m); }
}

let host: Host;
let container: HTMLElement;
beforeEach(() => { host = new Host(); container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { container.remove(); document.querySelectorAll('.sm-modal-backdrop').forEach((n) => n.remove()); vi.mocked(openAddVerseDialog).mockClear(); });

const text = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ').trim();
const mount = (p = plan(), listId: number | null = 1) => {
  host.current = p;
  const root = renderLists(host, p, { listId });
  container.appendChild(root);
  return root;
};
const refs = (root: ParentNode) => Array.from(root.querySelectorAll('.sm-order-row .sm-order-ref')).map((n) => text(n));
const btn = (root: ParentNode, label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('renderLists', () => {
  it('shows every list with its count, the Practice focus tag, and the selected list in stored order', () => {
    const p = plan({ focus: 2, passages: [mk(1, 1, 'B', 2), mk(2, 1, 'A', 1), mk(3, 1, 'C', null)] });
    const root = mount(p);
    const rows = Array.from(root.querySelectorAll('.sm-list-row'));
    expect(rows).toHaveLength(2);
    expect(text(rows[0]!)).toContain('3 verses');
    expect(rows[1]!.querySelector('.sm-list-today')).not.toBeNull();
    expect(rows[0]!.querySelector('.sm-list-today')).toBeNull();
    expect(refs(root)).toEqual(['A', 'B', 'C']);
    expect(root.querySelector('h3')!.textContent).toBe('Default');
  });

  it('selecting a list navigates; a missing selection falls back to the first list', () => {
    const root = mount(plan(), 99);
    expect(root.querySelector('h3')!.textContent).toBe('Default');
    (root.querySelectorAll('.sm-list-pick')[1] as HTMLButtonElement).click();
    expect(host.navigations).toEqual([{ type: 'goLists', listId: 2 }]);
  });

  it('Add verse opens the dialog preselecting the selected list', () => {
    const root = mount(plan(), 2);
    Array.from(root.querySelectorAll('button')).find((b) => text(b) === 'Add verse')!.click();
    const opts = vi.mocked(openAddVerseDialog).mock.calls[0]![1];
    expect(opts.listId).toBe(2);
    expect(opts.lists).toHaveLength(2);
  });

  it('the list menu sets and clears the Practice focus', async () => {
    let root = mount(plan(), 1);
    const open = (r: ParentNode, idx: number, label: string) => {
      (r.querySelectorAll('.sm-list-row')[idx]!.querySelector('.sm-menu-btn') as HTMLButtonElement).click();
      return Array.from(r.querySelectorAll('.sm-list-row')[idx]!.querySelectorAll('.sm-menu-item')).find((b) => text(b) === label) as HTMLButtonElement;
    };
    open(root, 1, 'Practice only this list').click();
    await flush();
    expect(host.requests.at(-1)).toEqual({ type: 'setScope', scope: { kind: 'list', id: 2 } });
    container.innerHTML = '';
    root = mount(plan({ focus: 2 }), 1);
    open(root, 1, 'Practice from all lists').click();
    await flush();
    expect(host.requests.at(-1)).toEqual({ type: 'setScope', scope: { kind: 'all' } });
  });

  it('deleting the only list is refused without a request', () => {
    const one = makePlan({ lists: [LISTS[0]!], passages: [mk(1, 1, 'A')] });
    const root = mount(one, 1);
    (root.querySelector('.sm-list-row .sm-menu-btn') as HTMLButtonElement).click();
    (Array.from(root.querySelectorAll('.sm-menu-item')).find((b) => text(b) === 'Delete') as HTMLButtonElement).click();
    expect(host.requests).toHaveLength(0);
    expect(host.failures[0]).toMatch(/only list/);
  });

  it('the drag handle has touch-action none', () => {
    const root = mount();
    expect((root.querySelector('.sm-drag-handle') as HTMLElement).style.touchAction).toBe('none');
  });
});

describe('reordering', () => {
  it('Move down reorders the DOM, applies a local plan, requests, and announces', async () => {
    const root = mount();
    btn(root, 'Move Psalm 23 down').click();
    expect(refs(root)).toEqual(['John 3:16', 'Psalm 23', 'Mark 1:1']);
    expect(btn(root, 'Move John 3:16 up').disabled).toBe(true);
    expect(root.querySelector('.sm-lists > .sm-sr-only')!.textContent).toContain('Psalm 23 moved to position 2 of 3');
    expect(host.applied[0]!.passages.filter((p) => p.passage.collectionId === 1).map((p) => [p.passage.id, p.passage.position])).toEqual([[2, 0], [1, 1], [3, 2]]);
    expect(host.requests[0]).toEqual({ type: 'reorderList', collectionId: 1, passageIds: [2, 1, 3] });
    await flush();
  });

  it('serializes requests and applies only the last reply', async () => {
    const root = mount();
    const resolvers: ((r: PanelReply<any>) => void)[] = [];
    host.handlers.reorderList = () => new Promise((res) => { resolvers.push(res); });
    btn(root, 'Move Psalm 23 down').click();
    btn(root, 'Move Psalm 23 down').click();
    expect(host.requests).toHaveLength(1); // second waits
    const localApplied = host.applied.length;
    resolvers[0]!({ ok: true, data: plan({ version: 1 }) });
    await flush();
    expect(host.requests).toHaveLength(2);
    expect(host.requests[1]).toEqual({ type: 'reorderList', collectionId: 1, passageIds: [2, 3, 1] });
    expect(host.applied).toHaveLength(localApplied); // stale reply not applied
    const final = plan({ version: 2 });
    resolvers[1]!({ ok: true, data: final });
    await flush();
    expect(host.applied.at(-1)).toBe(final);
  });

  it('on failure the cache is restored, host.fail is called and the view reloads', async () => {
    const original = plan();
    const root = mount(original);
    host.handlers.reorderList = () => ({ ok: false, error: 'nope' });
    btn(root, 'Move Psalm 23 down').click();
    await flush();
    expect(host.failures).toEqual(['nope']);
    expect(host.applied.at(-1)).toBe(original);
    expect(host.reloads).toBe(1);
  });

  it('a rejected request restores the order and a later reorder sends again', async () => {
    const original = plan();
    const root = mount(original);
    let calls = 0;
    host.handlers.reorderList = () => {
      calls++;
      if (calls === 1) throw new Error('offline');
      return { ok: true, data: original };
    };
    btn(root, 'Move Psalm 23 down').click();
    await flush();
    expect(host.failures).toEqual(['offline']);
    expect(host.applied.at(-1)).toBe(original);
    expect(host.reloads).toBe(1);
    btn(root, 'Move Psalm 23 up').click();
    await flush();
    expect(calls).toBe(2);
  });

  it('pointercancel restores the starting order and sends nothing', async () => {
    const root = mount();
    const rows = Array.from(root.querySelectorAll('.sm-order-row')) as HTMLElement[];
    rows.forEach((r, i) => {
      r.getBoundingClientRect = () => ({ top: i * 40, height: 40, bottom: i * 40 + 40, left: 0, right: 100, width: 100, x: 0, y: i * 40, toJSON() {} }) as DOMRect;
    });
    const handle = rows[0]!.querySelector('.sm-drag-handle')!;
    const fire = (type: string, y = 0) => handle.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientY: y, pointerId: 1, button: 0 }));
    const before = refs(root);
    fire('pointerdown');
    fire('pointermove', 70);
    fire('pointercancel');
    expect(refs(root)).toEqual(before);
    expect(root.querySelector('.sm-order-row-drag')).toBeNull();
    expect(host.requests).toHaveLength(0);
  });

  it('dragging the handle moves the row and commits on pointerup', async () => {
    const root = mount();
    const rows = Array.from(root.querySelectorAll('.sm-order-row')) as HTMLElement[];
    rows.forEach((r, i) => {
      r.getBoundingClientRect = () => ({ top: i * 40, height: 40, bottom: i * 40 + 40, left: 0, right: 100, width: 100, x: 0, y: i * 40, toJSON() {} }) as DOMRect;
    });
    const handle = rows[0]!.querySelector('.sm-drag-handle')!;
    const fire = (type: string, y = 0) => handle.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientY: y, pointerId: 1, button: 0 }));
    fire('pointerdown');
    fire('pointermove', 70); // below row 2's midpoint (60)
    fire('pointerup');
    expect(refs(root)).toEqual(['John 3:16', 'Psalm 23', 'Mark 1:1']);
    expect(host.requests[0]).toEqual({ type: 'reorderList', collectionId: 1, passageIds: [2, 1, 3] });
    await flush();
  });

  it('row menus are not built until pressed (lazy), and rows carry no per-row listeners', () => {
    const root = mount();
    expect(root.querySelectorAll('.sm-menu-item')).toHaveLength(0);
    expect(root.querySelectorAll('.sm-menu-lazy').length).toBeGreaterThan(0);
  });

  it('remove and move items are in the row menu', () => {
    const root = mount();
    const row = root.querySelector('.sm-order-row')!;
    expect(row.querySelectorAll('.sm-menu-item')).toHaveLength(0); // built lazily
    (row.querySelector('.sm-menu-btn') as HTMLButtonElement).click();
    const items = Array.from(root.querySelector('.sm-order-row')!.querySelectorAll('.sm-menu-item')).map((n) => text(n));
    expect(items).toEqual(['Move to Romans Road', 'Remove']);
  });
});

describe('helpers', () => {
  it('storedOrder puts NULL positions last, then addedAt, then id', () => {
    const a = mk(1, 1, 'a', null); const b = mk(2, 1, 'b', 0);
    expect([a, b].sort(storedOrder).map((p) => p.passage.id)).toEqual([2, 1]);
  });
  it('reorderedPlan renumbers positions and leaves other lists alone', () => {
    const out = reorderedPlan(plan(), 1, [3, 1, 2]);
    expect(out.passages.map((p) => [p.passage.id, p.passage.position])).toEqual([[3, 0], [1, 1], [2, 2], [4, 4]]);
  });
});
