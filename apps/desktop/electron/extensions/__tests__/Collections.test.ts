/**
 * `collectionsApiImpl` unit tests - ordered passage collections.
 *
 * The interesting surface here is not CRUD, it is *order*. `pinned_item`
 * carries a `sort_order` column that the schema is perfectly happy to leave
 * sparse and full of ties; the API promises callers something stricter - dense
 * zero-based positions where the index you read back is the index you can pass
 * to `move`. Nothing in the type system holds that invariant up, so it is
 * asserted here after every kind of mutation: insert at a position, insert past
 * the end, remove from the middle, move up, move down, and a wholesale reorder.
 *
 * The rest is the same shape as `NotesHighlightsBookmarks.test.ts`: permission
 * gating, argument validation off the untyped RPC wire, and disposal.
 */

import { describe, it, expect } from 'vitest';
import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import { CollectionsApiImpl, InMemoryCollectionsBridge } from '../api-impl';

type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;
type PassageEntryDto = Extensions.PassageEntryDto;
type PassageCollectionDto = Extensions.PassageCollectionDto;

// --- Paired transports ---------------------------------------------------
// Same harness as NotesHighlightsBookmarks.test.ts: two transports wired to
// each other so a "worker" request lands on the real router and the real
// api-impl, rather than calling handler methods directly. Calls have to
// survive the RPC envelope for the validation tests below to mean anything -
// that is exactly where the untyped `unknown[]` comes from.

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
} {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
  const hostSide: IRpcTransport = {
    send(env) {
      hostSent.push(env);
      workerHandler?.(env);
    },
    onMessage(h) {
      hostHandler = h;
    },
    close() {
      hostHandler = null;
    },
  };
  const workerSide: IRpcTransport = {
    send(env) {
      hostHandler?.(env);
    },
    onMessage(h) {
      workerHandler = h;
    },
    close() {
      workerHandler = null;
    },
  };
  return { hostSide, workerSide, hostSent };
}

let nextWorkerReqId = 1;

async function workerCall(
  workerSide: IRpcTransport,
  hostSent: unknown[],
  method: string,
  args: unknown[],
): Promise<RpcResponse> {
  const startLen = hostSent.length;
  const id = `w-${nextWorkerReqId++}`;
  const req: RpcRequest = { kind: 'request', id, method, args };
  workerSide.send(req);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setImmediate(r));
    for (let j = startLen; j < hostSent.length; j++) {
      const env = hostSent[j];
      if (
        env &&
        typeof env === 'object' &&
        (env as RpcResponse).kind === 'response' &&
        (env as RpcResponse).id === id
      ) {
        return env as RpcResponse;
      }
    }
  }
  throw new Error(`workerCall: no response received for ${method}`);
}

// --- Helpers -------------------------------------------------------------

const RW = ['bookmarks:read', 'bookmarks:write'];

function makeCollections(permissions: string[] = RW) {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);
  const bridge = new InMemoryCollectionsBridge();
  const api = new CollectionsApiImpl({
    extensionId: 'ext.test.collections',
    router,
    bridge,
    grant: buildGrant('ext.test.collections', permissions),
  });
  api.attach();

  const call = (method: string, args: unknown[]): Promise<RpcResponse> =>
    workerCall(pair.workerSide, pair.hostSent, method, args);

  return { pair, bridge, api, call };
}

/** The ids of a collection's entries, in position order. */
function idsOf(entries: PassageEntryDto[]): string[] {
  return entries.map((e) => e.id);
}

/**
 * The invariant the whole namespace rests on: positions are exactly 0..n-1,
 * in the order the entries came back. A single assertion so a failure names
 * the actual sequence rather than "expected 2 to be 1".
 */
function expectDensePositions(entries: PassageEntryDto[]): void {
  expect(entries.map((e) => e.position)).toEqual(entries.map((_, i) => i));
}

