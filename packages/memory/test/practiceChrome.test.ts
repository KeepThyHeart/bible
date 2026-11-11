/**
 * @vitest-environment jsdom
 *
 * The practice screen's chrome (task 0219, Direction A): one title, one bar
 * with a plain count, the "..." menu, Esc to close, and the after-verse screen.
 * Exercise behaviour stays in panelRender.test.ts.
 */
// Fixtures are hand-built and loosely typed.
// @ts-nocheck

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  BlanksStep,
  PanelReply,
  PanelRequest,
  PassageContext,
  PassageView,
  PlanView,
  RequestMap,
  Rung,
  RungView,
  SessionSummary,
  SessionView,
  VerseText,
} from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import type { Flow, NavAction } from '../src/ui/state';
import { WordMeasurer } from '../src/ui/measure';
import { PracticeView } from '../src/ui/practiceView';
import { RUNG_LABEL } from '../src/ui/format';

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const DAY = 86_400_000;

const VERSE: VerseText = {
  verseId: 19023001,
  label: '23:1',
  words: ['The', 'LORD', 'is', 'my', 'shepherd;', 'I', 'shall', 'not', 'want.'],
  lines: null,
  psalmTitle: null,
  paragraphStart: true,
};

const blanks = (): BlanksStep => ({
  kind: 'blanks',
  verses: [VERSE],
  blanks: [{ verseId: VERSE.verseId, indices: [1, 4] }],
  answerMode: 'fullWord',
  stepNumber: 1,
  totalSteps: 6,
});

const context = (reference = 'Psalm 23'): PassageContext => ({
  passageId: 1,
  reference,
  before: [],
  verses: [VERSE],
  after: [],
});

function rungView(over: Partial<RungView> & Pick<RungView, 'rung'>): RungView {
  return {
    level: 1, dueAt: null, streak: 0, lastScore: null, applicable: true, resume: null,
    tiers: 2, tiersPassed: 0, bestScore: null, attempts: 1, nextTier: 0,
    lastPractisedAt: NOW - 5 * DAY, firstPractisedAt: NOW - 5 * DAY, ...over,
  };
}

function passageView(id: number, dueAt: number | null = null, rungs?: RungView[]): PassageView {
  return {
    passage: {
      id, collectionId: 1, moduleId: 'kjv', startVerseId: 19023001, endVerseId: 19023001,
      reference: `Ref ${id}`, verseCount: 1, addedAt: NOW - 30 * DAY + id, answerMode: null,
    },
    dueCount: 0,
    bestLevel: 1,
    wellLearned: false,
    rungs: rungs ?? [
      rungView({ rung: 'ordering', dueAt }),
      rungView({ rung: 'refmatch', applicable: false, attempts: 0 }),
      rungView({ rung: 'blanks', dueAt }),
      rungView({ rung: 'firstletters', dueAt }),
      rungView({ rung: 'refprovide', applicable: false, attempts: 0 }),
      rungView({ rung: 'recite', applicable: true }),
    ],
  };
}

function plan(passages: PassageView[]): PlanView {
  return {
    collectionId: 1, collectionName: 'Default',
    lists: [{ id: 1, name: 'Default', passageCount: passages.length, verseCount: 0 }],
    scope: 'all', scopeVerseCount: 0, referenceActivitiesUnlocked: true,
    passages, totalDue: 0, defaultAnswerMode: 'firstLetter', sortOrder: 'bible',
  };
}

function session(over: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'session-1', passageId: 1, rung: 'blanks', tier: 0, tiers: 1,
    step: blanks(), correctFirst: 0, stepsTaken: 0, ...over,
  };
}

const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  passageId: 1, rung: 'blanks', tier: 0, tiers: 1, score: 0.8, correctFirst: 5, totalSteps: 6,
  nextDueAt: NOW + 3 * DAY, level: 2, passageWellLearned: false, ...over,
});

type Handlers = { [K in PanelRequest['type']]?: (r: any) => PanelReply<RequestMap[K]> };

