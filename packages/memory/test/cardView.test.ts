/**
 * @vitest-environment jsdom
 *
 * Push-card stack, banner and nav reducer (task 0072).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CardStackView, RecallCardView } from '../src/core/pushTypes';
import type { PanelReply, PanelRequest, RequestMap, Rung, VerseText } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import type { Flow, NavAction } from '../src/ui/state';
import { INITIAL_NAV, navReduce } from '../src/ui/state';
import { WordMeasurer } from '../src/ui/measure';
import { renderCardStack } from '../src/ui/cardView';
import { cardsWaitingBanner } from '../src/ui/cardsBanner';

const verse: VerseText = {
  verseId: 1,
  label: '1:1',
  words: ['In', 'the', 'beginning'],
  lines: null,
  psalmTitle: null,
  paragraphStart: true,
};

function card(id: number, over: Partial<RecallCardView> = {}): RecallCardView {
  return { key: `card:${id}:1`, passageId: id, reference: `Ref ${id}`, cue: null, verses: [verse], firedAt: null, ...over };
}

class Host implements PanelHost {
  requests: PanelRequest[] = [];
  navigations: NavAction[] = [];
  sessions: number[] = [];
  flows: Flow[] = [];
  announcements: string[] = [];
  reloads = 0;
  t = 1000;
  activeReference: string | null = null;
  measurer = new WordMeasurer(document);
  handlers: Record<string, (r: PanelRequest) => PanelReply<unknown>> = {};
  now(): number {
    return this.t;
  }
  request<R extends PanelRequest>(r: R): Promise<PanelReply<RequestMap[R['type']]>> {
    this.requests.push(r);
    const h = this.handlers[r.type];
    return Promise.resolve((h ? h(r) : { ok: false, error: `no stub ${r.type}` }) as PanelReply<RequestMap[R['type']]>);
  }
  go(a: NavAction): void {
    this.navigations.push(a);
  }
  reload(): void {
    this.reloads++;
  }
  async startSession(id: number, _r?: Rung): Promise<void> {
    this.sessions.push(id);
  }
  async startFlow(f: Flow): Promise<void> {
    this.flows.push(f);
  }
  openInBible(): void {}
  announce(m: string): void {
    this.announcements.push(m);
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const stackOf = (...cards: RecallCardView[]): CardStackView => ({ cards, waitingCount: cards.length });

let host: Host;
let container: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  container.className = 'sm-app';
  document.body.appendChild(container);
  host = new Host();
});
afterEach(() => {
  document.body.innerHTML = '';
});

const btn = (root: HTMLElement, label: string): HTMLButtonElement => {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent?.startsWith(label));
  if (!b) throw new Error(`no button ${label}`);
  return b as HTMLButtonElement;
};
/** A key typed inside the Memory app (focus in its container). */
const key = (k: string): void => {
  container.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
};

