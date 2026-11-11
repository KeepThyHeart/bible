import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { undo } from 'prosemirror-history';
import type { ProseMirrorJSON } from '../editor/schema';

/** Suggestions: Accept pins the span, Skip unlinks it; each is one undo step. Also "Make a … item" on a range. */

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



const QUOTE = '“Faith is taking the first step even when you don’t see the whole staircase.” – Martin Luther King Jr.';

async function mount(text: string): Promise<EditorView> {
  const { buildPlugins } = await import('../editor/plugins');
  const { docFromJSON } = await import('../editor/schema');
  notes.loadDoc(doc(text));
  const view: EditorView = new EditorView(document.createElement('div'), {
    state: EditorState.create({ doc: docFromJSON(notes.doc), plugins: buildPlugins(() => ({}), notes.plugins) }),
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      if (tr.docChanged) notes.onDocChange(view.state.doc.toJSON());
    },
  });
  notes.attachView(view);
  notes.runDetection();
  return view;
}

const markNames = (view: EditorView) => {
  const names = new Set<string>();
  view.state.doc.descendants((n) => { n.marks.forEach((m) => names.add(m.type.name)); });
  return [...names].sort();
};

describe('notesStore suggestions', { timeout: 30000 }, () => {
  it('reports a quoted line as a suggestion', async () => {
    const view = await mount(QUOTE);
    expect(notes.suggestions).toHaveLength(1);
    expect(notes.suggestions[0].kind).toBe('quote');
    expect(notes.suggestionText(notes.suggestions[0].id)).toBe(QUOTE);
    expect(notes.itemCount).toBe(0);
    notes.attachView(null);
    view.destroy();
  });

  it('accept pins the span, the suggestion goes, and one undo brings it back', async () => {
    const view = await mount(QUOTE);
    const id = notes.suggestions[0].id;
    notes.acceptSuggestion(id);
    expect(notes.suggestions).toEqual([]);
    expect(markNames(view)).toEqual(['pin']);
    expect(notes.itemCount).toBe(1);
    expect(notes.detection.items[0].item).toMatchObject({ kind: 'quote', attribution: 'Martin Luther King Jr.' });
    undo(view.state, view.dispatch);
    notes.runDetection();
    expect(markNames(view)).toEqual([]);
    expect(notes.suggestions.map((s: any) => s.id)).toEqual([id]);
    notes.attachView(null);
    view.destroy();
  });

  it('skip unlinks the span, and one undo brings it back', async () => {
    const view = await mount(QUOTE);
    notes.skipSuggestion(notes.suggestions[0].id);
    expect(notes.suggestions).toEqual([]);
    expect(markNames(view)).toEqual(['unlink']);
    expect(notes.itemCount).toBe(0);
    undo(view.state, view.dispatch);
    notes.runDetection();
    expect(markNames(view)).toEqual([]);
    expect(notes.suggestions).toHaveLength(1);
    notes.attachView(null);
    view.destroy();
  });

  it('dismiss hides the set until it changes', async () => {
    const view = await mount(QUOTE);
    expect(notes.suggestionsDismissed).toBe(false);
    notes.dismissSuggestions();
    expect(notes.suggestionsDismissed).toBe(true);
    notes.skipSuggestion(notes.suggestions[0].id);
    expect(notes.suggestionsDismissed).toBe(false); // empty set now: a different set
    notes.attachView(null);
    view.destroy();
  });

  it('pinRange makes a selected range an item', async () => {
    const view = await mount('Our theme is grace and peace today');
    const from = 1 + 'Our theme is '.length;
    const to = from + 'grace and peace'.length;
    notes.pinRange(from, to, { kind: 'quote', text: 'grace and peace' });
    expect(notes.itemCount).toBe(1);
    expect(notes.detection.items[0]).toMatchObject({ kind: 'quote', label: 'grace and peace', source: 'pinned' });
    undo(view.state, view.dispatch);
    notes.runDetection();
    expect(notes.itemCount).toBe(0);
    notes.pinRange(0, view.state.doc.content.size, { kind: 'quote', text: 'x' }); // across block boundaries: ignored
    expect(markNames(view)).toEqual([]);
    notes.attachView(null);
    view.destroy();
  });
});