class TestHost implements PanelHost {
  readonly requests: PanelRequest[] = [];
  readonly navigations: NavAction[] = [];
  readonly sessions: { passageId: number; rung?: Rung; restart?: boolean; tier?: number; flow?: Flow }[] = [];
  readonly flows: Flow[] = [];
  readonly opened: number[] = [];
  readonly announcements: string[] = [];
  activeReference = null;
  readonly measurer = new WordMeasurer(document);
  handlers: Handlers = {};
  now() { return NOW; }
  request(r: PanelRequest) {
    this.requests.push(r);
    const h = this.handlers[r.type];
    return Promise.resolve(h ? h(r) : { ok: false, error: `No stub for ${r.type}` });
  }
  go(a: NavAction) { this.navigations.push(a); }
  reload() {}
  async startSession(passageId, rung, restart, tier, flow) { this.sessions.push({ passageId, rung, restart, tier, flow }); }
  async startFlow(flow: Flow) { this.flows.push(flow); return true; }
  openInBible(id: number) { this.opened.push(id); }
  announce(m: string) { this.announcements.push(m); }
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

let container: HTMLElement;
let host: TestHost;
let view: PracticeView | null = null;

async function mountView(
  over: Partial<SessionView> = {},
  flow?: Flow,
  opts: { ctx?: PassageContext; pv?: PassageView; speech?: boolean } = {},
): Promise<PracticeView> {
  host.handlers.getContext = () => ({ ok: true, data: opts.ctx ?? context() });
  host.handlers.getPassageView = () => ({ ok: true, data: opts.pv ?? passageView(1) });
  host.handlers.getSettings = () => ({ ok: true, data: { speech: { state: opts.speech ? 'ready' : 'unavailable' } } });
  host.handlers.endSession = () => ({ ok: true, data: { summary: null } });
  const p = new PracticeView(host, session(over), flow);
  p.mount(container);
  await settle();
  view = p;
  return p;
}

const title = (p: PracticeView) => p.root.querySelector('.sm-focused-title')!.textContent;
const menuTrigger = (p: PracticeView) => p.root.querySelector<HTMLButtonElement>('.sm-menu-btn')!;
const menuLabels = (p: PracticeView) =>
  Array.from(p.root.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent);
const menuItem = (p: PracticeView, label: string) =>
  Array.from(p.root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === label)!;
const esc = (target: EventTarget = view!.root) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  host = new TestHost();
});

afterEach(() => {
  view?.destroy();
  view = null;
});

describe('header', () => {
  it('has one title "{reference} · {activity}" and a Close button', async () => {
    const p = await mountView();
    expect(p.root.querySelectorAll('h1').length).toBe(1);
    expect(title(p)).toBe(`Psalm 23 · ${RUNG_LABEL.blanks}`);
    const close = p.root.querySelector<HTMLButtonElement>('.sm-focused-close')!;
    expect(close.getAttribute('aria-label')).toBe('Close practice');
    close.click();
    await settle();
    expect(host.requests.some((r) => r.type === 'endSession')).toBe(true);
    expect(host.navigations).toEqual([{ type: 'sessionEnded' }]);
  });

  it('shows just the activity name when the reference is the answer', async () => {
    const p = await mountView({ rung: 'refmatch' });
    expect(title(p)).toBe(RUNG_LABEL.refmatch);
  });

  it('has one progress bar with a plain "{step} of {total}" count and nothing else', async () => {
    const p = await mountView({ tier: 1, tiers: 2 });
    expect(p.root.querySelectorAll('[role="progressbar"]').length).toBe(1);
    expect(p.root.querySelector('.sm-step-count')!.textContent).toBe('1 of 6');
    expect(p.root.querySelector('[role="tab"], .kth-tabs, .sm-icon-btn, .sm-practice-tier, .sm-step-tally')).toBeNull();
    const buttons = Array.from(p.root.querySelectorAll('.sm-practice-head button')).map((b) => b.textContent);
    expect(buttons.some((t) => t === 'Next')).toBe(false);
    expect(p.root.textContent).not.toContain('Tier');
  });
});

