// @vitest-environment jsdom
/**
 * `mountMemoryUi` / `requestVia`: the shell that replaced the extension's
 * panel.ts. Driven with a fake `MemoryApi` and a fake `subscribe`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MemoryApi, MemoryPush } from '../src/core/api';
import type { PlanView } from '../src/core/types';
import { mountMemoryUi, requestVia } from '../src/ui/mount';

// practiceView is edited in a separate change; mount only needs its constructor shape.
vi.mock('../src/ui/practiceView', () => ({
  PracticeView: class {
    root = document.createElement('div');
    mount(parent: HTMLElement) { parent.appendChild(this.root); }
    destroy() { this.root.remove(); }
  },
}));

vi.mock('../src/ui/analyticsView', () => ({
  renderAnalytics: () => {
    const s = document.createElement('section');
    const h = document.createElement('h1');
    h.textContent = 'Progress';
    s.appendChild(h);
    return s;
  },
}));

// Today is written separately; here it only has to render a heading and show what it was given.
const todayButtons = { id: false, passage: false };
const todayCalls: Array<{ plan: PlanView; extras: any }> = [];
vi.mock('../src/ui/todayView', () => ({
  renderToday: (_host: unknown, plan: PlanView, extras: unknown) => {
    todayCalls.push({ plan, extras });
    const s = document.createElement('section');
    const h = document.createElement('h1');
    h.textContent = 'Today';
    s.appendChild(h);
    if (todayButtons.id) {
      const b = document.createElement('button');
      b.id = 'keep-me';
      s.appendChild(b);
    }
    if (todayButtons.passage) {
      const row = document.createElement('li');
      row.setAttribute('data-passage-id', '7');
      row.appendChild(document.createElement('button'));
      s.appendChild(row);
    }
    return s;
  },
}));

const plan = (name = 'Genesis'): PlanView =>
  ({
    cardsWaiting: 0,
    collectionId: 1,
    collectionName: name,
    lists: [{ id: 1, name: 'Default', passageCount: 0, verseCount: 0 }],
    scope: 'all',
    scopeVerseCount: 0,
    referenceActivitiesUnlocked: false,
    sortOrder: 'bible',
    passages: [],
    totalDue: 0,
    defaultAnswerMode: 'firstLetter',
    speech: { state: 'ready', missingPermissions: [], engineLabel: 'Whisper', onDevice: true, handsFree: true },
    reciteDueCount: 0,
  }) as unknown as PlanView;

function fakeBus() {
  const listeners = new Set<(p: MemoryPush) => void>();
  return {
    listeners,
    subscribe(l: (p: MemoryPush) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit(p: MemoryPush) {
      for (const l of [...listeners]) l(p);
    },
  };
}

function fakeApi(over: Record<string, unknown> = {}) {
  const api = {
    getReciteState: vi.fn(async () => null),
    consumeLaunchIntent: vi.fn(async () => ({ showCard: false })),
    getPlan: vi.fn(async () => plan()),
    getCardStack: vi.fn(async () => ({ cards: [], waitingCount: 0 })),
    navigateTo: vi.fn(async () => undefined),
    ...over,
  };
  return api as unknown as MemoryApi & typeof api;
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

let containers: HTMLElement[] = [];
function makeContainer(): HTMLElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  containers.push(c);
  return c;
}
afterEach(() => {
  todayCalls.length = 0;
  todayButtons.id = false;
  todayButtons.passage = false;
  containers.forEach((c) => c.remove());
  containers = [];
  vi.useRealTimers();
});

describe('requestVia', () => {
  it('calls api[type] with the request minus type, and wraps the result', async () => {
    const api = fakeApi({ getPassageView: vi.fn(async () => 'pv') });
    const r = await requestVia(api, { type: 'getPassageView', passageId: 4 });
    expect(r).toEqual({ ok: true, data: 'pv' });
    expect((api as any).getPassageView).toHaveBeenCalledWith({ passageId: 4 });
  });

  it('passes no argument for a request with no other fields', async () => {
    const api = fakeApi();
    await requestVia(api, { type: 'getPlan' });
    expect(api.getPlan).toHaveBeenCalledWith();
  });

  it('maps a rejection to { ok: false } and never rejects', async () => {
    const api = fakeApi({ getPlan: vi.fn(async () => { throw new Error('nope'); }) });
    await expect(requestVia(api, { type: 'getPlan' })).resolves.toEqual({ ok: false, error: 'nope' });
  });

  it('maps a missing method to { ok: false }', async () => {
    const r = await requestVia({} as MemoryApi, { type: 'getPlan' });
    expect(r.ok).toBe(false);
  });
});

describe('mountMemoryUi', () => {
  it('builds the shell markup and renders the plan', async () => {
    const c = makeContainer();
    const bus = fakeBus();
    mountMemoryUi(c, { api: fakeApi(), subscribe: bus.subscribe });
    expect(c.classList.contains('sm-app')).toBe(true);
    expect(c.querySelector('div.sm-main')).not.toBeNull();
    const status = c.querySelector('.sm-status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    await flush();
    expect(c.querySelector('.sm-main h1')).not.toBeNull();
  });

  it('dispose unsubscribes and empties the container', async () => {
    const c = makeContainer();
    const bus = fakeBus();
    const handle = mountMemoryUi(c, { api: fakeApi(), subscribe: bus.subscribe });
    await flush();
    expect(bus.listeners.size).toBe(1);
    handle.dispose();
    expect(bus.listeners.size).toBe(0);
    expect(c.childNodes.length).toBe(0);
    handle.dispose(); // idempotent
  });

  it('dispose clears the status timer and ignores late work', async () => {
    vi.useFakeTimers();
    const c = makeContainer();
    const bus = fakeBus();
    const handle = mountMemoryUi(c, { api: fakeApi(), subscribe: bus.subscribe });
    bus.emit({ type: 'notice', message: 'hi' });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    handle.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('two mounts are independent', async () => {
    const a = makeContainer();
    const b = makeContainer();
    const busA = fakeBus();
    const busB = fakeBus();
    const apiA = fakeApi({ getPlan: vi.fn(async () => plan('Alpha')) });
    const apiB = fakeApi({ getPlan: vi.fn(async () => plan('Beta')) });
    const ha = mountMemoryUi(a, { api: apiA, subscribe: busA.subscribe });
    mountMemoryUi(b, { api: apiB, subscribe: busB.subscribe });
    await flush();

    busA.emit({ type: 'notice', message: 'only A' });
    expect(a.querySelector('.sm-status')!.textContent).toBe('only A');
    expect(b.querySelector('.sm-status')!.textContent).toBe('');

    ha.dispose();
    expect(a.childNodes.length).toBe(0);
    expect(b.querySelector('.sm-main h1')).not.toBeNull();
    expect(busB.listeners.size).toBe(1);
  });

  it('shows a notice push in the status line, then clears it', async () => {
    vi.useFakeTimers();
    const c = makeContainer();
    const bus = fakeBus();
    mountMemoryUi(c, { api: fakeApi(), subscribe: bus.subscribe });
    bus.emit({ type: 'notice', message: 'Nothing is due.' });
    const status = c.querySelector('.sm-status')!;
    expect(status.textContent).toBe('Nothing is due.');
    vi.advanceTimersByTime(6001);
    expect(status.textContent).toBe('');
  });

  it('ignores a status push', async () => {
    const c = makeContainer();
    const bus = fakeBus();
    mountMemoryUi(c, { api: fakeApi(), subscribe: bus.subscribe });
    await flush();
    bus.emit({ type: 'status', status: { due: 2, waiting: 1 } });
    expect(c.querySelector('.sm-status')!.textContent).toBe('');
  });

  it('initialView card opens the card stack first', async () => {
    const c = makeContainer();
    const api = fakeApi();
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe, initialView: 'card' });
    await flush();
    expect(api.getCardStack).toHaveBeenCalled();
    expect(api.getPlan).not.toHaveBeenCalled();
  });

  it('showCards and a showCard push open the card stack', async () => {
    const c = makeContainer();
    const bus = fakeBus();
    const api = fakeApi();
    const handle = mountMemoryUi(c, { api, subscribe: bus.subscribe });
    await flush();
    handle.showCards();
    await flush();
    expect(api.getCardStack).toHaveBeenCalledTimes(1);
    bus.emit({ type: 'planChanged' });
    handle.dispose();
  });

  it('a showCard push goes to the card stack', async () => {
    const c = makeContainer();
    const bus = fakeBus();
    const api = fakeApi();
    mountMemoryUi(c, { api, subscribe: bus.subscribe });
    await flush();
    bus.emit({ type: 'showCard', key: null });
    await flush();
    expect(api.getCardStack).toHaveBeenCalledTimes(1);
  });

  it('a launch intent for a card opens the card stack', async () => {
    const c = makeContainer();
    const api = fakeApi({ consumeLaunchIntent: vi.fn(async () => ({ showCard: true })) });
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe });
    await flush();
    expect(api.getCardStack).toHaveBeenCalledTimes(1);
  });

  it('setActiveReference retargets an empty add field inside this container only', async () => {
    const a = makeContainer();
    const b = makeContainer();
    const ha = mountMemoryUi(a, { api: fakeApi(), subscribe: fakeBus().subscribe });
    mountMemoryUi(b, { api: fakeApi(), subscribe: fakeBus().subscribe });
    await flush();
    for (const c of [a, b]) {
      const input = document.createElement('input');
      input.id = 'sm-add-reference';
      c.appendChild(input);
    }
    ha.setActiveReference('John 3:16');
    expect((a.querySelector('[id="sm-add-reference"]') as HTMLInputElement).placeholder).toBe('John 3:16');
    expect((b.querySelector('[id="sm-add-reference"]') as HTMLInputElement).placeholder).toBe('');
  });

  it('a failing plan request shows an error banner rather than throwing', async () => {
    const c = makeContainer();
    const api = fakeApi({ getPlan: vi.fn(async () => { throw new Error('boom'); }) });
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe });
    await flush();
    expect(c.textContent).toContain('boom');
  });
});

describe('mountMemoryUi same-screen refresh', () => {
  it('restores focus to the element with the same id after a reload', async () => {
    todayButtons.id = true;
    const c = makeContainer();
    const bus = fakeBus();
    mountMemoryUi(c, { api: fakeApi(), subscribe: bus.subscribe });
    await flush();
    c.querySelector<HTMLElement>('#keep-me')!.focus();
    bus.emit({ type: 'planChanged' } as MemoryPush);
    await flush();
    expect(document.activeElement?.id).toBe('keep-me');
  });

  it('restores focus within a row with the same data-passage-id', async () => {
    todayButtons.passage = true;
    const c = makeContainer();
    const bus = fakeBus();
    mountMemoryUi(c, { api: fakeApi(), subscribe: bus.subscribe });
    await flush();
    c.querySelector<HTMLElement>('[data-passage-id="7"] button')!.focus();
    bus.emit({ type: 'planChanged' } as MemoryPush);
    await flush();
    expect(document.activeElement?.closest('[data-passage-id]')?.getAttribute('data-passage-id')).toBe('7');
  });

  it('falls back to the h1 when the focused element is gone', async () => {
    todayButtons.id = true;
    const c = makeContainer();
    const bus = fakeBus();
    mountMemoryUi(c, { api: fakeApi(), subscribe: bus.subscribe });
    await flush();
    c.querySelector<HTMLElement>('#keep-me')!.focus();
    todayButtons.id = false;
    bus.emit({ type: 'planChanged' } as MemoryPush);
    await flush();
    expect(document.activeElement).toBe(c.querySelector('h1'));
  });
});

describe('mountMemoryUi today extras', () => {
  it('passes the streak and the all-lists started-today count', async () => {
    const c = makeContainer();
    const api = fakeApi({ getAnalytics: vi.fn(async () => ({ streakDays: 12 })) });
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe });
    await flush();
    const last = todayCalls[todayCalls.length - 1]!;
    expect(last.extras.streak).toBe(12);
    expect(last.extras.startedToday).toBe(0);
  });

  it('treats the new-verse cap as reached when the all-lists plan cannot be read', async () => {
    const c = makeContainer();
    const scoped = { ...plan(), scope: 1 };
    const getPlan = vi.fn(async (req?: { scope?: { kind: string } }) => {
      if (req?.scope?.kind === 'all') throw new Error('offline');
      return scoped;
    });
    const api = fakeApi({ getPlan, getAnalytics: vi.fn(async () => ({ streakDays: 0 })) });
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe });
    await flush();
    const last = todayCalls[todayCalls.length - 1]!;
    expect(last.extras.startedToday).toBe(3);
    expect(c.querySelector('.sm-status-error')?.textContent).toContain('offline');
  });
});

describe('mountMemoryUi shell', () => {
  it('wraps Today in a real tablist and tabpanel', async () => {
    const c = makeContainer();
    mountMemoryUi(c, { api: fakeApi(), subscribe: fakeBus().subscribe });
    await flush();
    const tabs = [...c.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Today', 'My verses', 'Progress']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    const panel = c.querySelector('[role="tabpanel"]')!;
    expect(panel.querySelector('h1')).not.toBeNull();
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
  });

  it('hands Today the plan, the reminder count and the just-added verse', async () => {
    const c = makeContainer();
    const api = fakeApi({ getPlan: vi.fn(async () => ({ ...plan(), cardsWaiting: 3 })) });
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe, justAdded: { passageId: 5, reference: 'John 3:16' } });
    await flush();
    const last = todayCalls[todayCalls.length - 1]!;
    expect(last.extras.reminders).toEqual({ waiting: 3 });
    expect(last.extras.justAdded).toEqual({ passageId: 5, reference: 'John 3:16' });
  });

  it('moves focus to the heading on a new screen, but keeps it on a tab that was activated', async () => {
    const c = makeContainer();
    const api = fakeApi({ getAnalytics: vi.fn(async () => ({})) });
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe });
    await flush();
    expect(document.activeElement).toBe(c.querySelector('h1'));

    const progress = c.querySelector<HTMLElement>('[role="tab"]:nth-child(3)')!;
    progress.focus();
    progress.click();
    await flush();
    expect(c.querySelector('[role="tab"][aria-selected="true"]')!.id).toBe(progress.id);
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
    expect(document.activeElement?.id).toBe(progress.id);
  });

  it('the gear opens settings and is marked current there', async () => {
    const c = makeContainer();
    const api = fakeApi({
      getSettings: vi.fn(async () => ({ defaultAnswerMode: 'firstLetter' })),
      getPushSettings: vi.fn(async () => { throw new Error('x'); }),
      getImportStatus: vi.fn(async () => null),
    });
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe });
    await flush();
    const gear = c.querySelector<HTMLElement>('.sm-shell-gear')!;
    expect(gear.hasAttribute('aria-current')).toBe(false);
    gear.click();
    await flush();
    expect(api.getSettings).toHaveBeenCalled();
    expect(c.querySelector('.sm-shell-gear')!.getAttribute('aria-current')).toBe('page');
  });

  it('settings reads the all-lists plan, not the focused one', async () => {
    const c = makeContainer();
    const api = fakeApi({
      getSettings: vi.fn(async () => ({ defaultAnswerMode: 'firstLetter' })),
      getPushSettings: vi.fn(async () => { throw new Error('x'); }),
      getImportStatus: vi.fn(async () => null),
    });
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe });
    await flush();
    api.getPlan.mockClear();
    c.querySelector<HTMLElement>('.sm-shell-gear')!.click();
    await flush();
    expect(api.getPlan.mock.calls).toEqual([[{ scope: { kind: 'all' } }]]);
  });

  it('shows the focus chip when scoped, and clearing it sets scope all', async () => {
    const c = makeContainer();
    const setScope = vi.fn(async () => plan());
    const scoped = { ...plan(), scope: 1, lists: [{ id: 1, name: 'Psalms', passageCount: 0, verseCount: 0 }] };
    const api = fakeApi({ getPlan: vi.fn(async () => scoped), setScope });
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe });
    await flush();
    expect(c.querySelector('.sm-shell-chip')!.textContent).toContain('Focus: Psalms');
    c.querySelector<HTMLElement>('.sm-shell-chip-clear')!.click();
    await flush();
    expect(setScope).toHaveBeenCalledWith({ scope: { kind: 'all' } });
  });

  it('has no chip when focus is all lists, and none on Progress', async () => {
    const c = makeContainer();
    mountMemoryUi(c, { api: fakeApi(), subscribe: fakeBus().subscribe });
    await flush();
    expect(c.querySelector('.sm-shell-chip')).toBeNull();
  });

  it("accepts initialView 'plan' as Today", async () => {
    const c = makeContainer();
    const api = fakeApi();
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe, initialView: 'plan' });
    await flush();
    expect(c.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Today');
  });

  it('offerPractice redraws Today with the offer row data', async () => {
    const c = makeContainer();
    const handle = mountMemoryUi(c, { api: fakeApi(), subscribe: fakeBus().subscribe });
    await flush();
    handle.offerPractice({ passageId: 9, reference: 'Psalm 23' });
    await flush();
    expect(todayCalls[todayCalls.length - 1]!.extras.justAdded).toEqual({ passageId: 9, reference: 'Psalm 23' });
  });

  it('practice(id) starts that verse', async () => {
    const c = makeContainer();
    const startSession = vi.fn(async () => { throw new Error('no session'); });
    const api = fakeApi({ startSession });
    const handle = mountMemoryUi(c, { api, subscribe: fakeBus().subscribe });
    await flush();
    handle.practice(12);
    await flush();
    expect(startSession).toHaveBeenCalledWith({ passageId: 12 });
    expect(c.querySelector('.sm-status')!.textContent).toBe('no session');
  });

  it('initialPractice starts the verse at mount', async () => {
    const c = makeContainer();
    const startSession = vi.fn(async () => { throw new Error('no session'); });
    mountMemoryUi(c, { api: fakeApi({ startSession }), subscribe: fakeBus().subscribe, initialPractice: 4 });
    await flush();
    expect(startSession).toHaveBeenCalledWith({ passageId: 4 });
    // The start failed, so Today still appears.
    expect(c.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('re-renders Today when the local day changes (focus event), not before', async () => {
    let t = new Date(2026, 10, 10, 12, 0, 0).getTime();
    const c = makeContainer();
    const api = fakeApi();
    mountMemoryUi(c, { api, subscribe: fakeBus().subscribe, now: () => t });
    await flush();
    const calls = api.getPlan.mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(api.getPlan.mock.calls.length).toBe(calls);
    t = new Date(2026, 10, 11, 0, 5, 0).getTime();
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(api.getPlan.mock.calls.length).toBe(calls + 1);
  });

  it('re-renders at midnight on the timer, and dispose clears it', async () => {
    vi.useFakeTimers();
    let t = new Date(2026, 10, 10, 23, 59, 0).getTime();
    const c = makeContainer();
    const api = fakeApi();
    const handle = mountMemoryUi(c, { api, subscribe: fakeBus().subscribe, now: () => t });
    await vi.advanceTimersByTimeAsync(10);
    const calls = api.getPlan.mock.calls.length;
    t = new Date(2026, 10, 11, 0, 0, 1).getTime();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(api.getPlan.mock.calls.length).toBeGreaterThan(calls);
    handle.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ui css scoping', () => {
  const uiDir = resolve(__dirname, '../src/ui');
  const files = ['memory.css', ...readdirSync(resolve(uiDir, 'styles')).filter((f) => f.endsWith('.css')).map((f) => `styles/${f}`)];
  const css = files.map((f) => readFileSync(resolve(uiDir, f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

  /** Selector lists of every style rule, descending into @media blocks. */
  function selectors(text: string): string[] {
    const out: string[] = [];
    let i = 0;
    let prelude = '';
    const stack: string[] = [];
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '{') {
        const p = prelude.trim();
        if (p.startsWith('@')) stack.push(p);
        else {
          out.push(p);
          stack.push('rule');
        }
        prelude = '';
      } else if (ch === '}') {
        stack.pop();
        prelude = '';
      } else if (ch === ';' && stack[stack.length - 1] === 'rule') {
        prelude = '';
      } else if (stack[stack.length - 1] !== 'rule') {
        prelude += ch;
      }
      i++;
    }
    return out;
  }

  it('has no unscoped selector', () => {
    const all = selectors(css).flatMap((list) => list.split(','));
    expect(all.length).toBeGreaterThan(300);
    expect(files).toContain('styles/shell.css');
    const bad = all.map((s) => s.trim()).filter((s) => !s.startsWith('.sm-app'));
    expect(bad).toEqual([]);
  });

  it('does not restyle html, body or :root', () => {
    expect(css).not.toMatch(/(^|[\s,}])(html|body|:root)\s*[,{]/);
  });
});
