/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ListSummary, PanelReply, PanelRequest, PassageView, RequestMap, Rung, RungView, SpeechAvailability } from '../src/core/types';
import { setReciteEnabledForTests } from '../src/core/features';
import type { PanelHost } from '../src/ui/host';
import type { Flow, NavAction } from '../src/ui/state';
import { WordMeasurer } from '../src/ui/measure';
import { renderVersePage } from '../src/ui/versePage';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();

const READY: SpeechAvailability = { state: 'ready', missingPermissions: [], engineLabel: 'Whisper', onDevice: true, handsFree: true };
const NO_VOICE: SpeechAvailability = { ...READY, handsFree: false };

function rung(r: Rung, over: Partial<RungView> = {}): RungView {
  return {
    rung: r, level: 0, dueAt: null, streak: 0, lastScore: null, applicable: true, resume: null,
    tiers: 2, tiersPassed: 0, bestScore: null, attempts: 0, nextTier: 0, ...over,
  } as RungView;
}

function pv(rungs: RungView[], over: Partial<PassageView['passage']> = {}, wellLearned = false): PassageView {
  return {
    passage: { id: 7, collectionId: 1, moduleId: 'kjv', startVerseId: 70, endVerseId: 70, reference: 'John 3:16', verseCount: 1, addedAt: 1, answerMode: null, reciteOn: false, ...over },
    rungs, dueCount: 0, bestLevel: 0, wellLearned,
  } as PassageView;
}

const LISTS: ListSummary[] = [
  { id: 1, name: 'Default', passageCount: 1, verseCount: 1 },
  { id: 2, name: 'Romans Road', passageCount: 0, verseCount: 0 },
];

class Host implements PanelHost {
  requests: PanelRequest[] = [];
  navigations: NavAction[] = [];
  announcements: string[] = [];
  sessions: number[] = [];
  rungs: Array<Rung | undefined> = [];
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
  async startSession(passageId: number, r?: Rung) { this.sessions.push(passageId); this.rungs.push(r); }
  async startFlow(_f: Flow) { return true; }
  openInBible(id: number) { this.bible.push(id); }
  announce(m: string) { this.announcements.push(m); }
}

let host: Host;
let container: HTMLElement;
beforeEach(() => {
  setReciteEnabledForTests(false);
  host = new Host();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  setReciteEnabledForTests(true);
  container.remove();
  document.querySelectorAll('.sm-modal-backdrop').forEach((n) => n.remove());
});

const text = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttons = (n: ParentNode) => Array.from(n.querySelectorAll('button'));
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

function mount(p: PassageView, extras: Parameters<typeof renderVersePage>[3] = {}, lists = LISTS) {
  const root = renderVersePage(host, p, lists, extras);
  container.appendChild(root);
  return root;
}
function openMenu(root: Element) {
  root.querySelector<HTMLElement>('button[aria-label^="Actions for"]')!.click();
  return root.querySelector('[role="menu"]')!;
}
const menuItem = (m: Element, label: string) => buttons(m).find((b) => text(b) === label)!;
const modalButton = (label: string) => buttons(document.querySelector('.sm-modal-backdrop')!).find((b) => text(b) === label)!;

const learning = () =>
  pv([
    rung('ordering', { applicable: false }),
    rung('blanks', { attempts: 2, level: 2, dueAt: NOW + 3 * DAY, lastPractisedAt: NOW - DAY }),
    rung('firstletters', { attempts: 1, level: 1, dueAt: NOW - HOUR, lastPractisedAt: NOW - 2 * DAY }),
    rung('refmatch', { applicable: false }),
    rung('recite', { optional: true }),
  ]);