describe('the "..." menu', () => {
  it('for a single verse offers Switch activity and Show in Bible only', async () => {
    const p = await mountView();
    expect(menuLabels(p)).toEqual(['Switch activity', 'Show in Bible']);
  });

  it('for a queue flow adds Skip this verse', async () => {
    const p = await mountView({}, { kind: 'mixed', visited: [] });
    expect(menuLabels(p)).toEqual(['Switch activity', 'Skip this verse', 'Show in Bible']);
  });

  it('offers Harder on the first tier and Easier on the last, only with more than one tier', async () => {
    let p = await mountView({ tier: 0, tiers: 2 });
    expect(menuLabels(p)).toEqual(['Switch activity', 'Show in Bible', 'Harder version']);
    p.destroy();
    container.innerHTML = '';
    p = await mountView({ tier: 1, tiers: 2 });
    expect(menuLabels(p)).toEqual(['Switch activity', 'Show in Bible', 'Easier version']);
  });

  it('is keyboard operable: opens on the first item and arrows move between items', async () => {
    const p = await mountView({}, { kind: 'mixed', visited: [] });
    menuTrigger(p).click();
    const items = Array.from(p.root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(document.activeElement).toBe(items[0]);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[1]);
  });

  it('Show in Bible opens the first verse', async () => {
    const p = await mountView();
    menuItem(p, 'Show in Bible').click();
    expect(host.opened).toEqual([VERSE.verseId]);
  });

  it('Skip this verse ends the session, then starts a NEW flow with the verse added (today: skipped, others: visited)', async () => {
    const order: string[] = [];
    const flow: Flow = { kind: 'today', skipped: [9] };
    const p = await mountView({}, flow);
    host.handlers.endSession = () => { order.push('end'); return { ok: true, data: { summary: null } }; };
    const startFlow = host.startFlow.bind(host);
    host.startFlow = async (f) => { order.push('flow'); return startFlow(f); };
    menuItem(p, 'Skip this verse').click();
    await settle();
    expect(order).toEqual(['end', 'flow']);
    expect(host.flows).toEqual([{ kind: 'today', skipped: [9, 1] }]);
    expect(flow).toEqual({ kind: 'today', skipped: [9] }); // immutable
  });

  it('Skip on a mixed flow appends to visited', async () => {
    const p = await mountView({}, { kind: 'mixed', visited: [4] });
    menuItem(p, 'Skip this verse').click();
    await settle();
    expect(host.flows).toEqual([{ kind: 'mixed', visited: [4, 1] }]);
  });

  it('Harder version restarts the activity one tier up, keeping the flow', async () => {
    const flow: Flow = { kind: 'verse', passageId: 1 };
    const p = await mountView({ tier: 0, tiers: 2 }, flow);
    menuItem(p, 'Harder version').click();
    await settle();
    expect(host.sessions).toEqual([{ passageId: 1, rung: 'blanks', restart: true, tier: 1, flow }]);
  });

  it('Switch activity lists the other applicable activities in ladder order, and ends the old session first', async () => {
    const order: string[] = [];
    const p = await mountView();
    host.handlers.endSession = (r) => { order.push(`end:${r.sessionId}`); return { ok: true, data: { summary: null } }; };
    const start = host.startSession.bind(host);
    host.startSession = async (...a) => { order.push('start'); return start(...a); };
    menuItem(p, 'Switch activity').click();
    const dialog = document.querySelector('[role="dialog"]')!;
    const labels = Array.from(dialog.querySelectorAll('.sm-switch-list button')).map((b) => b.textContent);
    expect(labels).toEqual([RUNG_LABEL.ordering, RUNG_LABEL.firstletters]);
    (dialog.querySelectorAll('.sm-switch-list button')[1] as HTMLButtonElement).click();
    await settle();
    expect(order).toEqual(['end:session-1', 'start']);
    expect(host.sessions[0]).toMatchObject({ passageId: 1, rung: 'firstletters' });
  });

  it('Switch activity offers Recite aloud only when speech is ready, and starts a recite run', async () => {
    let p = await mountView();
    menuItem(p, 'Switch activity').click();
    expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain(RUNG_LABEL.recite);
    p.destroy();
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);

    host.handlers.startRecite = () => ({ ok: true, data: { reciteId: 'r1', mode: 'tap' } });
    p = await mountView({}, undefined, { speech: true });
    menuItem(p, 'Switch activity').click();
    const recite = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === RUNG_LABEL.recite)!;
    recite.click();
    await settle();
    expect(host.requests.some((r) => r.type === 'startRecite')).toBe(true);
    expect(host.sessions.length).toBe(0);
  });
});

