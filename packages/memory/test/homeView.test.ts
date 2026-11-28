/**
 * @vitest-environment jsdom
 *
 * Home tab: practice card, overall progress, list cards, first open, offer and reminders rows.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ListSummary, PanelReply, PanelRequest, PassageView, PlanView, RequestMap, Rung, RungView } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import type { Flow, NavAction } from '../src/ui/state';
import { WordMeasurer } from '../src/ui/measure';
import { renderHome } from '../src/ui/homeView';
import { overallProgress } from '../src/core/progress';

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

/** Same passages scoped to one list, as `scopedView` would hand it over. */
function scoped(all: PlanView, listId: number): PlanView {
  return { ...all, scope: listId, passages: all.passages.filter((p) => p.passage.collectionId === listId) };
}

function mount(all: PlanView, focused: PlanView = all, extras = {}) {
  const root = renderHome(host, all, focused, extras);
  container.appendChild(root);
  return root;
}

const twoLists = (over: Partial<PlanView> = {}) => {
  const passages = [due(1, 'Psalm 23'), fresh(2, 'John 3:16'), { ...doneToday(3, 'Romans 8:28'), passage: { ...doneToday(3, 'Romans 8:28').passage, collectionId: 2 } }];
  return plan(passages, {
    lists: [
      { id: 1, name: 'Default', passageCount: 2, verseCount: 2 },
      { id: 2, name: 'Romans', passageCount: 1, verseCount: 1 },
      { id: 3, name: 'Empty one', passageCount: 0, verseCount: 0 },
    ],
    ...over,
  });
};

describe('Home: practice card', () => {
  it('shows counts, minutes and Start practicing when something is due', () => {
    const root = mount(plan([due(1, 'Psalm 23'), fresh(2, 'John 3:16')]));
    const card = root.querySelector('.sm-home-practice')!;
    expect(text(card)).toMatch(/1 to review, 1 new · About \d+ minutes?/);
    expect(byLabel(card, 'Start practicing')).toBeDefined();
    expect(byLabel(card, "See what's next")).toBeDefined();
    expect(root.querySelector('.sm-home-focus-note')).toBeNull();
  });

  it('Start calls startFlow and stays disabled while starting', async () => {
    let release!: () => void;
    host.startFlow = (flow: Flow) => { host.flows.push(flow); return new Promise<boolean>((r) => { release = () => r(true); }); };
    const root = mount(plan([due(1, 'Psalm 23')]));
    const start = byLabel(root, 'Start practicing')!;
    start.click();
    expect(host.flows).toEqual([{ kind: 'today', skipped: [] }]);
    expect(start.disabled).toBe(true);
    release();
    await settle();
    expect(start.disabled).toBe(false);
  });

  it('says Continue once something was done today', () => {
    const root = mount(plan([due(1, 'Psalm 23'), doneToday(2, 'John 3:16')]));
    expect(byLabel(root, 'Continue')).toBeDefined();
    expect(byLabel(root, 'Start practicing')).toBeUndefined();
  });

  it("See what's next goes to the Practice tab", () => {
    const root = mount(plan([due(1, 'Psalm 23')]));
    byLabel(root, "See what's next")!.click();
    expect(host.navigations).toEqual([{ type: 'goTab', tab: 'practice' }]);
  });

  it('shows Done for today, the next review and the streak', () => {
    const root = mount(plan([doneToday(1, 'Psalm 23')], { streakDays: 4 }));
    const card = root.querySelector('.sm-home-practice')!;
    expect(text(card)).toContain('Done for today');
    expect(text(card)).toContain('Next review');
    expect(text(card)).toContain('4 day streak');
    expect(buttons(card).filter((b) => b.classList.contains('sm-btn-primary'))).toEqual([]);
  });

  it('notes the focus list when practice is scoped to one list', () => {
    const all = twoLists({ focus: 2 });
    const root = mount(all, scoped(all, 2));
    expect(text(root.querySelector('.sm-home-focus-note')!)).toBe('Practicing from Romans');
    expect(text(root.querySelector('.sm-home-practice')!)).toContain('Done for today');
  });
});