describe('the card stack', () => {
  it('shows reference, cue and counter, with grades disabled until reveal', () => {
    const root = renderCardStack(host, stackOf(card(1, { cue: 'In the beginning…' }), card(2)));
    container.appendChild(root);
    expect(root.textContent).toContain('Ref 1');
    expect(root.textContent).toContain('In the beginning…');
    expect(root.textContent).toContain('1 of 2');
    expect(root.textContent).toContain('Say it to yourself, then reveal.');
    expect(root.textContent).not.toContain('beginning In');
    for (const l of ['Missed', 'Partly', 'Knew it']) expect(btn(root, l).disabled).toBe(true);
  });

  it('reveals with the button and enables grading', () => {
    const root = renderCardStack(host, stackOf(card(1)));
    container.appendChild(root);
    btn(root, 'Show verse').click();
    expect(root.querySelector('.sm-card-verses')!.textContent).toContain('beginning');
    expect(btn(root, 'Knew it').disabled).toBe(false);
  });

  it('Space reveals and 1/2/3 grade, sending duration and advancing on the returned stack', async () => {
    host.handlers.gradeRecall = () => ({ ok: true, data: { nextDueAt: null, stack: stackOf(card(2)) } });
    const root = renderCardStack(host, stackOf(card(1), card(2)));
    container.appendChild(root);
    key('3'); // not revealed yet: ignored
    await settle();
    expect(host.requests).toHaveLength(0);

    host.t = 1000;
    key(' ');
    expect(btn(root, 'Knew it').disabled).toBe(false);
    key('3');
    await settle();
    expect(host.requests[0]).toMatchObject({ type: 'gradeRecall', passageId: 1, grade: 'knew', key: 'card:1:1' });
    expect(root.textContent).toContain('Ref 2');
    expect(root.textContent).toContain('2 of 2');
    expect(btn(root, 'Knew it').disabled).toBe(true);
  });

  it('maps keys 1 and 2 to missed and partly', async () => {
    host.handlers.gradeRecall = () => ({ ok: true, data: { nextDueAt: null, stack: stackOf(card(3)) } });
    const root = renderCardStack(host, stackOf(card(1), card(2), card(3)));
    container.appendChild(root);
    key(' ');
    key('1');
    await settle();
    key(' ');
    key('2');
    await settle();
    expect(host.requests.map((r) => (r as { grade: string }).grade)).toEqual(['missed', 'partly']);
  });

  it('ends with Practice what is due and Back after the last card', async () => {
    host.handlers.gradeRecall = () => ({ ok: true, data: { nextDueAt: null, stack: stackOf() } });
    const root = renderCardStack(host, stackOf(card(1)));
    container.appendChild(root);
    btn(root, 'Show verse').click();
    btn(root, 'Partly').click();
    await settle();
    btn(root, "Practice what's due").click();
    expect(host.flows).toEqual([{ kind: 'variety' }]);
    btn(root, 'Back').click();
    expect(host.navigations).toContainEqual({ type: 'goPlan' });
  });

  it('shows the empty state', () => {
    const root = renderCardStack(host, stackOf());
    container.appendChild(root);
    expect(root.textContent).toContain('No cards waiting.');
  });

  it('announces a grading failure and keeps the card', async () => {
    host.handlers.gradeRecall = () => ({ ok: false, error: 'boom' });
    const root = renderCardStack(host, stackOf(card(1)));
    container.appendChild(root);
    btn(root, 'Show verse').click();
    btn(root, 'Missed').click();
    await settle();
    expect(host.announcements).toEqual(['1 of 1: Ref 1', 'boom']);
    expect(root.textContent).toContain('Ref 1');
    expect(btn(root, 'Missed').disabled).toBe(false);
  });

  it('Practice this passage starts a session', () => {
    const root = renderCardStack(host, stackOf(card(7)));
    container.appendChild(root);
    btn(root, 'Practice this passage').click();
    expect(host.sessions).toEqual([7]);
  });

  it('Later snoozes and reloads the stack', async () => {
    host.handlers.snoozeCard = () => ({ ok: true, data: { snoozedUntil: 99 } });
    host.handlers.getCardStack = () => ({ ok: true, data: stackOf(card(2)) });
    const root = renderCardStack(host, stackOf(card(1), card(2)));
    container.appendChild(root);
    btn(root, 'Later').click();
    await settle();
    expect(host.requests[0]).toMatchObject({ type: 'snoozeCard', passageId: 1, key: 'card:1:1' });
    expect(root.textContent).toContain('Ref 2');
  });

  it('announces each card as "i of n: reference"', () => {
    renderCardStack(host, stackOf(card(1), card(2)));
    expect(host.announcements).toContain('1 of 2: Ref 1');
  });

  it('stops listening to keys once detached', async () => {
    const root = renderCardStack(host, stackOf(card(1)));
    container.appendChild(root);
    root.remove();
    key(' ');
    key('3');
    await settle();
    expect(host.requests).toHaveLength(0);
  });
});

describe('the cards banner', () => {
  it('is null with nothing waiting', () => {
    expect(cardsWaitingBanner(host, 0)).toBeNull();
  });
  it('announces the count and opens the stack', () => {
    const b = cardsWaitingBanner(host, 2)!;
    container.appendChild(b);
    expect(b.textContent).toContain('2 memory cards waiting');
    b.click();
    expect(host.navigations).toEqual([{ type: 'goCard' }]);
    expect(cardsWaitingBanner(host, 1)!.textContent).toContain('1 memory card waiting');
  });
});

describe('nav: goCard', () => {
  it('opens the card view and returns to the plan', () => {
    const s = navReduce(INITIAL_NAV, { type: 'goCard' });
    expect(s.view).toEqual({ name: 'card' });
    expect(s.returnTo).toEqual({ name: 'plan' });
  });
});

describe('card shortcuts stay inside the Memory app (embedded, no iframe)', () => {
  it('ignores keys typed elsewhere on the page and while the app is hidden', async () => {
    const root = renderCardStack(host, stackOf(card(1)));
    container.appendChild(root);
    const outside = document.createElement('div');
    outside.tabIndex = 0;
    document.body.appendChild(outside);
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await settle();
    expect(btn(root, 'Knew it').disabled).toBe(true);

    // Hidden (another app on screen): even keys with no focus are ignored.
    container.setAttribute('inert', '');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await settle();
    expect(btn(root, 'Knew it').disabled).toBe(true);
    container.removeAttribute('inert');

    container.setAttribute('inert', '');
    key(' ');
    await settle();
    expect(btn(root, 'Knew it').disabled).toBe(true);

    container.removeAttribute('inert');
    // Visible, focus on <body> (after a click on plain text): works.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await settle();
    expect(btn(root, 'Knew it').disabled).toBe(false);
  });
});
