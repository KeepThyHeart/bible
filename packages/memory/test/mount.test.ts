// @vitest-environment jsdom
/**
 * `mountMemoryUi` / `requestVia`: the shell that replaced the extension's
 * panel.ts. Driven with a fake `MemoryApi` and a fake `subscribe`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MemoryApi, MemoryPush } from '../src/core/api';
import type { PlanView } from '../src/core/types';
import { mountMemoryUi, requestVia } from '../src/ui/mount';

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
    expect(c.querySelector('main.sm-main')).not.toBeNull();
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

describe('memory.css scoping', () => {
  const css = readFileSync(resolve(__dirname, '../src/ui/memory.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

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
    const bad = all.map((s) => s.trim()).filter((s) => !s.startsWith('.sm-app'));
    expect(bad).toEqual([]);
  });

  it('does not restyle html, body or :root', () => {
    expect(css).not.toMatch(/(^|[\s,}])(html|body|:root)\s*[,{]/);
  });
});
