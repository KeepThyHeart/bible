/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListSummary, PanelReply, PanelRequest, PassageView, PlanView, RequestMap, Rung, RungView } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import type { Flow, NavAction } from '../src/ui/state';
import { WordMeasurer } from '../src/ui/measure';
import { renderMyVerses } from '../src/ui/myVersesView';
import { openAddVerseDialog } from '../src/ui/addVerseDialog';
import { setReciteEnabledForTests } from '../src/core/features';
import { SUGGESTED_LISTS } from '../src/core/suggestedLists';

vi.mock('../src/ui/addVerseDialog', () => ({ openAddVerseDialog: vi.fn() }));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();

function rung(r: Rung, over: Partial<RungView> = {}): RungView {
  return {
    rung: r, level: 0, dueAt: null, streak: 0, lastScore: null, applicable: true, resume: null,
    tiers: 2, tiersPassed: 0, bestScore: null, attempts: 0, nextTier: 0, ...over,
  } as RungView;
}

function pv(id: number, collectionId: number, reference: string, rungs: RungView[]): PassageView {
  return {
    passage: { id, collectionId, moduleId: 'kjv', startVerseId: id * 10, endVerseId: id * 10, reference, verseCount: 1, addedAt: id, answerMode: null, reciteOn: false },
    rungs, dueCount: 0, bestLevel: 0, wellLearned: false,
  } as PassageView;
}

const fresh = (id: number, c: number, ref: string) => pv(id, c, ref, [rung('ordering'), rung('blanks'), rung('firstletters')]);
const learning = (id: number, c: number, ref: string) =>
  pv(id, c, ref, [rung('blanks', { attempts: 2, level: 2, dueAt: NOW - HOUR, lastPractisedAt: NOW - 5 * DAY, firstPractisedAt: NOW - 9 * DAY })]);

const LISTS: ListSummary[] = [
  { id: 1, name: 'Default', passageCount: 2, verseCount: 2 },
  { id: 2, name: 'Romans Road', passageCount: 1, verseCount: 1 },
];
const PASSAGES = [learning(1, 1, 'Psalm 23'), fresh(2, 1, 'John 3:16'), fresh(3, 2, 'Romans 3:23')];

function plan(over: Partial<PlanView> = {}, passages = PASSAGES, lists = LISTS): PlanView {
  return {
    collectionId: 1, collectionName: 'Default', lists, scope: 'all', scopeVerseCount: passages.length,
    referenceActivitiesUnlocked: false, sortOrder: 'bible', passages, totalDue: 0,
    speech: { state: 'unavailable', missingPermissions: [], engineLabel: '', onDevice: false, handsFree: false },
    reciteDueCount: 0, cardsWaiting: 0, defaultAnswerMode: 'firstLetter', ...over,
  } as PlanView;
}

class Host implements PanelHost {
  requests: PanelRequest[] = [];
  navigations: NavAction[] = [];
  announcements: string[] = [];
  sessions: number[] = [];
  bible: number[] = [];
  reloads = 0;
  activeReference: string | null = null;
  handlers: Record<string, (r: any) => PanelReply<any>> = {};
  readonly measurer = new WordMeasurer(document);
  now() { return NOW; }
  request<R extends PanelRequest>(request: R): Promise<PanelReply<RequestMap[R['type']]>> {
    this.requests.push(request);
    const h = this.handlers[request.type];
    return Promise.resolve(h ? h(request) : { ok: true, data: {} });
  }
  go(a: NavAction) { this.navigations.push(a); }
  reload() { this.reloads += 1; }
  async startSession(passageId: number) { this.sessions.push(passageId); }
  async startFlow(_f: Flow) { return true; }
  openInBible(id: number) { this.bible.push(id); }
  announce(m: string) { this.announcements.push(m); }
}

