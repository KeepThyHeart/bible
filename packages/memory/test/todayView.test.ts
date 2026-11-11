/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ListSummary, PanelReply, PanelRequest, PassageView, PlanView, RequestMap, Rung, RungView } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import type { Flow, NavAction } from '../src/ui/state';
import { WordMeasurer } from '../src/ui/measure';
import { renderToday } from '../src/ui/todayView';
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

function pv(id: number, rungs: RungView[], reference = `Ref ${id}`, collectionId = 1): PassageView {
  return {
    passage: {
      id, collectionId, moduleId: 'kjv', startVerseId: id, endVerseId: id, reference,
      verseCount: 1, addedAt: id, answerMode: null, reciteOn: false,
    },
    rungs, dueCount: 0, bestLevel: 0, wellLearned: false,
  } as PassageView;
}

const fresh = (id: number, reference?: string) => pv(id, [rung('ordering'), rung('blanks'), rung('firstletters')], reference);
/** Learned earlier, due now, so it is a review. */
const due = (id: number, reference: string, r: Rung = 'blanks') =>
  pv(id, [rung(r, { attempts: 2, level: 2, dueAt: NOW - HOUR, lastPractisedAt: NOW - 5 * DAY, firstPractisedAt: NOW - 9 * DAY })], reference);
/** Practised today; next review in two days. */
const doneToday = (id: number, reference: string) =>
  pv(id, [rung('blanks', { attempts: 2, level: 2, dueAt: NOW + 2 * DAY, lastPractisedAt: NOW - HOUR, firstPractisedAt: NOW - 9 * DAY })], reference);

function plan(passages: PassageView[], over: Partial<PlanView> = {}): PlanView {
  const lists: ListSummary[] = [{ id: 1, name: 'Default', passageCount: passages.length, verseCount: passages.length }];
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
  flows: Flow[] = [];
  sessions: { passageId: number; rung?: Rung }[] = [];
  reloads = 0;
  activeReference: string | null = null;
  handlers: Record<string, (r: any) => PanelReply<any>> = {};
  readonly measurer = new WordMeasurer(document);
  now() { return NOW; }
  request<R extends PanelRequest>(request: R): Promise<PanelReply<RequestMap[R['type']]>> {
    this.requests.push(request);
    const h = this.handlers[request.type];
    return Promise.resolve(h ? h(request) : { ok: false, error: `No stub for ${request.type}` });
  }
  go(a: NavAction) { this.navigations.push(a); }
  reload() { this.reloads += 1; }
  async startSession(passageId: number, rung?: Rung) { this.sessions.push({ passageId, rung }); }
  async startFlow(flow: Flow) { this.flows.push(flow); return true; }
  openInBible() {}
  announce(m: string) { this.announcements.push(m); }
}