describe('Esc', () => {
  it('closes practice', async () => {
    const p = await mountView();
    esc();
    await settle();
    expect(host.navigations).toEqual([{ type: 'sessionEnded' }]);
    void p;
  });

  it('closes an open menu first, and does not close practice', async () => {
    const p = await mountView();
    menuTrigger(p).click();
    esc(document.activeElement!);
    await settle();
    expect(host.requests.some((r) => r.type === 'endSession')).toBe(false);
    expect(p.root.querySelector<HTMLElement>('[role="menu"]')!.hidden).toBe(true);
  });

  it('does nothing while a dialog is open', async () => {
    const p = await mountView();
    menuItem(p, 'Switch activity').click();
    esc();
    await settle();
    expect(host.requests.some((r) => r.type === 'endSession')).toBe(false);
  });

  it('ignores an Escape from outside the Memory UI (the reader on web)', async () => {
    await mountView();
    const reader = document.createElement('input');
    document.body.appendChild(reader);
    esc(reader);
    await settle();
    expect(host.requests.some((r) => r.type === 'endSession')).toBe(false);
  });

  it('counts an Escape with nothing focused (picker steps focus nothing)', async () => {
    await mountView();
    esc(document.body);
    await settle();
    expect(host.navigations).toEqual([{ type: 'sessionEnded' }]);
  });

  it('counts an Escape anywhere inside the .sm-app root', async () => {
    container.classList.add('sm-app');
    const sibling = document.createElement('button');
    container.appendChild(sibling);
    await mountView();
    esc(sibling);
    await settle();
    expect(host.navigations).toEqual([{ type: 'sessionEnded' }]);
  });

  it('counts Escape in a typed slot that holds text', async () => {
    const p = await mountView();
    const field = document.createElement('input');
    p.root.appendChild(field);
    field.value = 'goodn';
    esc(field);
    await settle();
    expect(host.navigations).toEqual([{ type: 'sessionEnded' }]);
  });

  it('stops listening once the view is destroyed', async () => {
    const p = await mountView();
    p.destroy();
    host.requests.length = 0;
    esc(p.root);
    await settle();
    expect(host.requests).toEqual([]);
  });
});

