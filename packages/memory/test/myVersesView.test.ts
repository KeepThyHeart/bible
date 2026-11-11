/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ListSummary, PanelReply, PanelRequest, PassageView, PlanView, RequestMap, Rung, RungView } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import type { Flow, NavAction } from '../src/ui/state';
import { WordMeasurer } from '../src/ui/measure';
import { renderMyVerses } from '../src/ui/myVersesView';
import { SUGGESTED_LISTS } from '../src/core/suggestedLists';

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
afterEach(() => { container.remove(); document.querySelectorAll('.sm-modal-backdrop').forEach((n) => n.remove()); });

const text = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttons = (n: ParentNode) => Array.from(n.querySelectorAll('button'));
const byLabel = (n: ParentNode, label: string) => buttons(n).find((b) => text(b) === label);
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

function mount(over: Partial<PlanView> = {}, view: { list: any; highlight?: number } = { list: 'all' }, allOver: Partial<PlanView> = {}, passages = PASSAGES, lists = LISTS) {
  const root = renderMyVerses(host, plan(over, passages, lists), plan(allOver, passages, lists), view);
  container.appendChild(root);
  return root;
}
const rows = (root: Element) => Array.from(root.querySelectorAll('.sm-verse-row'));
const rowFor = (root: Element, ref: string) => rows(root).find((r) => text(r.querySelector('.sm-verse-ref')!) === ref)!;
function openMenu(scope: Element, label: string) {
  const trigger = scope.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
  trigger.click();
  return trigger.parentElement!.querySelector('[role="menu"]')!;
}
const menuItem = (menu: Element, label: string) => buttons(menu).find((b) => text(b) === label)!;

describe('chips', () => {
  it('shows All and each list with counts, as toggle buttons', () => {
    const root = mount();
    const chips = Array.from(root.querySelectorAll('.sm-list-chip')).map((b) => text(b));
    expect(chips).toEqual(['All (3)', 'Default (2)', 'Romans Road (1)', '+ New list']);
    expect(root.querySelector('button[aria-pressed="true"]')!.textContent).toContain('All (3)');
  });

  it('filters the rows by list and requests it through goVerses', () => {
    const root = mount({}, { list: 2 });
    expect(rows(root).map((r) => text(r.querySelector('.sm-verse-ref')!))).toEqual(['Romans 3:23']);
    expect(text(root.querySelector('button[aria-pressed="true"]')!)).toBe('Romans Road (1)');
    byLabel(root, 'Default (2)')!.click();
    expect(host.navigations).toContainEqual({ type: 'goVerses', list: 1 });
  });

  it("'focus' follows the persisted focus and ignores a focus when the plan is all-scoped", () => {
    const withFocus = mount({ scope: 2 }, { list: 'focus' });
    expect(rows(withFocus)).toHaveLength(1);
    expect(text(withFocus.querySelector('.sm-chip-focus')!)).toBe('Focus');
    withFocus.remove();
    expect(rows(mount({ scope: 'all' }, { list: 'focus' }))).toHaveLength(3);
  });

  it('shows all verses of every list even when a focus is set', () => {
    const root = mount({ scope: 2, passages: [PASSAGES[2]!] }, { list: 'all' });
    expect(rows(root)).toHaveLength(3);
  });

  it('falls back to all lists for a list id that no longer exists', () => {
    expect(rows(mount({}, { list: 99 }))).toHaveLength(3);
  });

  it('sets and clears the focus from the chip menu', async () => {
    const root = mount();
    const menu = openMenu(root, 'Options for Romans Road');
    menuItem(menu, 'Focus Today on this list').click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'setScope', scope: { kind: 'list', id: 2 } });
    expect(host.reloads).toBe(1);
    root.remove();

    const focused = mount({ scope: 2 }, { list: 'all' });
    const m2 = openMenu(focused, 'Options for Romans Road');
    menuItem(m2, 'Clear focus').click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'setScope', scope: { kind: 'all' } });
  });
});

