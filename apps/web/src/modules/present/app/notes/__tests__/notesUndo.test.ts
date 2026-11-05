import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProseMirrorJSON } from '../editor/schema';

/** Undo after Remove in the Plan: the item comes back where it was. */

const doc = (text: string): ProseMirrorJSON =>
  ({ type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] }) as ProseMirrorJSON;

const flush = () => new Promise((r) => setTimeout(r, 30));

type Fake = { session: { sessionId: string; controlToken: string } | null; connection: string; plan: unknown[]; notify: () => void; subscribe: (fn: () => void) => () => void; savePlan: () => Promise<void>; rememberHymns: () => void };

let getNotes: ReturnType<typeof vi.fn>;
let putNotes: ReturnType<typeof vi.fn>;
let fake: Fake;
let notes: any;
let docKey: (d: ProseMirrorJSON | null) => string;
let svc: any;
// A previous test's store may still have timers pending: give every test its own session ids.
let run = 0;
const sidOf = (n: number) => `S${n}-r${run}`;
let listeners: EventListenerOrEventListenerObject[] = [];

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  listeners = [];
  run++;
  const g = (getNotes = vi.fn(async () => null));
  const p = (putNotes = vi.fn(async () => true));
  vi.doMock('../../../lib/notesApi', () => ({ getNotes: g, putNotes: p }));
  // Each fresh notesStore adds a visibilitychange listener; remove them after the test.
  const realAdd = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((t: string, l: any, o?: any) => {
    if (t === 'visibilitychange') listeners.push(l);
    realAdd(t, l, o);
  });
  vi.doMock('../../../lib/command/searchProviders', () => ({ searchHymns: async () => [] }));
  vi.doMock('../../presenterSink', () => ({ presenterShow: vi.fn(), presenterState: () => null, subscribePresenter: () => () => {} }));
  vi.doMock('../services/serviceStore', async () => {
    const actual = await vi.importActual<typeof import('../services/serviceStore')>('../services/serviceStore');
    const store = new actual.ServiceStore({ backend: actual.createMemoryBackend(), debounceMs: 1 });
    return { ...actual, getServiceStore: () => store };
  });
  vi.doMock('../../../stores/presentStore', async () => {
    const { Store } = await vi.importActual<typeof import('../../../../../stores/Store')>('../../../../../stores/Store');
    class FakePresent extends Store {
      session: Fake['session'] = null;
      connection = 'offline';
      plan: unknown[] = [];
      savePlan = async () => {};
      rememberHymns = () => {};
      notify() { super.notify(); }
    }
    return { presentStore: new FakePresent() };
  });
  fake = (await import('../../../stores/presentStore')).presentStore as unknown as Fake;
  notes = (await import('../notesStore')).notesStore;
  docKey = (await import('../planOps')).docKey;
  svc = (await import('../services/serviceStore')).getServiceStore();
  await notes.init();
}, 60000); // the first run transforms the whole notes graph

afterEach(() => {
  for (const l of listeners) document.removeEventListener('visibilitychange', l);
  vi.restoreAllMocks();
  vi.doUnmock('../../../lib/notesApi');
  vi.doUnmock('../services/serviceStore');
  vi.doUnmock('../../../stores/presentStore');
  vi.doUnmock('../../presenterSink');
  vi.doUnmock('../../../lib/command/searchProviders');
});


const passage = (chapter: number) => ({ kind: 'passage', module: 'KJV', book: 43, chapter, verseStart: 16 }) as const;

describe('notesStore.undoRemove', { timeout: 30000 }, () => {
  it('restores the removed item at its original plan position', async () => {
    notes.addItem(passage(1), 'John 1:16');
    notes.addItem(passage(2), 'John 2:16');
    notes.addItem(passage(3), 'John 3:16');
    await flush();
    notes.runDetection();
    const labels = () => notes.planItems.map((p: any) => p.label);
    expect(labels()).toEqual(['John 1:16', 'John 2:16', 'John 3:16']);
    notes.removeItem(notes.planItems[1].id);
    notes.runDetection();
    expect(labels()).toEqual(['John 1:16', 'John 3:16']);
    notes.undoRemove();
    notes.runDetection();
    expect(labels()).toEqual(['John 1:16', 'John 2:16', 'John 3:16']);
  });
});
