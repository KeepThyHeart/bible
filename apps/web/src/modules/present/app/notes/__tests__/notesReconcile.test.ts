import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProseMirrorJSON } from '../editor/schema';

/**
 * `notesStore.reconcile`: what a device does with the session's notes when it
 * takes over a session, reconnects, or wakes up. Each test gets a fresh
 * notesStore (module reset) wired to a fake presentStore, a mocked notes API
 * and an in-memory service backend.
 */

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

const join = async (sid = sidOf(1), connection = 'live') => {
  fake.connection = connection;
  fake.session = { sessionId: sid, controlToken: `tok-${sid}` };
  fake.notify();
  await flush();
};
const localText = (): string => JSON.stringify(notes.doc);
const pushedKey = (sid: string) => `pz.notes.pushed.${sid}`;

describe('notesStore.reconcile', { timeout: 30000 }, () => {
  it('blank local: the server copy goes into the open service', async () => {
    const openId = notes.currentServiceId;
    getNotes.mockResolvedValue(doc('From server'));
    await join();
    expect(getNotes).toHaveBeenCalledWith(sidOf(1), `tok-${sidOf(1)}`);
    expect(localText()).toContain('From server');
    expect(notes.currentServiceId).toBe(openId);
    expect(svc.list()).toHaveLength(1);
    expect(localStorage.getItem(pushedKey(sidOf(1)))).not.toBeNull();
  });

  it('never pushed, non-blank local: server copy opens as a "(session copy)" service, original intact', async () => {
    notes.loadDoc(doc('My own notes'));
    const originalId = notes.currentServiceId;
    getNotes.mockResolvedValue(doc('From server'));
    await join();
    expect(svc.list()).toHaveLength(2);
    const copy = svc.list().find((s: any) => s.id !== originalId);
    expect(copy.name).toMatch(/\(session copy\)$/);
    expect(JSON.stringify(copy.doc)).toContain('From server');
    expect(notes.currentServiceId).toBe(copy.id);
    expect(localText()).toContain('From server');
    expect(JSON.stringify(svc.get(originalId).doc)).toContain('My own notes');
    expect(localStorage.getItem(pushedKey(sidOf(1)))).not.toBeNull(); // adopted, then pushing resumes
  });

  it('pushed before, server changed, no unpushed edits: loaded into the open service', async () => {
    notes.loadDoc(doc('Old'));
    const openId = notes.currentServiceId;
    localStorage.setItem(pushedKey(sidOf(1)), docKey(notes.doc));
    getNotes.mockResolvedValue(doc('Newer from other device'));
    await join();
    expect(notes.currentServiceId).toBe(openId);
    expect(svc.list()).toHaveLength(1);
    expect(localText()).toContain('Newer from other device');
    expect(putNotes).not.toHaveBeenCalledWith(sidOf(1), `tok-${sidOf(1)}`, doc('Old'));
  });

  it('unpushed local edits + server changed: new service from server, local stays open, nothing pushed', async () => {
    notes.loadDoc(doc('Old'));
    const openId = notes.currentServiceId;
    localStorage.setItem(pushedKey(sidOf(1)), docKey(notes.doc));
    notes.onDocChange(doc('Old plus my edit'));
    getNotes.mockResolvedValue(doc('Other device text'));
    await join();
    expect(svc.list()).toHaveLength(2);
    expect(svc.list().some((s: any) => /\(session copy\)$/.test(s.name) && JSON.stringify(s.doc).includes('Other device text'))).toBe(true);
    expect(notes.currentServiceId).toBe(openId);
    expect(localText()).toContain('my edit');
    expect(notes.syncBlocked ?? (notes as any).syncBlocked).toBe(true);
    await new Promise((r) => setTimeout(r, 1700)); // past the notes-sync delay
    expect(putNotes).not.toHaveBeenCalled();
  });

  it('server unchanged since our last push: nothing happens', async () => {
    notes.loadDoc(doc('Same'));
    const server = notes.doc as ProseMirrorJSON;
    localStorage.setItem(pushedKey(sidOf(1)), docKey(server));
    getNotes.mockResolvedValue(server);
    await join();
    expect(svc.list()).toHaveLength(1);
    expect(localText()).toContain('Same');
    expect(notes.syncBlocked).toBe(false);
    // (a re-push of identical notes is harmless; a different document must never go out)
    for (const call of putNotes.mock.calls) expect(JSON.stringify(call[2])).toBe(JSON.stringify(server));
  });

  it('re-runs when the stream comes back to live', async () => {
    await join(sidOf(1), 'live');
    expect(getNotes).toHaveBeenCalledTimes(1);
    fake.connection = 'reconnecting';
    fake.notify();
    await flush();
    expect(getNotes).toHaveBeenCalledTimes(1);
    fake.connection = 'live';
    fake.notify();
    await flush();
    expect(getNotes).toHaveBeenCalledTimes(2);
  });

  it('re-runs on visibilitychange when the tab is visible', async () => {
    await join();
    expect(getNotes).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(getNotes).toHaveBeenCalledTimes(2);
  });

  it('skips reconnect and visible re-checks while syncBlocked', async () => {
    notes.loadDoc(doc('Old'));
    localStorage.setItem(pushedKey(sidOf(1)), docKey(notes.doc));
    notes.onDocChange(doc('Edited'));
    getNotes.mockResolvedValue(doc('Elsewhere'));
    await join();
    expect(getNotes).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    fake.connection = 'reconnecting';
    fake.notify();
    fake.connection = 'live';
    fake.notify();
    await flush();
    expect(getNotes).toHaveBeenCalledTimes(1);
  });

  it('suppresses a duplicate check for the same sid while one is running, but a new sid proceeds', async () => {
    let release!: (d: ProseMirrorJSON | null) => void;
    getNotes.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await join(sidOf(1));
    expect(getNotes).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange')); // same sid, still in flight
    await flush();
    expect(getNotes).toHaveBeenCalledTimes(1);
    release(null);
    await flush();
    // a different session starts its own check
    getNotes.mockResolvedValue(null);
    await join(sidOf(2));
    expect(getNotes).toHaveBeenCalledTimes(2);
    expect(getNotes).toHaveBeenLastCalledWith(sidOf(2), `tok-${sidOf(2)}`);
  });

  it('drops a stale answer when the session changed meanwhile', async () => {
    let release!: (d: ProseMirrorJSON | null) => void;
    getNotes.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await join(sidOf(1));
    getNotes.mockResolvedValue(null);
    await join(sidOf(2));
    release(doc('Late S1 copy'));
    await flush();
    expect(localText()).not.toContain('Late S1 copy');
  });
});