/** Seed a collection with n appended passages and return it plus their ids. */
async function seed(
  call: (method: string, args: unknown[]) => Promise<RpcResponse>,
  labels: string[],
): Promise<{ collectionId: string; ids: string[] }> {
  const created = await call('collections.create', ['Plan']);
  expect(created.error).toBeUndefined();
  const collectionId = (created.result as PassageCollectionDto).id;
  const ids: string[] = [];
  for (const [i, label] of labels.entries()) {
    const res = await call('collections.addPassage', [
      collectionId,
      { verseIdStart: 45008000 + i, verseIdEnd: 45008000 + i, label },
    ]);
    expect(res.error).toBeUndefined();
    ids.push((res.result as PassageEntryDto).id);
  }
  return { collectionId, ids };
}

// ---------------------------------------------------------------------------
// Collection CRUD
// ---------------------------------------------------------------------------

describe('collections - collection CRUD', () => {
  it('creates, lists and renames a collection', async () => {
    const { call } = makeCollections();

    const created = await call('collections.create', ['Romans in 30 days']);
    expect(created.error).toBeUndefined();
    const dto = created.result as PassageCollectionDto;
    expect(dto.name).toBe('Romans in 30 days');
    expect(dto.entryCount).toBe(0);

    const listed = await call('collections.list', []);
    expect((listed.result as PassageCollectionDto[]).map((c) => c.id)).toEqual([dto.id]);

    const renamed = await call('collections.rename', [dto.id, 'Romans, slower']);
    expect(renamed.error).toBeUndefined();
    expect((renamed.result as PassageCollectionDto).name).toBe('Romans, slower');
  });

  it('accepts nesting, colour and icon', async () => {
    const { call } = makeCollections();
    const parent = (
      (await call('collections.create', ['Plans'])).result as PassageCollectionDto
    ).id;
    const child = await call('collections.create', [
      'Romans',
      { parentId: parent, color: '#aa3311', icon: 'scroll', description: 'Paul' },
    ]);
    expect(child.error).toBeUndefined();
    const dto = child.result as PassageCollectionDto;
    expect(dto.parentId).toBe(parent);
    expect(dto.color).toBe('#aa3311');
    expect(dto.icon).toBe('scroll');
  });

  it('reports entryCount without aggregating nested children', async () => {
    // entryCount answering "this collection plus everything under it" would
    // disagree with listPassages(id).length, which is the number a UI paints
    // next to the row it just rendered.
    const { call } = makeCollections();
    const parent = (
      (await call('collections.create', ['Plans'])).result as PassageCollectionDto
    ).id;
    const child = (
      (await call('collections.create', ['Romans', { parentId: parent }]))
        .result as PassageCollectionDto
    ).id;
    await call('collections.addPassage', [child, { verseIdStart: 45008028 }]);

    const all = (await call('collections.list', [])).result as PassageCollectionDto[];
    expect(all.find((c) => c.id === parent)?.entryCount).toBe(0);
    expect(all.find((c) => c.id === child)?.entryCount).toBe(1);
  });

  it('deletes a collection with its passages and nested children', async () => {
    const { call, bridge } = makeCollections();
    const parent = (
      (await call('collections.create', ['Plans'])).result as PassageCollectionDto
    ).id;
    const child = (
      (await call('collections.create', ['Romans', { parentId: parent }]))
        .result as PassageCollectionDto
    ).id;
    await call('collections.addPassage', [child, { verseIdStart: 45008028 }]);

    const res = await call('collections.delete', [parent]);
    expect(res.error).toBeUndefined();
    expect(bridge.collections).toHaveLength(0);
    expect(bridge.passages).toHaveLength(0);
  });

  it('rejects an unknown collection id rather than answering emptily', async () => {
    // "No such collection" and "an empty collection" are different answers and
    // a caller acts differently on each; collapsing them hides stale ids.
    const { call } = makeCollections();
    const res = await call('collections.listPassages', ['col-nope']);
    expect(res.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

describe('collections - passage ranges', () => {
  it('stores a range with its label and module', async () => {
    const { call } = makeCollections();
    const { collectionId } = await seed(call, []);
    const res = await call('collections.addPassage', [
      collectionId,
      {
        verseIdStart: 45008028,
        verseIdEnd: 45008030,
        label: 'Day 12 - the golden chain',
        moduleId: 'KJV',
        notes: 'read slowly',
      },
    ]);
    expect(res.error).toBeUndefined();
    const entry = res.result as PassageEntryDto;
    expect(entry.verseIdStart).toBe(45008028);
    expect(entry.verseIdEnd).toBe(45008030);
    expect(entry.label).toBe('Day 12 - the golden chain');
    expect(entry.moduleId).toBe('KJV');
    expect(entry.notes).toBe('read slowly');
    expect(entry.position).toBe(0);
  });

  it('stores a single verse as end = start, never as a missing end', async () => {
    // A NULL end previously made single-verse rows match every range query
    // starting after them. The DTO cannot express that shape and neither may
    // the store.
    const { call } = makeCollections();
    const { collectionId } = await seed(call, []);
    const entry = (
      await call('collections.addPassage', [collectionId, { verseIdStart: 43003016 }])
    ).result as PassageEntryDto;
    expect(entry.verseIdEnd).toBe(43003016);
  });

  it('resolves a reference when the host can, and omits it when it cannot', async () => {
    const { call, bridge } = makeCollections();
    const { collectionId } = await seed(call, []);
    await call('collections.addPassage', [
      collectionId,
      { verseIdStart: 45008028, verseIdEnd: 45008030 },
    ]);

    let listed = (await call('collections.listPassages', [collectionId]))
      .result as PassageEntryDto[];
    expect(listed[0]!.reference).toBeUndefined();

    bridge.referenceResolver = (s, e) => `verses ${s}-${e}`;
    listed = (await call('collections.listPassages', [collectionId]))
      .result as PassageEntryDto[];
    expect(listed[0]!.reference).toBe('verses 45008028-45008030');
  });

  it('removes a passage', async () => {
    const { call, bridge } = makeCollections();
    const { collectionId, ids } = await seed(call, ['a', 'b']);
    const res = await call('collections.removePassage', [ids[0]]);
    expect(res.error).toBeUndefined();
    const listed = (await call('collections.listPassages', [collectionId]))
      .result as PassageEntryDto[];
    expect(idsOf(listed)).toEqual([ids[1]]);
    expect(bridge.passages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('collections - ordering', () => {
  it('appends in call order when no position is given', async () => {
    const { call } = makeCollections();
    const { collectionId, ids } = await seed(call, ['a', 'b', 'c']);
    const listed = (await call('collections.listPassages', [collectionId]))
      .result as PassageEntryDto[];
    expect(idsOf(listed)).toEqual(ids);
    expectDensePositions(listed);
  });

  it('inserts at an explicit position and shifts later entries down', async () => {
    const { call } = makeCollections();
    const { collectionId, ids } = await seed(call, ['a', 'b', 'c']);
    const inserted = (
      await call('collections.addPassage', [
        collectionId,
        { verseIdStart: 1001, label: 'wedged', position: 1 },
      ])
    ).result as PassageEntryDto;
    expect(inserted.position).toBe(1);

    const listed = (await call('collections.listPassages', [collectionId]))
      .result as PassageEntryDto[];
    expect(idsOf(listed)).toEqual([ids[0], inserted.id, ids[1], ids[2]]);
    expectDensePositions(listed);
  });

  it('appends when the requested position is past the end', async () => {
    const { call } = makeCollections();
    const { collectionId, ids } = await seed(call, ['a', 'b']);
    const inserted = (
      await call('collections.addPassage', [
        collectionId,
        { verseIdStart: 1001, position: 99 },
      ])
    ).result as PassageEntryDto;
    const listed = (await call('collections.listPassages', [collectionId]))
      .result as PassageEntryDto[];
    expect(idsOf(listed)).toEqual([...ids, inserted.id]);
    expectDensePositions(listed);
  });

  it('closes the gap after a removal from the middle', async () => {
    const { call } = makeCollections();
    const { collectionId, ids } = await seed(call, ['a', 'b', 'c']);
    await call('collections.removePassage', [ids[1]]);
    const listed = (await call('collections.listPassages', [collectionId]))
      .result as PassageEntryDto[];
    expect(idsOf(listed)).toEqual([ids[0], ids[2]]);
    // The survivor that was at 2 must now be at 1. A gap here is what makes a
    // read-back position useless as an argument to `move`.
    expectDensePositions(listed);
  });

  it('moves an entry earlier and returns the whole new ordering', async () => {
    const { call } = makeCollections();
    const { ids } = await seed(call, ['a', 'b', 'c']);
    const res = await call('collections.move', [ids[2], 0]);
    expect(res.error).toBeUndefined();
    const ordering = res.result as PassageEntryDto[];
    expect(idsOf(ordering)).toEqual([ids[2], ids[0], ids[1]]);
    expectDensePositions(ordering);
  });

  it('moves an entry later', async () => {
    const { call } = makeCollections();
    const { ids } = await seed(call, ['a', 'b', 'c']);
    const ordering = (await call('collections.move', [ids[0], 2]))
      .result as PassageEntryDto[];
    expect(idsOf(ordering)).toEqual([ids[1], ids[2], ids[0]]);
    expectDensePositions(ordering);
  });

  it('clamps a move past the end to last rather than rejecting', async () => {
    const { call } = makeCollections();
    const { ids } = await seed(call, ['a', 'b', 'c']);
    const ordering = (await call('collections.move', [ids[0], 99]))
      .result as PassageEntryDto[];
    expect(idsOf(ordering)).toEqual([ids[1], ids[2], ids[0]]);
    expectDensePositions(ordering);
  });

  it('reorders wholesale', async () => {
    const { call } = makeCollections();
    const { collectionId, ids } = await seed(call, ['a', 'b', 'c']);
    const reversed = [ids[2]!, ids[1]!, ids[0]!];
    const res = await call('collections.reorder', [collectionId, reversed]);
    expect(res.error).toBeUndefined();
    expect(idsOf(res.result as PassageEntryDto[])).toEqual(reversed);

    const listed = (await call('collections.listPassages', [collectionId]))
      .result as PassageEntryDto[];
    expect(idsOf(listed)).toEqual(reversed);
    expectDensePositions(listed);
  });

  it('refuses a partial reorder instead of silently placing the rest', async () => {
    const { call } = makeCollections();
    const { collectionId, ids } = await seed(call, ['a', 'b', 'c']);
    const res = await call('collections.reorder', [collectionId, [ids[0], ids[1]]]);
    expect(res.error).toBeDefined();

    // And nothing moved.
    const listed = (await call('collections.listPassages', [collectionId]))
      .result as PassageEntryDto[];
    expect(idsOf(listed)).toEqual(ids);
  });

  it('refuses a reorder naming an entry from another collection', async () => {
    const { call } = makeCollections();
    const a = await seed(call, ['a', 'b']);
    const b = await seed(call, ['x', 'y']);
    const res = await call('collections.reorder', [
      a.collectionId,
      [a.ids[0], b.ids[0]],
    ]);
    expect(res.error).toBeDefined();
  });

  it('keeps orderings independent across collections', async () => {
    const { call } = makeCollections();
    const a = await seed(call, ['a1', 'a2']);
    const b = await seed(call, ['b1', 'b2', 'b3']);
    await call('collections.move', [a.ids[1], 0]);

    const listedB = (await call('collections.listPassages', [b.collectionId]))
      .result as PassageEntryDto[];
    expect(idsOf(listedB)).toEqual(b.ids);
    expectDensePositions(listedB);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('collections - argument validation', () => {
  it('rejects a non-string collection id', async () => {
    const { call } = makeCollections();
    const res = await call('collections.listPassages', [42]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('rejects an empty collection id', async () => {
    // An empty id reads as "no id" to a store and would widen a targeted
    // delete into an unbounded one.
    const { call } = makeCollections();
    const res = await call('collections.delete', ['']);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('rejects an empty or non-localizable collection name', async () => {
    const { call } = makeCollections();
    expect((await call('collections.create', [''])).error?.code).toBe('RpcProtocolError');
    expect((await call('collections.create', [{ params: {} }])).error?.code).toBe(
      'RpcProtocolError',
    );
    // The `{ key }` catalog form is legitimate.
    expect((await call('collections.create', [{ key: 'plan.romans' }])).error).toBeUndefined();
  });

  it('rejects a non-numeric verseIdStart', async () => {
    const { call } = makeCollections();
    const { collectionId } = await seed(call, []);
    const res = await call('collections.addPassage', [
      collectionId,
      { verseIdStart: '45008028' },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('rejects an inverted range', async () => {
    // An inverted range is not a narrower selection - it matches nothing, and
    // looks like data loss to whoever stored it.
    const { call } = makeCollections();
    const { collectionId } = await seed(call, []);
    const res = await call('collections.addPassage', [
      collectionId,
      { verseIdStart: 45008030, verseIdEnd: 45008028 },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('rejects a negative or fractional position', async () => {
    const { call } = makeCollections();
    const { collectionId, ids } = await seed(call, ['a']);
    expect(
      (await call('collections.addPassage', [collectionId, { verseIdStart: 1, position: -1 }]))
        .error?.code,
    ).toBe('RpcProtocolError');
    expect((await call('collections.move', [ids[0], -1])).error?.code).toBe(
      'RpcProtocolError',
    );
    expect((await call('collections.move', [ids[0], 1.5])).error?.code).toBe(
      'RpcProtocolError',
    );
  });

  it('rejects a non-array reorder list and non-string members', async () => {
    const { call } = makeCollections();
    const { collectionId } = await seed(call, ['a']);
    expect((await call('collections.reorder', [collectionId, 'pin-1'])).error?.code).toBe(
      'RpcProtocolError',
    );
    expect((await call('collections.reorder', [collectionId, [7]])).error?.code).toBe(
      'RpcProtocolError',
    );
  });

  it('rejects a passage payload that is not an object', async () => {
    const { call } = makeCollections();
    const { collectionId } = await seed(call, []);
    expect((await call('collections.addPassage', [collectionId, null])).error?.code).toBe(
      'RpcProtocolError',
    );
  });
});

// ---------------------------------------------------------------------------
// Permissions and disposal
// ---------------------------------------------------------------------------

describe('collections - permissions', () => {
  it('allows reads with bookmarks:read', async () => {
    const { call } = makeCollections(['bookmarks:read']);
    const res = await call('collections.list', []);
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual([]);
  });

  it('rejects reads without bookmarks:read', async () => {
    const { call } = makeCollections(['bookmarks:write']);
    expect((await call('collections.list', [])).error?.code).toBe('PermissionDeniedError');
    expect((await call('collections.listPassages', ['col-1'])).error?.code).toBe(
      'PermissionDeniedError',
    );
  });

  it('rejects every write without bookmarks:write', async () => {
    const { call } = makeCollections(['bookmarks:read']);
    const writes: [string, unknown[]][] = [
      ['collections.create', ['Plan']],
      ['collections.rename', ['col-1', 'Plan']],
      ['collections.delete', ['col-1']],
      ['collections.addPassage', ['col-1', { verseIdStart: 1 }]],
      ['collections.removePassage', ['pin-1']],
      ['collections.move', ['pin-1', 0]],
      ['collections.reorder', ['col-1', ['pin-1']]],
    ];
    for (const [method, args] of writes) {
      const res = await call(method, args);
      expect(res.error?.code, method).toBe('PermissionDeniedError');
    }
  });

  it('checks the permission before validating arguments', async () => {
    // Otherwise the error message tells an extension that was refused access
    // exactly what a well-formed call would have looked like.
    const { call } = makeCollections(['bookmarks:read']);
    const res = await call('collections.addPassage', [42, 'not-a-passage']);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });
});

describe('collections - disposal', () => {
  it('rejects calls after dispose', async () => {
    const { call, api } = makeCollections();
    api.dispose();
    const res = await call('collections.list', []);
    expect(res.error?.code).toBe('ExtensionNotActiveError');
  });

  it('tolerates a repeated dispose', async () => {
    const { api } = makeCollections();
    api.dispose();
    expect(() => api.dispose()).not.toThrow();
  });
});
