// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { ServiceStore, createMemoryBackend } from './serviceStore';
import { emptyDocJSON } from '../editor/schema';

/** Soak WP-01: two controller tabs must not silently overwrite each other. */
const tick = () => new Promise((r) => setTimeout(r, 50));

describe('ServiceStore across tabs', () => {
  const stores: ServiceStore[] = [];
  afterEach(() => stores.splice(0).forEach((s) => s.close()));

  function twoTabs() {
    const backend = createMemoryBackend();
    const name = `bible-present-test-${Math.random()}`;
    const a = new ServiceStore({ backend, debounceMs: 5, channelName: name });
    const b = new ServiceStore({ backend, debounceMs: 5, channelName: name });
    stores.push(a, b);
    return { a, b };
  }

  const docWith = (text: string) => ({ ...emptyDocJSON(), content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

  it('a save in one tab reaches the other, so a later save there keeps both edits', async () => {
    const { a, b } = twoTabs();
    const svc = await a.create({ name: 'Sunday' });
    await b.ready();
    const seen: string[] = [];
    b.onRemoteChange((id) => seen.push(id));

    a.save(svc.id, docWith('Acts 2:1'));
    await tick();
    expect(seen).toEqual([svc.id]);
    expect(JSON.stringify(b.get(svc.id)!.doc)).toContain('Acts 2:1');

    // Tab B now edits on top of what it received: the stored doc has both.
    const merged = docWith('Acts 2:1 Jude 3');
    b.save(svc.id, merged);
    await tick();
    const stored = await createFresh(a);
    expect(stored).toContain('Jude 3');
    expect(stored).toContain('Acts 2:1');
  });

  it('a delete in one tab removes the service in the other', async () => {
    const { a, b } = twoTabs();
    const svc = await a.create({ name: 'Gone' });
    await b.ready();
    expect(b.get(svc.id)).toBeDefined();
    const seen: string[] = [];
    b.onRemoteChange((id) => seen.push(id));
    await a.remove(svc.id);
    await tick();
    expect(b.get(svc.id)).toBeUndefined();
    expect(seen).toEqual([svc.id]);
  });

  it('does not clobber a local edit that is still waiting to be saved', async () => {
    const { a, b } = twoTabs();
    const svc = await a.create({ name: 'Busy' });
    await b.ready();
    const bSlow = b as unknown as { debounceMs: number };
    bSlow.debounceMs = 10_000;
    b.save(svc.id, docWith('local pending'));
    a.save(svc.id, docWith('remote'));
    await tick();
    expect(JSON.stringify(b.get(svc.id)!.doc)).toContain('local pending');
  });
});

async function createFresh(s: ServiceStore): Promise<string> {
  return JSON.stringify(s.get(s.list()[0].id)!.doc);
}