let host: Host;
let container: HTMLElement;
beforeEach(() => { host = new Host(); container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { container.remove(); });

const text = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttons = (n: Element) => Array.from(n.querySelectorAll('button'));
const byLabel = (n: Element, label: string) => buttons(n).find((b) => text(b) === label);
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function mount(p: PlanView, extras = {}) {
  const root = renderToday(host, p, extras);
  container.appendChild(root);
  return root;
}

describe('Today: A1', () => {
  const p = () => plan([due(1, 'Psalm 23'), due(2, 'John 3:16', 'firstletters'), fresh(3, 'Romans 6:23')]);

  it('has one h1, the counts, one Start button and an Up next list', () => {
    const root = mount(p());
    expect(root.querySelectorAll('h1').length).toBe(1);
    expect(text(root.querySelector('h1')!)).toBe('Today');
    expect(text(root)).toContain('2 to review, 1 new');
    expect(buttons(root).filter((b) => b.classList.contains('sm-btn-primary')).map(text)).toEqual(['Start']);
    expect(text(root.querySelector('h2')!)).toBe('Up next');
    expect(root.querySelectorAll('.sm-today-item').length).toBe(3);
    expect(text(root)).toContain('Review · Fill in the blanks');
    expect(text(root)).toContain('New · Put in order');
  });

  it('shows minutes only when the queue has them', () => {
    expect(text(mount(p()))).toMatch(/About \d+ minutes?/);
  });

  it('Start runs the today flow', () => {
    const root = mount(p());
    byLabel(root, 'Start')!.click();
    expect(host.flows).toEqual([{ kind: 'today', skipped: [] }]);
  });

  it('says Continue once something was done today', () => {
    const root = mount(plan([due(1, 'Psalm 23'), doneToday(2, 'John 3:16')]));
    expect(byLabel(root, 'Continue')).toBeDefined();
    expect(byLabel(root, 'Start')).toBeUndefined();
    expect(text(root)).toContain('1 to review');
    expect(text(root)).not.toContain('new');
  });

  it('lists four rows and "N more"', () => {
    const many = plan([1, 2, 3, 4, 5, 6].map((i) => due(i, `Verse ${i}`)));
    const root = mount(many);
    expect(root.querySelectorAll('.sm-today-item').length).toBe(4);
    expect(text(root)).toContain('2 more');
  });

  it('masks the reference for reference activities', () => {
    const root = mount(plan([due(1, 'Psalm 23', 'refmatch'), due(2, 'John 3:16', 'refprovide'), due(3, 'Acts 2:1')]));
    const t = text(root);
    expect(t).not.toContain('Psalm 23');
    expect(t).not.toContain('John 3:16');
    expect(t).toContain('Acts 2:1');
    expect(t).toContain('Reference hidden');
    expect(t).toContain('Match the reference');
    expect(t).toContain('Name the reference');
  });

  it('labels new vs review in words, not only by dot', () => {
    const root = mount(p());
    const items = Array.from(root.querySelectorAll('.sm-today-item')).map(text);
    expect(items.some((i) => i.startsWith('Romans 6:23') && i.includes('New'))).toBe(true);
  });
});

describe('Today: Practice something else', () => {
  it('opens a menu with Mixed and the available activities, and starts the chosen flow', () => {
    const root = mount(plan([due(1, 'Psalm 23')]));
    const trigger = byLabel(root, 'Practice something else')!;
    const panel = root.querySelector<HTMLElement>('[role="menu"]')!;
    expect(panel.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    expect(panel.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const labels = Array.from(panel.querySelectorAll('[role="menuitem"]')).map(text);
    expect(labels[0]).toBe('Mixed');
    expect(labels).toContain('Fill in the blanks');
    panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[0]!.click();
    expect(host.flows[0]!.kind).toBe('mixed');
    expect(panel.hidden).toBe(true);
  });

  it('shows nothing locked: no reference activities while they do not apply', () => {
    const root = mount(plan([due(1, 'Psalm 23')]));
    byLabel(root, 'Practice something else')!.click();
    const all = text(root.querySelector('[role="menu"]')!);
    expect(all).not.toContain('Match the reference');
    expect(all).not.toContain('Name the reference');
    expect(all).not.toContain('25');
  });

  it('Escape closes the menu', () => {
    const root = mount(plan([due(1, 'Psalm 23')]));
    const trigger = byLabel(root, 'Practice something else')!;
    trigger.click();
    const panel = root.querySelector<HTMLElement>('[role="menu"]')!;
    panel.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
  });
});

describe('Today: A2 done', () => {
  const donePlan = (extra: PassageView[] = []) => plan([doneToday(1, 'Psalm 23'), doneToday(2, 'John 3:16'), ...extra]);

  it('says Done for today with upcoming reviews and Practice anyway', () => {
    const root = mount(donePlan());
    expect(text(root.querySelector('h1')!)).toBe('Done for today');
    expect(text(root)).toMatch(/Next review .*: 2 verses/);
    expect(byLabel(root, 'Learn a new verse')).toBeUndefined();
    byLabel(root, 'Practice anyway')!.click();
    expect(host.flows).toEqual([{ kind: 'anyway', visited: [] }]);
  });

  it('offers Learn a new verse when a new one is held back by the daily cap', () => {
    // Three verses already started today use up the cap; a fourth waits.
    const started = [1, 2, 3].map((i) =>
      pv(i, [rung('blanks', { attempts: 1, level: 1, dueAt: NOW + DAY, lastPractisedAt: NOW - HOUR, firstPractisedAt: NOW - HOUR })], `Started ${i}`));
    const root = mount(plan([...started, fresh(9, 'Hebrews 11:1')]));
    const learn = byLabel(root, 'Learn a new verse')!;
    expect(learn).toBeDefined();
    learn.click();
    expect(host.sessions[0]!.passageId).toBe(9);
  });
});

describe('Today: A3 first open', () => {
  it('shows the welcome, the reference field, starter chips and the Bible hint', () => {
    host.activeReference = 'John 3:16';
    const root = mount(plan([]));
    expect(text(root.querySelector('h1')!)).toBe('Learn Scripture by heart');
    expect(root.querySelector<HTMLInputElement>('#sm-add-reference')).not.toBeNull();
    expect(byLabel(root, 'Add and start')).toBeDefined();
    expect(text(root)).toContain('Or start with a set:');
    expect(root.querySelectorAll('.sm-chip').length).toBe(SUGGESTED_LISTS.length);
    expect(text(root)).toContain('right-click any verse in the Bible and choose Memorize');
  });

  it('adds the typed verse, then starts it', async () => {
    host.handlers.addPassage = () => ({ ok: true, data: { passage: { id: 42 }, existed: false } });
    const root = mount(plan([]));
    const input = root.querySelector<HTMLInputElement>('#sm-add-reference')!;
    input.value = 'John 3:16';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    expect(host.requests[0]).toMatchObject({ type: 'addPassage', reference: 'John 3:16' });
    expect(host.sessions).toEqual([{ passageId: 42, rung: undefined }]);
  });

  it('uses the verse open in the Bible when the field is empty', async () => {
    host.activeReference = 'Psalm 23';
    host.handlers.addPassage = () => ({ ok: true, data: { passage: { id: 7 }, existed: false } });
    const root = mount(plan([]));
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    expect(host.requests[0]).toMatchObject({ reference: 'Psalm 23' });
    expect(host.sessions[0]!.passageId).toBe(7);
  });

  it('shows the worker error and does not start when the reference is bad', async () => {
    host.handlers.addPassage = () => ({ ok: false, error: 'Could not read that reference.' });
    const root = mount(plan([]));
    root.querySelector<HTMLInputElement>('#sm-add-reference')!.value = 'Jn 99';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    expect(text(root.querySelector('[role="alert"]')!)).toBe('Could not read that reference.');
    expect(host.sessions).toEqual([]);
  });

  it('asks for a reference when nothing is typed or open', async () => {
    const root = mount(plan([]));
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
    expect(text(root.querySelector('[role="alert"]')!)).toContain('Type a reference first');
    expect(host.requests).toEqual([]);
  });

  it('a starter chip creates the list and adds its verses into it without switching scope', async () => {
    host.handlers.createList = (r) => ({ ok: true, data: { lists: [{ id: 5, name: r.name, passageCount: 0, verseCount: 0 }] } });
    host.handlers.addPassage = () => ({ ok: true, data: { passage: { id: 1 }, existed: false } });
    const root = mount(plan([]));
    const set = SUGGESTED_LISTS[0]!;
    (root.querySelector('.sm-chip') as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(host.requests[0]).toMatchObject({ type: 'createList', name: set.name });
    const adds = host.requests.filter((r) => r.type === 'addPassage');
    expect(adds.length).toBe(set.references.length);
    expect(adds.every((r: any) => r.collectionId === 5)).toBe(true);
    expect(host.requests.some((r) => r.type === 'setScope')).toBe(false);
    expect(host.reloads).toBe(1);
  });
});

describe('Today: empty focus', () => {
  it('names the focused list and offers to practice from all lists', async () => {
    const p = plan([], { scope: 2, lists: [{ id: 1, name: 'Default', passageCount: 3, verseCount: 3 }, { id: 2, name: 'Kids', passageCount: 0, verseCount: 0 }] });
    host.handlers.setScope = () => ({ ok: true, data: p });
    const root = mount(p);
    expect(text(root.querySelector('h1')!)).toBe('No verses in Kids yet');
    expect(root.querySelector('#sm-add-reference')).not.toBeNull();
    byLabel(root, 'Practice from all lists')!.click();
    await settle();
    expect(host.requests[0]).toMatchObject({ type: 'setScope', scope: { kind: 'all' } });
    expect(host.reloads).toBe(1);
    expect(host.announcements).toContain('Today now follows all your lists.');
  });
});

describe('Today: extra rows', () => {
  it('shows reminders and sends Review to the card view', () => {
    const root = mount(plan([due(1, 'Psalm 23')]), { reminders: { waiting: 2 } });
    expect(text(root)).toContain('2 reminders waiting');
    byLabel(root, 'Review')!.click();
    expect(host.navigations).toContainEqual({ type: 'goCard' });
  });

  it('hides the reminders row at zero', () => {
    const root = mount(plan([due(1, 'Psalm 23')]), { reminders: { waiting: 0 } });
    expect(text(root)).not.toContain('reminder');
  });

  it('shows the Added row and Practice now starts that verse', () => {
    const root = mount(plan([due(1, 'Psalm 23')]), { justAdded: { passageId: 9, reference: 'John 3:16' } });
    expect(text(root)).toContain('Added John 3:16 to Memory.');
    byLabel(root, 'Practice now')!.click();
    expect(host.sessions[0]!.passageId).toBe(9);
  });

  it('words the row by the add outcome and still offers Practice now', () => {
    const cases = [
      ['added', 'Added John 3:16 to Memory.'],
      ['revived', 'Restored John 3:16 to Memory.'],
      ['exists', 'John 3:16 is already in Memory.'],
    ] as const;
    for (const [outcome, expected] of cases) {
      const root = mount(plan([due(1, 'Psalm 23')]), { justAdded: { passageId: 9, reference: 'John 3:16', outcome } });
      expect(text(root.querySelector('.sm-today-offer-text')!)).toBe(expected);
      byLabel(root, 'Practice now')!.click();
    }
    expect(host.sessions.map((s) => s.passageId)).toEqual([9, 9, 9]);
  });

  it('shows the Added row on the empty first-open screen too', () => {
    const root = mount(plan([]), { justAdded: { passageId: 9, reference: 'John 3:16' } });
    expect(byLabel(root, 'Practice now')).toBeDefined();
  });
});

describe('Today: picker recite entries (review item 4)', () => {
  const ready = { state: 'ready', missingPermissions: [], engineLabel: 'W', onDevice: true, handsFree: true };
  const base = () => [due(1, 'Psalm 23'), fresh(2, 'John 3:16')];
  const openMenu = (root: HTMLElement) => byLabel(root, 'Practice something else')!.click();
  const withRecite = (r: Rung = 'blanks') => pv(1, [rung(r, { attempts: 2, level: 2, dueAt: NOW - HOUR, lastPractisedAt: NOW - 5 * DAY, firstPractisedAt: NOW - 9 * DAY }), rung('recite')], 'Psalm 23');

  it('offers Recite aloud and hands-free only when speech is ready', () => {
    const none = mount(plan(base()));
    openMenu(none);
    expect(byLabel(none, 'Recite aloud')).toBeUndefined();
    container.innerHTML = '';
    const root = mount(plan(base(), { speech: ready as any, reciteDueCount: 1 }));
    openMenu(root);
    expect(byLabel(root, 'Recite aloud')).toBeDefined();
    expect(byLabel(root, 'Recite hands-free')).toBeDefined();
  });

  it('hides hands-free when speech says no', () => {
    const root = mount(plan(base(), { speech: { ...ready, handsFree: false } as any }));
    expect(byLabel(root, 'Recite aloud')).toBeDefined();
    expect(byLabel(root, 'Recite hands-free')).toBeUndefined();
  });

  it('routes recite to startRecite with the right mode, never to startFlow', async () => {
    host.handlers.startRecite = (r) => ({ ok: true, data: { reciteId: 'r1', mode: r.mode } });
    const root = mount(plan(base(), { speech: ready as any, reciteDueCount: 2 }));
    byLabel(root, 'Recite aloud')!.click();
    await settle();
    byLabel(root, 'Recite hands-free')!.click();
    await settle();
    const calls = host.requests.filter((r) => r.type === 'startRecite') as any[];
    expect(calls.map((c) => [c.source, c.mode])).toEqual([[{ kind: 'due' }, 'tap'], [{ kind: 'due' }, 'handsfree']]);
    expect(host.flows).toEqual([]);
    expect(host.navigations.map((n) => n.type)).toEqual(['reciteStarted', 'reciteStarted']);
  });

  it('falls back to one verse when nothing recite-due', async () => {
    host.handlers.startRecite = (r) => ({ ok: true, data: { reciteId: 'r1', mode: r.mode } });
    const root = mount(plan([withRecite()], { speech: ready as any, reciteDueCount: 0 }));
    byLabel(root, 'Recite aloud')!.click();
    await settle();
    expect((host.requests.find((r) => r.type === 'startRecite') as any).source).toEqual({ kind: 'passage', passageId: 1 });
  });

  it('keeps ordinary entries on startFlow', () => {
    const root = mount(plan(base(), { speech: ready as any }));
    byLabel(root, 'Mixed')!.click();
    expect(host.flows).toEqual([{ kind: 'mixed', visited: [] }]);
  });
});

describe('Today: picker menu behavior (review item 10)', () => {
  it('closes on outside click and on Tab, and returns focus to the trigger on Escape', () => {
    const root = mount(plan([due(1, 'Psalm 23')]));
    const trigger = byLabel(root, 'Practice something else')!;
    const panel = root.querySelector<HTMLElement>('[role="menu"]')!;
    trigger.click();
    expect(panel.hidden).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(true);

    trigger.click();
    panel.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    const items = Array.from(panel.querySelectorAll('button'));
    items[items.length - 1]!.focus();
    items[items.length - 1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Today: streak and Practice anyway (review items 8, 12)', () => {
  it('shows the streak on the done screen, hidden at 0', () => {
    const donePlan = plan([doneToday(1, 'Psalm 23')]);
    expect(text(mount(donePlan, { streak: 12 }))).toContain('12 day streak');
    container.innerHTML = '';
    expect(text(mount(donePlan, { streak: 0 }))).not.toContain('streak');
  });

  it('hides Practice anyway when nothing can be practiced; offers it with only beyond-cap new verses', () => {
    const started = [1, 2, 3].map((i) =>
      pv(i, [rung('blanks', { attempts: 1, level: 1, dueAt: NOW + 2 * DAY, lastPractisedAt: NOW - HOUR, firstPractisedAt: NOW - HOUR })], `Started ${i}`),
    );
    const root = mount(plan([...started, fresh(9, 'Beyond cap')]));
    expect(byLabel(root, 'Practice anyway')).toBeDefined();
  });

  it('startedToday from extras lowers the new-verse cap', () => {
    const root = mount(plan([fresh(1), fresh(2)]), { startedToday: 3 });
    expect(text(root.querySelector('h1')!)).toBe('Done for today');
    expect(byLabel(root, 'Learn a new verse')).toBeDefined();
  });
});
