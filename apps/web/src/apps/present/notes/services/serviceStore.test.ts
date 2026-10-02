import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIndexedDbBackend, createMemoryBackend, ServiceStore, type ServiceBackend } from './serviceStore';

let n = 0;
const make = (backend: ServiceBackend = createMemoryBackend()) =>
  new ServiceStore({ backend, debounceMs: 100, newId: () => `id${++n}`, now: () => 1_700_000_000_000 + n * 1000 });
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('ServiceStore', () => {
  beforeEach(() => {
    n = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('creates, lists newest first, opens and remembers last open', async () => {
    const backend = createMemoryBackend();
    const store = make(backend);
    await store.ready();
    const a = await store.create({ name: 'A' });
    const b = await store.create({ name: 'B' });
    expect(store.list().map((s) => s.name)).toEqual(['B', 'A']);
    store.open(a.id);
    await vi.advanceTimersByTimeAsync(0);
    const again = make(backend);
    await again.ready();
    expect(again.getLastOpenId()).toBe(a.id);
    expect((await again.openLastOrCreate()).id).toBe(a.id);
    expect(b.id).not.toBe(a.id);
  });

  it('creates a first service when none exists', async () => {
    const s = await make().openLastOrCreate();
    expect(s.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('autosaves debounced, and flush writes immediately', async () => {
    const backend = createMemoryBackend();
    const store = make(backend);
    const s = await store.create({ name: 'A' });
    store.save(s.id, doc('one'));
    store.save(s.id, doc('two'));
    expect((await backend.getAll())[0].doc).not.toEqual(doc('two'));
    await vi.advanceTimersByTimeAsync(150);
    expect((await backend.getAll())[0].doc).toEqual(doc('two'));
    store.save(s.id, doc('three'));
    await store.flush();
    expect((await backend.getAll())[0].doc).toEqual(doc('three'));
  });

  it('duplicates with a copy of the doc, renames and deletes', async () => {
    const store = make();
    const s = await store.create({ name: 'A', doc: doc('x') });
    store.save(s.id, doc('edited'));
    const copy = (await store.duplicate(s.id))!;
    expect(copy.name).toBe('A (copy)');
    expect(copy.doc).toEqual(doc('edited'));
    await store.rename(copy.id, '  Evening ');
    expect(store.get(copy.id)!.name).toBe('Evening');
    await store.rename(copy.id, '   ');
    expect(store.get(copy.id)!.name).toBe('Evening');
    await store.remove(copy.id);
    expect(store.get(copy.id)).toBeUndefined();
    expect(store.getLastOpenId()).toBeNull();
  });

  it('notifies subscribers', async () => {
    const store = make();
    const fn = vi.fn();
    store.subscribe(fn);
    await store.create({});
    expect(fn).toHaveBeenCalled();
  });

  it('degrades to memory when IndexedDB is unavailable', async () => {
    const store = new ServiceStore({ backend: createIndexedDbBackend(undefined) });
    const s = await store.create({ name: 'A' });
    store.save(s.id, doc('x'));
    await store.flush();
    expect(store.persistent).toBe(false);
    expect(store.get(s.id)!.doc).toEqual(doc('x'));
  });

  it('survives a backend that throws', async () => {
    const bad: ServiceBackend = {
      getAll: () => Promise.reject(new Error('x')),
      put: () => Promise.reject(new Error('x')),
      delete: () => Promise.reject(new Error('x')),
      getMeta: () => Promise.reject(new Error('x')),
      setMeta: () => Promise.reject(new Error('x')),
    };
    const store = make(bad);
    await store.ready();
    const s = await store.create({ name: 'A' });
    expect(store.list()).toHaveLength(1);
    expect(store.persistent).toBe(false);
    expect(s.name).toBe('A');
  });
});