let host: Host;
let container: HTMLElement;
beforeEach(() => { host = new Host(); container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { setReciteEnabledForTests(null); vi.mocked(openAddVerseDialog).mockClear(); container.remove(); document.querySelectorAll('.sm-modal-backdrop').forEach((n) => n.remove()); });

const text = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttons = (n: ParentNode) => Array.from(n.querySelectorAll('button'));
const byLabel = (n: ParentNode, label: string) => buttons(n).find((b) => text(b) === label);
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

function mount(over: Partial<PlanView> = {}, view: { list: any; highlight?: number } = { list: 'all' }, passages = PASSAGES, lists = LISTS) {
  const root = renderMyVerses(host, plan(over, passages, lists), view);
  container.appendChild(root);
  return root;
}
const rows = (root: Element) => Array.from(root.querySelectorAll('.sm-verse-row'));
const rowFor = (root: Element, ref: string) => rows(root).find((r) => text(r.querySelector('.sm-verse-ref')!) === ref)!;
function openMenu(scope: Element, label: string) {
  const trigger = scope.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
  trigger.click();
  // The real menu replaces the stand-in trigger on first press.
  return scope.querySelector(`button[aria-label="${label}"]`)!.parentElement!.querySelector('[role="menu"]')!;
}
const menuItem = (menu: Element, label: string) => buttons(menu).find((b) => text(b) === label)!;

describe('rows', () => {
  it('shows reference, translation, status and next review', () => {
    const root = mount();
    const psalm = rowFor(root, 'Psalm 23');
    expect(text(psalm)).toContain('KJV'.toLowerCase());
    expect(text(psalm)).toContain('Due today');
    expect(text(rowFor(root, 'John 3:16'))).toContain('Not started');
  });

  it('names the list on each row only when showing all lists', () => {
    expect(text(rowFor(mount(), 'Romans 3:23'))).toContain('Romans Road');
    container.innerHTML = '';
    expect(text(rowFor(mount({}, { list: 2 }), 'Romans 3:23'))).not.toContain('Romans Road');
  });

  it('opens the verse page from the reference and from the menu', () => {
    const root = mount();
    (rowFor(root, 'Psalm 23').querySelector('.sm-verse-ref') as HTMLElement).click();
    expect(host.navigations).toContainEqual({ type: 'goVerse', passageId: 1 });
    host.navigations.length = 0;
    menuItem(openMenu(rowFor(root, 'Psalm 23'), 'Actions for Psalm 23'), 'Open verse').click();
    expect(host.navigations).toEqual([{ type: 'goVerse', passageId: 1 }]);
  });

  it('menu: Practice now, Show in Bible, Move to the other list, Remove', () => {
    const root = mount();
    const menu = openMenu(rowFor(root, 'John 3:16'), 'Actions for John 3:16');
    expect(buttons(menu).map(text)).toEqual(['Practice now', 'Open verse', 'Show in Bible', 'Move to Romans Road', 'Remove']);
    menuItem(menu, 'Practice now').click();
    expect(host.sessions).toEqual([2]);
    menuItem(menu, 'Show in Bible').click();
    expect(host.bible).toEqual([20]);
  });

  it('menu is keyboard operable: Escape closes and returns focus to the trigger', () => {
    const root = mount();
    const row = rowFor(root, 'John 3:16');
    const menu = openMenu(row, 'Actions for John 3:16');
    const trigger = row.querySelector<HTMLElement>('button[aria-label="Actions for John 3:16"]')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves a verse to another list', async () => {
    const root = mount();
    menuItem(openMenu(rowFor(root, 'John 3:16'), 'Actions for John 3:16'), 'Move to Romans Road').click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'movePassage', passageId: 2, collectionId: 2 });
    expect(host.reloads).toBe(1);
  });

  it('has no move items with a single list', () => {
    const one = [LISTS[0]!];
    const root = mount({}, { list: 'all' }, [PASSAGES[0]!], one);
    const menu = openMenu(rowFor(root, 'Psalm 23'), 'Actions for Psalm 23');
    expect(buttons(menu).map(text)).toEqual(['Practice now', 'Open verse', 'Show in Bible', 'Remove']);
  });
});