describe('header and status', () => {
  it('shows the reference as the title, the translation, and a close button back to where it was opened', () => {
    const root = mount(learning());
    expect(text(root.querySelector('h1')!)).toBe('John 3:16');
    expect(text(root.querySelector('.sm-focused-head')!)).toContain('kjv');
    root.querySelector<HTMLElement>('.sm-focused-close')!.click();
    expect(host.navigations).toEqual([{ type: 'leaveVerse' }]);
  });

  it('shows status and next review as text', () => {
    const root = mount(learning());
    expect(text(root.querySelector('.sm-status')!)).toBe('Learning');
    expect(text(root.querySelector('.sm-verse-page-next')!)).toBe('Due today');
  });

  it('a verse never practiced is New and Not started; a well-learned one is Known', () => {
    const fresh = mount(pv([rung('blanks')]));
    expect(text(fresh.querySelector('.sm-status')!)).toBe('New');
    expect(text(fresh.querySelector('.sm-verse-page-next')!)).toBe('Not started');
    const known = mount(pv([rung('blanks', { attempts: 4, level: 5, dueAt: NOW + 20 * DAY })], {}, true));
    expect(text(known.querySelector('.sm-status-known')!)).toBe('Known');
  });

  it('renders the verse text when supplied', () => {
    const root = mount(learning(), { verses: [{ verseId: 70, label: '3:16', words: ['For', 'God'], lines: null, psalmTitle: null, paragraphStart: false } as any] });
    expect(text(root.querySelector('.sm-verse-text')!)).toContain('For God');
  });
});

describe('Practice now', () => {
  it('starts the verse (flow verse) through startSession with the passage id only', () => {
    const root = mount(learning());
    buttons(root).find((b) => text(b) === 'Practice now')!.click();
    expect(host.sessions).toEqual([7]);
  });
});

describe('Activities', () => {
  it('is a collapsed details listing only applicable activities, with no level boxes or n/5', () => {
    const root = mount(learning());
    const details = root.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(text(details.querySelector('summary')!)).toBe('Activities');
    const names = Array.from(details.querySelectorAll('.sm-activity-name')).map(text);
    expect(names).toEqual(['Fill in the blanks', 'First letters']);
    expect(details.querySelector('.sm-level-boxes, .sm-level-box')).toBeNull();
    expect(text(details)).not.toMatch(/\d\/5/);
  });

  it('each row shows its next review text', () => {
    const root = mount(learning());
    const nexts = Array.from(root.querySelectorAll('.sm-activity-next')).map(text);
    expect(nexts).toEqual(['In 3 days', 'Due today']);
  });

  it('gives each row an accessible text alternative and a Practice button for that activity', () => {
    const root = mount(learning());
    const rows = Array.from(root.querySelectorAll('.sm-verse-activity'));
    expect(rows.map((r) => text(r.querySelector('.sm-sr-only')!))).toEqual([
      'Fill in the blanks, Learning, next review In 3 days',
      'First letters, Learning, next review Due today',
    ]);
    const second = rows[1]!;
    buttons(second).find((b) => text(b) === 'Practice')!.click();
    expect(host.sessions).toEqual([7]);
    expect(host.rungs).toEqual(['firstletters']);
  });
});

describe('Recite aloud row', () => {
  it('is absent while recite is disabled', () => {
    const root = mount(learning(), { speech: READY });
    expect(text(root)).not.toMatch(/recite/i);
    expect(root.querySelector('#sm-recite-on')).toBeNull();
  });

  it('shows when enabled, with practice and hands-free buttons that start a recite run', async () => {
    setReciteEnabledForTests(true);
    const root = mount(learning(), { speech: READY });
    expect(Array.from(root.querySelectorAll('.sm-activity-name')).map(text)).toContain('Recite aloud');
    const tap = root.querySelector<HTMLButtonElement>('button[aria-label^="Recite:"]')!;
    const free = root.querySelector<HTMLButtonElement>('[data-testid="recite-handsfree"]')!;
    expect(tap.disabled).toBe(false);
    expect(free.disabled).toBe(false);
    tap.click();
    free.click();
    await settle();
    const starts = host.requests.filter((r) => (r as any).type === 'startRecite') as any[];
    expect(starts.map((r) => r.mode)).toEqual(['tap', 'handsfree']);
  });

  it('disables hands-free without a voice and both without speech; explains why', () => {
    setReciteEnabledForTests(true);
    const noVoice = mount(learning(), { speech: NO_VOICE });
    expect(noVoice.querySelector<HTMLButtonElement>('[data-testid="recite-handsfree"]')!.disabled).toBe(true);
    expect(noVoice.querySelector<HTMLButtonElement>('button[aria-label^="Recite:"]')!.disabled).toBe(false);
    const unknown = mount(learning(), {});
    expect(unknown.querySelectorAll<HTMLButtonElement>('[data-rung="recite"] .sm-activity-actions button')[0]!.disabled).toBe(true);
    expect(text(unknown)).toMatch(/Checking whether speech/);
  });

  it('the include checkbox sets the per-verse recite flag and reloads', async () => {
    setReciteEnabledForTests(true);
    const root = mount(learning(), { speech: READY });
    const box = root.querySelector<HTMLInputElement>('#sm-recite-on')!;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(host.requests).toContainEqual({ type: 'setPassageRecite', passageId: 7, on: true });
    expect(host.reloads).toBe(1);
  });
});