describe('rows', () => {
  it('shows reference, translation, status and next review', () => {
    const root = mount();
    const psalm = rowFor(root, 'Psalm 23');
    expect(text(psalm)).toContain('KJV'.toLowerCase());
    expect(text(psalm)).toContain('Learning');
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
    const trigger = row.querySelector<HTMLElement>('button[aria-label="Actions for John 3:16"]')!;
    const menu = openMenu(row, 'Actions for John 3:16');
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
    const root = mount({}, { list: 'all' }, {}, [PASSAGES[0]!], one);
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

describe('adding', () => {
  const added = (id: number, collectionId: number, reference: string, existed = false): any => ({
    ok: true, data: { passage: { ...PASSAGES[0]!.passage, id, collectionId, reference }, existed },
  });
  const submit = (root: Element, value: string) => {
    const input = root.querySelector<HTMLInputElement>('#sm-add-reference')!;
    input.value = value;
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  };

  it('has no list picker with one list; has one with several', () => {
    expect(mount().querySelector('#sm-add-list')).not.toBeNull();
    container.innerHTML = '';
    expect(mount({}, { list: 'all' }, {}, [PASSAGES[0]!], [LISTS[0]!]).querySelector('#sm-add-list')).toBeNull();
  });

  it('adds to the picked list and highlights the new row with Practice now', async () => {
    host.handlers['addPassage'] = (r) => added(9, r.collectionId, 'Romans 8:28');
    const root = mount({}, { list: 'all' });
    const picker = root.querySelector<HTMLSelectElement>('#sm-add-list')!;
    expect(picker.value).toBe('1');
    picker.value = '2';
    submit(root, 'Romans 8:28');
    await settle();
    expect(host.requests).toContainEqual({ type: 'addPassage', reference: 'Romans 8:28', collectionId: 2 });
    expect(host.navigations).toContainEqual({ type: 'goVerses', list: 'all', highlight: 9 });
    expect(host.announcements).toContain('Added Romans 8:28.');
    expect(host.reloads).toBe(1);

    // Re-render with the highlight: the row offers Practice now.
    root.remove();
    const again = mount({}, { list: 'all', highlight: 3 });
    const row = rowFor(again, 'Romans 3:23');
    expect(row.classList.contains('sm-verse-row-new')).toBe(true);
    (row.querySelector('.sm-verse-practice') as HTMLElement).click();
    expect(host.sessions).toEqual([3]);
    expect(rowFor(again, 'Psalm 23').querySelector('.sm-verse-practice')).toBeNull();
  });

  it('defaults the picker to the filtered list', () => {
    expect(mount({}, { list: 2 }).querySelector<HTMLSelectElement>('#sm-add-list')!.value).toBe('2');
  });

  it('switches the filter to the list the verse landed in', async () => {
    host.handlers['addPassage'] = (r) => added(9, r.collectionId, 'Romans 8:28');
    const root = mount({}, { list: 1 });
    const picker = root.querySelector<HTMLSelectElement>('#sm-add-list')!;
    picker.value = '2';
    submit(root, 'Romans 8:28');
    await settle();
    expect(host.navigations).toContainEqual({ type: 'goVerses', list: 2, highlight: 9 });
  });

  it('says so when the verse is already in the list', async () => {
    host.handlers['addPassage'] = () => added(1, 1, 'Psalm 23', true);
    const root = mount();
    submit(root, 'Psalm 23');
    await settle();
    expect(host.announcements).toContain('Psalm 23 is already in your list.');
  });

  it("shows the worker's message when a reference does not parse", async () => {
    host.handlers['addPassage'] = () => ({ ok: false, error: 'Could not read "Jn 99".' });
    const root = mount();
    submit(root, 'Jn 99');
    await settle();
    expect(text(root.querySelector('.sm-error-slot')!)).toBe('Could not read "Jn 99".');
    expect(host.navigations).toHaveLength(0);
  });

  it('asks for a reference when the field is empty', () => {
    const root = mount();
    submit(root, '');
    expect(text(root.querySelector('.sm-error-slot')!)).toContain('Type a reference first');
  });

  it('adds several at once after a confirm, to the picked list, dropping contained ranges', async () => {
    let id = 100;
    host.handlers['addPassage'] = (r) => {
      const ref: string = r.reference;
      const base = { ...PASSAGES[0]!.passage, id: id++, collectionId: r.collectionId, reference: ref };
      if (ref === 'John 3:16-17') return { ok: true, data: { passage: { ...base, startVerseId: 43003016, endVerseId: 43003017 } } };
      if (ref === 'John 3:16') return { ok: true, data: { passage: { ...base, startVerseId: 43003016, endVerseId: 43003016 } } };
      return { ok: true, data: { passage: { ...base, startVerseId: 45008028, endVerseId: 45008028 } } };
    };
    const root = mount();
    root.querySelector<HTMLSelectElement>('#sm-add-list')!.value = '2';
    byLabel(root, 'Add several at once')!.click();
    const dialog = document.querySelector('.sm-modal')!;
    const area = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
    area.value = 'John 3:16-17\nJohn 3:16\nRomans 8:28';
    byLabel(dialog, 'Find references')!.click();
    expect(text(dialog)).toContain('Add 3 verses?');
    byLabel(dialog, 'Add 3 verses')!.click();
    await settle();
    const adds = host.requests.filter((r) => r.type === 'addPassage') as any[];
    expect(adds.map((a) => a.collectionId)).toEqual([2, 2, 2]);
    expect(host.requests.filter((r) => r.type === 'removePassage')).toHaveLength(1);
    expect(host.announcements.join(' ')).toContain('Added 2 verses.');
    expect(document.querySelector('.sm-modal')).toBeNull();
    expect(host.reloads).toBe(1);
  });

  it('a multi-reference paste opens the confirm dialog', () => {
    const root = mount();
    const input = root.querySelector<HTMLInputElement>('#sm-add-reference')!;
    const ev = new Event('paste', { cancelable: true, bubbles: true }) as any;
    ev.clipboardData = { getData: () => 'John 3:16\nRomans 8:28' };
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(text(document.querySelector('.sm-modal')!)).toContain('Add 2 verses?');
  });
});

describe('starter sets', () => {
  it('are reachable from the add area, closed when there are verses and open when empty', () => {
    const root = mount();
    const details = root.querySelector('details.sm-verses-starters') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelectorAll('.sm-chip').length).toBe(SUGGESTED_LISTS.length);
    container.innerHTML = '';
    const empty = mount({}, { list: 'all' }, {}, [], [LISTS[0]!]);
    expect((empty.querySelector('details.sm-verses-starters') as HTMLDetailsElement).open).toBe(true);
    expect(text(empty)).toContain('No verses yet.');
  });

  it('a chip creates its list without touching the focus', async () => {
    const set = SUGGESTED_LISTS[0]!;
    host.handlers['createList'] = () => ({ ok: true, data: plan({ lists: [...LISTS, { id: 7, name: set.name, passageCount: 0, verseCount: 0 }] }) });
    host.handlers['addPassage'] = () => ({ ok: true, data: { passage: PASSAGES[0]!.passage } });
    const root = mount();
    (root.querySelector('.sm-starter-chips .sm-chip') as HTMLElement).click();
    await settle();
    expect(host.requests.some((r) => r.type === 'setScope')).toBe(false);
    expect((host.requests.filter((r) => r.type === 'addPassage')[0] as any).collectionId).toBe(7);
  });
});

describe('list management', () => {
  const dialog = () => document.querySelector('.sm-modal')!;

  it('New list creates a list from a name', async () => {
    const root = mount();
    byLabel(root, '+ New list')!.click();
    byLabel(dialog(), 'Create')!.click();
    expect(text(dialog())).toContain('A list needs a name.');
    dialog().querySelector<HTMLInputElement>('input')!.value = 'Advent';
    byLabel(dialog(), 'Create')!.click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'createList', name: 'Advent' });
    expect(host.announcements).toContain('Created Advent.');
    expect(document.querySelector('.sm-modal')).toBeNull();
  });

  it('shows the worker error in the dialog and keeps it open', async () => {
    host.handlers['createList'] = () => ({ ok: false, error: 'A list with that name exists.' });
    const root = mount();
    byLabel(root, '+ New list')!.click();
    dialog().querySelector<HTMLInputElement>('input')!.value = 'Default';
    byLabel(dialog(), 'Create')!.click();
    await settle();
    expect(text(dialog())).toContain('A list with that name exists.');
  });

  it('renames a list', async () => {
    const root = mount();
    menuItem(openMenu(root, 'Options for Romans Road'), 'Rename').click();
    const input = dialog().querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('Romans Road');
    input.value = 'Road';
    byLabel(dialog(), 'Save')!.click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'renameList', id: 2, name: 'Road' });
    expect(host.reloads).toBe(1);
  });

  it('refuses to delete the only list, without a request', () => {
    const root = mount({}, { list: 'all' }, {}, [PASSAGES[0]!], [LISTS[0]!]);
    menuItem(openMenu(root, 'Options for Default'), 'Delete').click();
    expect(host.announcements).toContain('You cannot delete your only list.');
    expect(host.requests.some((r) => r.type === 'deleteList')).toBe(false);
  });

  it('deletes an empty list straight away, moving nothing anywhere meaningful', async () => {
    const lists = [LISTS[0]!, { id: 2, name: 'Empty', passageCount: 0, verseCount: 0 }];
    const root = mount({}, { list: 'all' }, {}, [PASSAGES[0]!], lists);
    menuItem(openMenu(root, 'Options for Empty'), 'Delete').click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'deleteList', id: 2, movePassagesTo: 1 });
    expect(document.querySelector('.sm-modal')).toBeNull();
  });

  it('a list with verses but no history asks where they go', async () => {
    host.handlers['getListPracticeStats'] = () => ({ ok: true, data: { total: 1, practiced: 0 } });
    const root = mount();
    menuItem(openMenu(root, 'Options for Romans Road'), 'Delete').click();
    await settle();
    expect(text(dialog())).toContain('Delete "Romans Road"?');
    expect(dialog().querySelector('.sm-delete-confirm')).toBeNull();
    byLabel(dialog(), 'Delete and move 1 verse')!.click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'deleteList', id: 2, movePassagesTo: 1 });
  });

  it('a list with practice history needs its name typed exactly', async () => {
    host.handlers['getListPracticeStats'] = () => ({ ok: true, data: { total: 2, practiced: 1 } });
    const root = mount();
    menuItem(openMenu(root, 'Options for Default'), 'Delete').click();
    await settle();
    const confirm = byLabel(dialog(), 'Delete and move 2 verses') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const input = dialog().querySelector<HTMLInputElement>('.sm-delete-confirm')!;
    input.value = 'default';
    input.dispatchEvent(new Event('input'));
    expect(confirm.disabled).toBe(true);
    input.value = 'Default';
    input.dispatchEvent(new Event('input'));
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'deleteList', id: 1, movePassagesTo: 2 });
  });
});