describe('after-verse screen (A5)', () => {
  async function finish(
    flow: Flow | undefined,
    sum = summary(),
    pl?: PlanView,
    getPlan: Handlers['getPlan'] = () => ({ ok: true, data: pl ?? plan([]) }),
  ): Promise<PracticeView> {
    host.handlers.getPlan = getPlan;
    host.handlers.submitStep = () => ({
      ok: true,
      data: { result: { correct: true, wrong: [], blocking: false }, session: session({ step: null }), summary: sum },
    });
    const p = await mountView({}, flow);
    // Drive the last step to the summary: a fullWord blanks step graded correct, then Finish.
    p.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    await settle();
    const finishBtn = p.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button');
    if (finishBtn && finishBtn.textContent === 'Finish') {
      finishBtn.click();
      await settle();
    }
    return p;
  }
  const actions = (p: PracticeView) =>
    Array.from(p.root.querySelectorAll('.sm-exercise-actions button')).map((b) => b.textContent);

  it('shows reference, score, next review and a status chip', async () => {
    const p = await finish(undefined);
    const text = p.root.querySelector('.sm-summary')!.textContent!;
    expect(p.root.querySelector('.sm-summary-title')!.textContent).toBe('Psalm 23');
    expect(text).toContain('5 of 6 right first time');
    expect(text).toContain('In 3 days');
    expect(p.root.querySelector('.sm-status')!.textContent).toBe('Learning');
    expect(p.root.querySelector('.sm-summary-level, .sm-level-box')).toBeNull();
    expect(text).not.toContain('Tier');
  });

  it('a well-learned verse is Known', async () => {
    const p = await finish(undefined, summary({ passageWellLearned: true }));
    expect(p.root.querySelector('.sm-status')!.textContent).toBe('Known');
  });

  it('a single verse ends with Done and Again, with no Stop for today', async () => {
    const p = await finish({ kind: 'verse', passageId: 1 });
    expect(actions(p)).toEqual(['Done', 'Again']);
  });

  it('Again restarts the same activity with the same flow', async () => {
    const flow: Flow = { kind: 'verse', passageId: 1 };
    const p = await finish(flow);
    Array.from(p.root.querySelectorAll<HTMLButtonElement>('.sm-exercise-actions button')).find((b) => b.textContent === 'Again')!.click();
    expect(host.sessions).toEqual([{ passageId: 1, rung: 'blanks', restart: undefined, tier: undefined, flow }]);
  });

  it('the today flow says Continue (N left), starts the flow with this verse skipped, and offers Stop for today', async () => {
    const pl = plan([passageView(1, NOW + DAY), passageView(2, NOW - 2 * DAY), passageView(3, NOW - DAY)]);
    const p = await finish({ kind: 'today', skipped: [] }, summary(), pl);
    expect(actions(p)).toEqual(['Continue (2 left)', 'Again', 'Stop for today']);
    const buttons = Array.from(p.root.querySelectorAll<HTMLButtonElement>('.sm-exercise-actions button'));
    buttons[0]!.click();
    expect(host.flows).toEqual([{ kind: 'today', skipped: [1] }]);
    buttons[2]!.click();
    await settle();
    expect(host.navigations).toContainEqual({ type: 'stopForToday' });
    expect(host.requests.some((r) => r.type === 'endSession')).toBe(true);
  });

  it('the today flow with nothing left says Done', async () => {
    const pl = plan([passageView(1, NOW + DAY)]);
    const p = await finish({ kind: 'today', skipped: [] }, summary(), pl);
    expect(actions(p)).toEqual(['Done', 'Again', 'Stop for today']);
  });

  it('the today flow offers no new verse when the all-lists plan cannot be read (cap treated as reached)', async () => {
    const fresh = (id: number) =>
      passageView(id, null, (['ordering', 'blanks', 'firstletters'] as const).map((rung) =>
        rungView({ rung, attempts: 0, dueAt: null, lastPractisedAt: null, firstPractisedAt: null })));
    const scoped = { ...plan([passageView(1, NOW + DAY), fresh(2)]), scope: 1 } as unknown as PlanView;
    const all = plan([passageView(1, NOW + DAY), fresh(2)]);

    const flow: Flow = { kind: 'today', skipped: [] };
    let p = await finish(flow, summary(), undefined, (r) => ({ ok: true, data: r.scope?.kind === 'all' ? all : scoped }));
    expect(actions(p)).toEqual(['Continue (1 left)', 'Again', 'Stop for today']);
    p.destroy();
    container.innerHTML = '';

    p = await finish(flow, summary(), undefined, (r) =>
      r.scope?.kind === 'all' ? { ok: false, error: 'offline' } : { ok: true, data: scoped });
    expect(actions(p)).toEqual(['Done', 'Again', 'Stop for today']);
  });

  it('an open-ended flow says plain Continue and appends the verse to visited', async () => {
    const p = await finish({ kind: 'mixed', visited: [7] });
    expect(actions(p)).toEqual(['Continue', 'Again', 'Stop for today']);
    p.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    expect(host.flows).toEqual([{ kind: 'mixed', visited: [7, 1] }]);
  });

  it('Done leaves practice', async () => {
    const p = await finish({ kind: 'verse', passageId: 1 });
    p.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    await settle();
    expect(host.navigations).toEqual([{ type: 'sessionEnded' }]);
  });
});