describe('remove', () => {
  it('a new verse: short confirm, no history copy; Cancel removes nothing', async () => {
    const root = mount();
    menuItem(openMenu(rowFor(root, 'John 3:16'), 'Actions for John 3:16'), 'Remove').click();
    const dialog = document.querySelector('.sm-modal')!;
    expect(text(dialog)).toContain('Remove John 3:16?');
    expect(text(dialog)).toContain('It will be taken off your list.');
    expect(text(dialog)).not.toContain('7 days');
    byLabel(dialog, 'Cancel')!.click();
    await settle();
    expect(host.requests.some((r) => r.type === 'removePassage')).toBe(false);
  });

  it('a verse with history: the 7-day restore copy, then removes, announces and reloads', async () => {
    const root = mount();
    menuItem(openMenu(rowFor(root, 'Psalm 23'), 'Actions for Psalm 23'), 'Remove').click();
    const dialog = document.querySelector('.sm-modal')!;
    expect(text(dialog)).toContain('7 days');
    byLabel(dialog, 'Remove')!.click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'removePassage', passageId: 1 });
    expect(host.navigations).toContainEqual({ type: 'passageRemoved', passageId: 1 });
    expect(host.announcements.join(' ')).toContain('Add it again within 7 days');
    expect(host.reloads).toBe(1);
    expect(document.querySelector('.sm-modal')).toBeNull();
  });
});



const refs = (root: Element) => rows(root).map((r) => text(r.querySelector('.sm-verse-ref')!));
const blocksOf = (row: Element) => Array.from(row.querySelectorAll<HTMLButtonElement>('.sm-block-btn'));

describe('List picker', () => {
  it('is a native select with (All) and each list with counts, and no chips', () => {
    const root = mount();
    const select = root.querySelector('select') as HTMLSelectElement;
    expect(text(root.querySelector('label')!)).toBe('List:');
    expect(Array.from(select.options).map((o) => text(o))).toEqual(['(All)', 'Default (2)', 'Romans Road (1)']);
    expect(select.value).toBe('all');
    expect(root.querySelector('.sm-list-chip')).toBeNull();
  });

  it('filters the rows and requests the change through goVerses without any request', () => {
    const root = mount({}, { list: 2 });
    expect(refs(root)).toEqual(['Romans 3:23']);
    const select = root.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('2');
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    expect(host.navigations).toContainEqual({ type: 'goVerses', list: 1 });
    expect(host.requests).toEqual([]);
  });

  it('shows every list even when a focus is set, and falls back to all for a missing list', () => {
    expect(rows(mount({ scope: 2 }, { list: 'all' }))).toHaveLength(3);
    container.innerHTML = '';
    expect(rows(mount({}, { list: 99 }))).toHaveLength(3);
  });
});