describe('menu', () => {
  it('lists answer mode, reset, show in Bible, move and remove, without Practice now or Open verse', () => {
    const menu = openMenu(mount(learning()));
    expect(buttons(menu).map(text)).toEqual([
      'Answer with...', 'Reset progress', 'Show in Bible', 'Move to Romans Road', 'Remove',
    ]);
  });

  it('answer mode sets the per-verse override and reloads', async () => {
    const root = mount(pv([rung('blanks')], { answerMode: 'fullWord' }), { defaultAnswerMode: 'firstLetter' });
    menuItem(openMenu(root), 'Answer with...').click();
    const select = document.querySelector<HTMLSelectElement>('#sm-answer-mode')!;
    expect(select.value).toBe('fullWord');
    expect(text(select.options[0]!)).toBe('Default (first letter)');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(host.requests).toContainEqual({ type: 'setPassageAnswerMode', passageId: 7, mode: null });
    expect(host.reloads).toBe(1);
    expect(document.querySelector('#sm-answer-mode')).toBeNull();
  });

  it('reset progress asks first, then resets, announces and reloads', async () => {
    const root = mount(learning());
    menuItem(openMenu(root), 'Reset progress').click();
    expect(host.requests.some((r) => r.type === 'resetPassageProgress')).toBe(false);
    modalButton('Cancel').click();
    expect(host.requests.some((r) => r.type === 'resetPassageProgress')).toBe(false);

    menuItem(openMenu(root), 'Reset progress').click();
    modalButton('Yes, reset').click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'resetPassageProgress', passageId: 7 });
    expect(host.announcements.join(' ')).toContain('John 3:16');
    expect(host.reloads).toBe(1);
  });

  it('a failed reset shows the error and keeps the dialog', async () => {
    host.handlers.resetPassageProgress = () => ({ ok: false, error: 'nope' });
    const root = mount(learning());
    menuItem(openMenu(root), 'Reset progress').click();
    modalButton('Yes, reset').click();
    await settle();
    expect(document.body.textContent).toContain('nope');
    expect(host.reloads).toBe(0);
  });

  it('move sends movePassage', async () => {
    const root = mount(learning());
    menuItem(openMenu(root), 'Move to Romans Road').click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'movePassage', passageId: 7, collectionId: 2 });
  });

  it('remove asks first, then leaves via passageRemoved (back to where it was opened)', async () => {
    const root = mount(learning());
    menuItem(openMenu(root), 'Remove').click();
    expect(host.requests.some((r) => r.type === 'removePassage')).toBe(false);
    modalButton('Remove').click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'removePassage', passageId: 7 });
    expect(host.navigations).toEqual([{ type: 'passageRemoved', passageId: 7 }]);
  });
});

describe('nextReviewText', () => {
  it('says Not scheduled for a started verse with no card and Done today when due but practiced today', async () => {
    const { nextReviewText } = await import('../src/ui/verseStatusUi');
    expect(nextReviewText({ status: 'learning', nextReviewAt: null }, NOW)).toBe('Not scheduled');
    expect(nextReviewText({ status: 'new', nextReviewAt: null }, NOW)).toBe('Not started');
    expect(nextReviewText({ status: 'learning', nextReviewAt: NOW - HOUR }, NOW)).toBe('Due today');
    expect(nextReviewText({ status: 'learning', nextReviewAt: NOW - HOUR, doneToday: true }, NOW)).toBe('Done today');
  });
});

describe('menu trigger', () => {
  it('is an ellipsis glyph with the aria-label, no hamburger icon or visible word', () => {
    const root = mount(learning());
    const trigger = root.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]')!;
    expect(text(trigger)).toBe('…');
    expect(trigger.querySelector('svg')).toBeNull();
  });
});
