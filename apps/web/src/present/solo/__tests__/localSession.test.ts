import { describe, it, expect, vi } from 'vitest';
import { createLocalSession, parseSavedState, initialLocalState, LOCAL_SESSION_STORAGE_KEY } from '../localSession';
import type { IntentContext } from '../../reducer';
import type { PresentItem } from '../../protocol';

const john: PresentItem = { kind: 'passage', module: 'KJV', book: 43, chapter: 3 };
const ctx: IntentContext = { chapterLength: () => 36, slideCount: () => null };

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(LOCAL_SESSION_STORAGE_KEY, initial);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

const make = (storage: ReturnType<typeof memoryStorage> | null) =>
  createLocalSession({ storage, context: ctx });

describe('createLocalSession', () => {
  it('starts from a real, non-null state', () => {
    const s = make(memoryStorage());
    expect(s.getState()).toEqual(initialLocalState());
    expect(s.getState().live).toBeNull();
  });

  it('runs the shared reducer and bumps the version', () => {
    const s = make(memoryStorage());
    s.sink({ type: 'show', item: john, index: 16 });
    expect(s.getState().live).toEqual(john);
    expect(s.getState().position.index).toBe(16);
    expect(s.getState().version).toBe(1);
    s.sink({ type: 'next' });
    expect(s.getState().position.index).toBe(17);
    expect(s.getState().version).toBe(2);
  });

  it('ignores no-ops and invalid intents without notifying', () => {
    const s = make(memoryStorage());
    s.sink({ type: 'show', item: john, index: 36 });
    const listener = vi.fn();
    s.subscribe(listener);
    s.sink({ type: 'next' }); // at the end of the chapter
    s.sink({ type: 'goTo', index: -5 });
    s.sink({ type: 'bogus' } as never);
    expect(listener).not.toHaveBeenCalled();
    expect(s.getState().version).toBe(1);
  });

  it('notifies subscribers, and stops after unsubscribe; sink identity is stable', () => {
    const s = make(memoryStorage());
    const sink = s.sink;
    const listener = vi.fn();
    const off = s.subscribe(listener);
    s.sink({ type: 'blank' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].display.blanked).toBe(true);
    off();
    s.sink({ type: 'unblank' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s.sink).toBe(sink);
  });

  it('persists and restores across a reload', () => {
    const storage = memoryStorage();
    const a = make(storage);
    a.sink({ type: 'show', item: john, index: 5 });
    a.sink({ type: 'setTheme', theme: 'dark' });
    a.sink({ type: 'addHighlight', highlight: { verseIdStart: 43003005, textStart: 1, textEnd: 3 } });
    const b = make(storage);
    expect(b.getState()).toEqual(a.getState());
    expect(b.getState().position.highlights).toHaveLength(1);
  });

  it('starts empty when storage is corrupt, and recovers on the next change', () => {
    for (const junk of ['{not json', '"x"', '{"v":1}', '{"v":99,"state":{}}', '{"v":1,"state":{"live":{"kind":"passage"},"position":{"index":1}}}']) {
      const storage = memoryStorage(junk);
      const s = make(storage);
      expect(s.getState()).toEqual(initialLocalState());
      s.sink({ type: 'blank' });
      expect(parseSavedState(storage.getItem(LOCAL_SESSION_STORAGE_KEY))?.display.blanked).toBe(true);
    }
  });

  it('survives storage that throws', () => {
    const angry = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('full'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    const s = createLocalSession({ storage: angry, context: ctx });
    expect(() => s.sink({ type: 'show', item: john })).not.toThrow();
    expect(s.getState().live).toEqual(john);
    expect(() => s.reset()).not.toThrow();
  });

  it('works with no storage at all', () => {
    const s = make(null);
    s.sink({ type: 'blank' });
    expect(s.getState().display.blanked).toBe(true);
  });

  it('reset clears the wall and the saved copy', () => {
    const storage = memoryStorage();
    const s = make(storage);
    s.sink({ type: 'show', item: john });
    s.reset();
    expect(s.getState().live).toBeNull();
    expect(parseSavedState(storage.getItem(LOCAL_SESSION_STORAGE_KEY))?.live).toBeNull();
  });
});

describe('parseSavedState', () => {
  it('drops bad highlights and clamps display values', () => {
    const raw = JSON.stringify({ v: 1, state: {
      version: 4, live: null, position: { index: 0, highlights: [{ nope: 1 }, { verseIdStart: 43003016, textStart: 0, textEnd: 2 }] },
      display: { fontStep: 99, blanked: true, theme: 'weird' },
    } });
    const s = parseSavedState(raw)!;
    expect(s.position.highlights).toHaveLength(1);
    expect(s.display).toEqual({ fontStep: 10, blanked: true, theme: 'light' });
    expect(s.version).toBe(4);
  });
});
