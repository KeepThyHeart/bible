import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IntentContext } from '../../lib/reducer';
import type { PresentItem } from '../../lib/protocol';
import { createLocalSession } from '../../lib/solo/localSession';

const started = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('../../stores/presentStore', () => {
  const listeners = new Set<() => void>();
  const store: any = {
    session: null,
    wall: null,
    send: vi.fn(async (i: unknown) => { started.calls.push(i); return true; }),
    start: vi.fn(async () => { store.session = { joinCode: 'ABC' }; return true; }),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return { presentStore: store };
});

import { presentStore } from '../../stores/presentStore';
import {
  goLive, presenterIsLive, presenterSend, presenterShow, presenterState, presenterToggleBlank,
  seedIntents, setPreliveSessionForTests,
} from '../presenterSink';

const ctx: IntentContext = { chapterLength: () => 36, slideCount: () => null };
const john: PresentItem = { kind: 'passage', module: 'KJV', book: 43, chapter: 3 };
const store = presentStore as any;

beforeEach(() => {
  store.session = null;
  store.wall = null;
  store.send.mockClear();
  started.calls.length = 0;
  setPreliveSessionForTests(createLocalSession({ storage: null, context: ctx }));
});

describe('presenterSink routing', () => {
  it('goes to the local session before going live', () => {
    expect(presenterIsLive()).toBe(false);
    presenterShow(john, 5);
    expect(store.send).not.toHaveBeenCalled();
    expect(presenterState()?.live).toEqual(john);
    expect(presenterState()?.position.index).toBe(5);
    presenterSend({ type: 'next' });
    expect(presenterState()?.position.index).toBe(6);
  });

  it('goes to presentStore when live, and leaves the local copy alone', () => {
    store.session = { joinCode: 'ABC' };
    presenterShow(john, 2);
    expect(store.send).toHaveBeenCalledWith({ type: 'show', item: john, index: 2 });
    store.session = null;
    expect(presenterState()?.live).toBeNull();
  });

  it('reads the live wall when live', () => {
    store.session = { joinCode: 'ABC' };
    store.wall = { marker: 'wall' };
    expect(presenterState()).toBe(store.wall);
  });

  it('toggles blank from the current state', () => {
    presenterToggleBlank();
    expect(presenterState()?.display.blanked).toBe(true);
    presenterToggleBlank();
    expect(presenterState()?.display.blanked).toBe(false);
  });
});

describe('going live', () => {
  it('replays the local state into the new session, theme first', async () => {
    presenterSend({ type: 'setTheme', theme: 'dark' });
    presenterShow(john, 4);
    presenterSend({ type: 'addHighlight', highlight: { verseIdStart: 43003004, textStart: 1, textEnd: 2 } });
    expect(await goLive()).toBe(true);
    expect(started.calls.map((c: any) => c.type)).toEqual(['setTheme', 'show', 'addHighlight']);
    expect(started.calls[1]).toEqual({ type: 'show', item: john, index: 4 });
  });

  it('seeds nothing from an untouched local session', () => {
    expect(seedIntents(presenterState()!)).toEqual([]);
  });
});