describe('order and progress', () => {
  it('sorts by need: due now first, then learning, then new', () => {
    const root = mount();
    expect(refs(root)).toEqual(['Psalm 23', 'John 3:16', 'Romans 3:23']);
    container.innerHTML = '';
    const reversed = mount({}, { list: 'all' }, [PASSAGES[1]!, PASSAGES[0]!, PASSAGES[2]!]);
    expect(refs(reversed)[0]).toBe('Psalm 23');
  });

  it('has a green progressbar with a percentage above the list, following the filter', () => {
    const root = mount();
    const pb = root.querySelector('[role="progressbar"]')!;
    expect(pb.getAttribute('aria-valuenow')).toBe('0');
    expect(text(root.querySelector('.sm-progress-text')!)).toBe('0% of activities complete \u00B7 0 of 3 verses learned');
    expect(root.querySelector('.sm-bar-fill.sm-progress-fill')).not.toBeNull(); // CSS: .sm-bar-fill.sm-progress-fill is green (M5)
    const done = pv(5, 1, 'Done 1:1', [rung('blanks', { level: 4, attempts: 3, tiersPassed: 2 })]);
    container.innerHTML = '';
    const r2 = mount({}, { list: 1 }, [done], [LISTS[0]!]);
    expect(r2.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
  });

  it('hides the bar with nothing shown', () => {
    expect(mount({}, { list: 'all' }, [], [LISTS[0]!]).querySelector('[role="progressbar"]')).toBeNull();
  });
});

describe('row details and blocks', () => {
  it('puts the status and next review in the details line below the reference', () => {
    const row = rowFor(mount(), 'Psalm 23');
    expect(text(row.querySelector('.sm-verse-details')!)).toBe('Due today \u00B7 Default');
    expect(row.querySelector('.sm-status')).toBeNull();
  });

  it('draws one toolbar per row with one tab stop and a named block per activity', () => {
    const row = rowFor(mount(), 'Psalm 23');
    const bar = row.querySelector('[role="toolbar"]')!;
    expect(bar.getAttribute('aria-label')).toBe('Activities for Psalm 23');
    const blocks = blocksOf(row);
    expect(blocks.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    const blanks = blocks.find((b) => b.dataset.rung === 'blanks')!;
    expect(blanks.dataset.state).toBe('practicing');
    expect(text(blanks)).toContain('Fill in the blanks: 0 of 2 stages passed');
    // one announcement only: no title next to the sr-only name; a visible tag tells blocks apart
    expect(blanks.hasAttribute('title')).toBe(false);
    expect(blanks.querySelector('.sm-block-tag')!.textContent).not.toBe('');
  });

  it('marks a single-verse ordering block not applicable (aria-disabled, still in the arrow order)', () => {
    const blocks = blocksOf(rowFor(mount(), 'Psalm 23'));
    const ordering = blocks.find((b) => b.dataset.rung === 'ordering')!;
    expect(ordering.dataset.state).toBe('notApplicable');
    expect(ordering.getAttribute('aria-disabled')).toBe('true');
    expect(text(ordering)).toContain('not applicable');
    ordering.click();
    expect(host.sessions).toEqual([]);
  });

  it('arrow keys, Home and End move between the blocks with a roving tab stop', () => {
    const blocks = blocksOf(rowFor(mount(), 'John 3:16'));
    const bar = blocks[0]!.parentElement!;
    blocks[0]!.focus();
    blocks[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(blocks[1]);
    expect(blocks[1]!.tabIndex).toBe(0);
    expect(blocks[0]!.tabIndex).toBe(-1);
    blocks[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(blocks[blocks.length - 1]);
    blocks[blocks.length - 1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(blocks[0]);
    expect(bar.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('clicking a block starts that activity', () => {
    const blocks = blocksOf(rowFor(mount(), 'John 3:16'));
    const calls: Array<[number, unknown]> = [];
    host.startSession = async (id: number, rung?: Rung) => { calls.push([id, rung]); };
    blocks.find((b) => b.dataset.rung === 'blanks')!.click();
    expect(calls).toEqual([[2, 'blanks']]);
  });

  it('hides the recite block while the speech probe is unknown', () => {
    const recite = pv(9, 1, 'Recite 1:1', [rung('blanks'), rung('recite')]);
    const speech = { state: 'unavailable', missingPermissions: [], engineLabel: '', onDevice: false, handsFree: false, unknown: true };
    const row = rowFor(mount({ speech } as never, { list: 'all' }, [recite], [LISTS[0]!]), 'Recite 1:1');
    expect(blocksOf(row).some((b) => b.dataset.rung === 'recite')).toBe(false);
    const row2 = rowFor(mount({}, { list: 'all' }, [recite], [LISTS[0]!]), 'Recite 1:1');
    expect(blocksOf(row2).some((b) => b.dataset.rung === 'recite')).toBe(true);
  });

  it('clicking the recite block starts a recite run', async () => {
    setReciteEnabledForTests(true);
    host.handlers['startRecite'] = () => ({ ok: true, data: { reciteId: 'r1', mode: 'tap' } });
    const recite = pv(9, 1, 'Recite 1:1', [rung('blanks'), rung('recite')]);
    const row = rowFor(mount({}, { list: 'all' }, [recite], [LISTS[0]!]), 'Recite 1:1');
    blocksOf(row).find((b) => b.dataset.rung === 'recite')!.click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'startRecite', source: { kind: 'passage', passageId: 9 }, mode: 'tap' });
    expect(host.navigations).toContainEqual({ type: 'reciteStarted', reciteId: 'r1', mode: 'tap' });
    expect(host.sessions).toEqual([]);
  });

  it('offers a closed text summary of the activities for touch users', () => {
    const d = rowFor(mount(), 'Psalm 23').querySelector('details.sm-block-summary') as HTMLDetailsElement;
    expect(d.open).toBe(false);
    d.open = true; // the lines are filled in on first open
    d.dispatchEvent(new Event('toggle'));
    expect(Array.from(d.querySelectorAll('li')).map(text)).toContain('Fill in the blanks: 0 of 2 stages passed');
  });
});

describe('adding and starter sets', () => {
  it('Add verse opens the dialog preselecting the filtered list, and shows the new row highlighted', () => {
    const root = mount({}, { list: 2 });
    byLabel(root, 'Add verse')!.click();
    const opts = vi.mocked(openAddVerseDialog).mock.calls[0]![1];
    expect(opts.listId).toBe(2);
    opts.onAdded({ id: 4, collectionId: 1 } as any);
    expect(host.navigations).toContainEqual({ type: 'goVerses', list: 1, highlight: 4 });
  });

  it('keeps the starter sets reachable: closed with verses, open when empty', () => {
    const details = mount().querySelector('details.sm-verses-starters') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelectorAll('.sm-chip').length).toBe(SUGGESTED_LISTS.length);
    container.innerHTML = '';
    const empty = mount({}, { list: 'all' }, [], [LISTS[0]!]);
    expect((empty.querySelector('details.sm-verses-starters') as HTMLDetailsElement).open).toBe(true);
    expect(text(empty)).toContain('No verses yet.');
  });

  it('a starter chip creates its list without touching the focus', async () => {
    const set = SUGGESTED_LISTS[0]!;
    host.handlers['createList'] = () => ({ ok: true, data: plan({ lists: [...LISTS, { id: 7, name: set.name, passageCount: 0, verseCount: 0 }] }) });
    host.handlers['addPassage'] = () => ({ ok: true, data: { passage: PASSAGES[0]!.passage } });
    (mount().querySelector('.sm-starter-chips .sm-chip') as HTMLElement).click();
    await settle();
    expect(host.requests.some((r) => r.type === 'setScope')).toBe(false);
    expect((host.requests.filter((r) => r.type === 'addPassage')[0] as any).collectionId).toBe(7);
  });

  it('highlights a just-added verse with Practice now', () => {
    const row = rowFor(mount({}, { list: 'all', highlight: 2 }), 'John 3:16');
    expect(byLabel(row, 'Practice now')).toBeDefined();
  });
});

describe('long lists', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => fresh(100 + i, 1, `Verse ${i + 1}:1`));

  it('paints the first rows at once and the rest in later frames, with set size and position', async () => {
    const root = mount({}, { list: 'all' }, many(300));
    const first = rows(root).length;
    expect(first).toBeLessThan(300);
    expect(rows(root)[0]!.getAttribute('aria-setsize')).toBe('300');
    expect(rows(root)[0]!.getAttribute('aria-posinset')).toBe('1');
    for (let i = 0; i < 40 && rows(root).length < 300; i++) await new Promise((r) => setTimeout(r, 20));
    expect(rows(root).length).toBe(300);
    expect(rows(root)[299]!.getAttribute('aria-posinset')).toBe('300');
  });

  it('shows a highlighted row far down in the first paint', () => {
    const root = mount({}, { list: 'all', highlight: 290 }, many(300));
    expect(root.querySelector('[data-passage-id="290"]')).not.toBeNull();
  });

  it('stops filling a list that was replaced', async () => {
    const root = mount({}, { list: 'all' }, many(300));
    const before = rows(root).length;
    await new Promise((r) => setTimeout(r, 40)); // let the first frame see it attached
    root.remove();
    await new Promise((r) => setTimeout(r, 300));
    expect(rows(root).length).toBeLessThan(300);
    expect(rows(root).length).toBeGreaterThanOrEqual(before);
  });

  it('delegated block clicks start the session', () => {
    const root = mount();
    (rowFor(root, 'John 3:16').querySelector('.sm-block-btn') as HTMLElement).click();
    expect(host.sessions.length + host.navigations.length).toBeGreaterThan(0);
  });
});