describe('Home: progress and lists', () => {
  it('has an h2 focus target and the overall progress bar', () => {
    const all = twoLists();
    const root = mount(all);
    const h2 = root.querySelector('h2.sm-screen-title')!;
    expect(h2.getAttribute('tabindex')).toBe('-1');
    const p = overallProgress(all.passages);
    const bar = root.querySelector('.sm-home-overall [role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe(String(p.percent));
    expect(text(root.querySelector('.sm-home-overall')!)).toContain(
      `${p.percent}% of activities complete · ${p.versesLearned} of 3 verses learned`,
    );
  });

  it('draws one card per list with its count and percent', () => {
    const all = twoLists();
    const root = mount(all);
    const cards = Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-home-list'));
    expect(cards.map((c) => text(c.querySelector('.sm-home-list-name')!))).toEqual(['Default', 'Romans', 'Empty one']);
    const p1 = overallProgress(all.passages.filter((x) => x.passage.collectionId === 1));
    expect(text(cards[0]!)).toContain('2 verses');
    expect(text(cards[0]!)).toContain(`${p1.percent}% complete`);
    expect(cards[0]!.getAttribute('aria-label')).toBe(`Default, 2 verses, ${p1.percent}% complete`);
    expect(text(cards[1]!)).toContain('1 verse');
    expect(text(cards[2]!)).toContain('No verses yet');
    expect(cards[2]!.querySelector('.sm-home-list-percent')).toBeNull();
  });

  it('tags the practice focus list', () => {
    const all = twoLists({ focus: 2 });
    const root = mount(all, scoped(all, 2));
    const tags = Array.from(root.querySelectorAll('.sm-home-tag'));
    expect(tags.length).toBe(1);
    expect(tags[0]!.closest('.sm-home-list')!.querySelector('.sm-home-list-name')!.textContent).toBe('Romans');
    expect(tags[0]!.closest('.sm-home-list')!.getAttribute('aria-label')).toContain('Practice focus');
  });

  it('a list card opens My verses filtered to that list', () => {
    const root = mount(twoLists());
    root.querySelectorAll<HTMLButtonElement>('.sm-home-list')[1]!.click();
    expect(host.navigations).toEqual([{ type: 'goVerses', list: 2 }]);
  });
});

describe('Home: first open', () => {
  it('shows the welcome, the add form, starter sets and the tip, and nothing else', () => {
    const root = mount(plan([]));
    expect(text(root.querySelector('h2')!)).toBe('Learn Scripture by heart');
    expect(root.querySelector('#sm-add-reference')).not.toBeNull();
    expect(root.querySelector('.sm-home-practice')).toBeNull();
    expect(root.querySelector('.sm-home-overall')).toBeNull();
    expect(root.querySelector('.sm-home-lists')).toBeNull();
    expect(text(root)).toContain('right-click any verse');
    byLabel(root, 'Browse starter sets')!.click();
    expect(host.navigations).toEqual([{ type: 'goStarters' }]);
  });

  it('Add and start adds the verse and starts it', async () => {
    host.handlers.addPassage = () => ({ ok: true, data: { passage: { id: 42 }, existed: false } });
    const root = mount(plan([]));
    root.querySelector<HTMLInputElement>('#sm-add-reference')!.value = 'John 3:16';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(host.requests).toEqual([{ type: 'addPassage', reference: 'John 3:16' }]);
    expect(host.sessions).toEqual([{ passageId: 42, rung: undefined }]);
  });
});

describe('Home: offer and reminders rows', () => {
  it('shows reminders and sends Review to the card view', () => {
    const root = mount(plan([due(1, 'Psalm 23')]), undefined, { reminders: { waiting: 2 } });
    expect(text(root)).toContain('2 reminders waiting');
    byLabel(root, 'Review')!.click();
    expect(host.navigations).toEqual([{ type: 'goCard' }]);
  });

  it('hides the reminders row at zero', () => {
    const root = mount(plan([due(1, 'Psalm 23')]), undefined, { reminders: { waiting: 0 } });
    expect(root.querySelector('.sm-home-reminders')).toBeNull();
  });

  it('offers Practice now for a verse just added', () => {
    const root = mount(plan([due(1, 'Psalm 23')]), undefined, { justAdded: { passageId: 9, reference: 'John 3:16' } });
    expect(text(root.querySelector('.sm-home-offer')!)).toContain('Added John 3:16 to Memory.');
    byLabel(root, 'Practice now')!.click();
    expect(host.sessions).toEqual([{ passageId: 9, rung: undefined }]);
  });

  it.each([
    ['revived', 'Restored John 3:16 to Memory.'],
    ['exists', 'John 3:16 is already in Memory.'],
  ] as const)('words the offer for outcome %s', (outcome, expected) => {
    const root = mount(plan([due(1, 'Psalm 23')]), undefined, { justAdded: { passageId: 9, reference: 'John 3:16', outcome } });
    expect(text(root.querySelector('.sm-home-offer')!)).toContain(expected);
  });
});
