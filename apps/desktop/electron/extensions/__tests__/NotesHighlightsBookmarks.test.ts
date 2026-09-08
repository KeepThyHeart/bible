/**
 * Notes / highlights / bookmarks api-impl unit tests.
 *
 * Tests permission gating, parameter validation, bridge delegation, change
 * events, and disposal for all three namespaces:
 *
 *   - notes (list, get, create, update, delete, onDidChange)
 *   - highlights (list, create, update, delete, registerStyle, listStyles, onDidChange)
 *   - bookmarks (list, add, remove, listCollections, createCollection)
 */

import { describe, it, expect } from 'vitest';
import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import {
  NotesApiImpl,
  HighlightsApiImpl,
  BookmarksApiImpl,
  InMemoryNotesBridge,
  InMemoryHighlightsBridge,
  InMemoryBookmarksBridge,
} from '../api-impl';

type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;

// --- Paired transports ---------------------------------------------------

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
  workerSent: unknown[];
} {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
  const workerSent: unknown[] = [];
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
      workerSent.push(env);
      hostHandler?.(env);
    },
    onMessage(h) {
      workerHandler = h;
    },
    close() {
      workerHandler = null;
    },
  };
  return { hostSide, workerSide, hostSent, workerSent };
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

function makeNotes(permissions: string[]) {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);
  const bridge = new InMemoryNotesBridge();
  const api = new NotesApiImpl({
    extensionId: 'ext.test.notes',
    router,
    bridge,
    grant: buildGrant('ext.test.notes', permissions),
  });
  api.attach();
  return { pair, bridge, api };
}

function makeHighlights(permissions: string[]) {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);
  const bridge = new InMemoryHighlightsBridge();
  const api = new HighlightsApiImpl({
    extensionId: 'ext.test.hl',
    router,
    bridge,
    grant: buildGrant('ext.test.hl', permissions),
  });
  api.attach();
  return { pair, bridge, api };
}

function makeBookmarks(permissions: string[]) {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);
  const bridge = new InMemoryBookmarksBridge();
  const api = new BookmarksApiImpl({
    extensionId: 'ext.test.bm',
    router,
    bridge,
    grant: buildGrant('ext.test.bm', permissions),
  });
  api.attach();
  return { pair, bridge, api };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

describe('notes', () => {
  describe('notes.create', () => {
    it('creates a note with notes:write permission', async () => {
      const { pair, bridge } = makeNotes(['notes:read', 'notes:write']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.create', [
        { content: 'Test note', title: 'My Note', linkedVerses: [43003016] },
      ]);
      expect(res.error).toBeUndefined();
      expect(res.result).toHaveProperty('id');
      expect((res.result as { content: string }).content).toBe('Test note');
      expect(bridge.notes).toHaveLength(1);
    });

    it('rejects without notes:write permission', async () => {
      const { pair } = makeNotes(['notes:read']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.create', [
        { content: 'Test' },
      ]);
      expect(res.error?.code).toBe('PermissionDeniedError');
    });

    it('rejects invalid input', async () => {
      const { pair } = makeNotes(['notes:write']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.create', ['bad']);
      expect(res.error?.code).toBe('RpcProtocolError');
    });
  });

  describe('notes.get', () => {
    it('returns a note by id', async () => {
      const { pair, bridge } = makeNotes(['notes:read', 'notes:write']);
      bridge.create({ content: 'Hello', title: 'Test' });
      const noteId = bridge.notes[0].id;
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.get', [noteId]);
      expect(res.error).toBeUndefined();
      expect((res.result as { id: string }).id).toBe(noteId);
    });

    it('returns null for missing note', async () => {
      const { pair } = makeNotes(['notes:read']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.get', ['missing']);
      expect(res.error).toBeUndefined();
      expect(res.result).toBeNull();
    });

    it('rejects without notes:read', async () => {
      const { pair } = makeNotes([]);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.get', ['any']);
      expect(res.error?.code).toBe('PermissionDeniedError');
    });
  });

  describe('notes.list', () => {
    it('lists notes with query filter', async () => {
      const { pair, bridge } = makeNotes(['notes:read']);
      bridge.create({ content: 'Alpha', type: 'sermon' });
      bridge.create({ content: 'Beta', type: 'prayer' });
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.list', [
        { type: 'sermon' },
      ]);
      expect(res.error).toBeUndefined();
      expect((res.result as unknown[]).length).toBe(1);
    });

    it('lists all notes when no query', async () => {
      const { pair, bridge } = makeNotes(['notes:read']);
      bridge.create({ content: 'One' });
      bridge.create({ content: 'Two' });
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.list', []);
      expect(res.error).toBeUndefined();
      expect((res.result as unknown[]).length).toBe(2);
    });
  });

  describe('notes.update', () => {
    it('updates an existing note', async () => {
      const { pair, bridge } = makeNotes(['notes:read', 'notes:write']);
      bridge.create({ content: 'Original' });
      const id = bridge.notes[0].id;
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.update', [
        id,
        { content: 'Updated' },
      ]);
      expect(res.error).toBeUndefined();
      expect((res.result as { content: string }).content).toBe('Updated');
    });
  });

  describe('notes.delete', () => {
    it('deletes an existing note', async () => {
      const { pair, bridge } = makeNotes(['notes:write']);
      bridge.create({ content: 'Goodbye' });
      const id = bridge.notes[0].id;
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.delete', [id]);
      expect(res.error).toBeUndefined();
      expect(bridge.notes).toHaveLength(0);
    });
  });

  describe('notes.onDidChange', () => {
    it('emits change events to subscribed workers', async () => {
      const pair = pairedTransports();
      const router = new ExtensionRpcRouter(pair.hostSide);
      const bridge = new InMemoryNotesBridge();
      const api = new NotesApiImpl({
        extensionId: 'ext.test.notes',
        router,
        bridge,
        grant: buildGrant('ext.test.notes', ['notes:read', 'notes:write']),
      });
      api.attach();

      // The worker must subscribe to the channel before the router will emit.
      pair.workerSide.send({
        kind: 'subscribe',
        id: 'sub-1',
        channel: 'notes.onDidChange',
      });
      await new Promise((r) => setImmediate(r));

      const startLen = pair.hostSent.length;

      // Create a note via bridge directly - fires the change handler the
      // api-impl subscribed to in attach().
      bridge.create({ content: 'Event test' });
      await new Promise((r) => setImmediate(r));

      // Scan hostSent for event envelopes emitted after our create.
      const newEvents = pair.hostSent.slice(startLen).filter(
        (env) =>
          env &&
          typeof env === 'object' &&
          (env as { kind: string }).kind === 'event' &&
          (env as { channel: string }).channel === 'notes.onDidChange',
      );
      expect(newEvents.length).toBeGreaterThan(0);
      expect((newEvents[0] as { payload: unknown }).payload).toHaveProperty('type', 'created');
    });
  });

  describe('disposal', () => {
    it('rejects calls after dispose', async () => {
      const { pair, api } = makeNotes(['notes:read', 'notes:write']);
      api.dispose();
      const res = await workerCall(pair.workerSide, pair.hostSent, 'notes.list', []);
      expect(res.error?.code).toBe('ExtensionNotActiveError');
    });
  });
});

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

describe('highlights', () => {
  describe('highlights.create', () => {
    it('creates a highlight with highlights:write', async () => {
      const { pair, bridge } = makeHighlights(['highlights:read', 'highlights:write']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.create', [
        { range: { verseId: 43003016 }, styleId: 'yellow' },
      ]);
      expect(res.error).toBeUndefined();
      expect(res.result).toHaveProperty('id');
      expect(bridge.highlights).toHaveLength(1);
    });

    it('rejects without highlights:write', async () => {
      const { pair } = makeHighlights(['highlights:read']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.create', [
        { range: { verseId: 43003016 }, styleId: 'yellow' },
      ]);
      expect(res.error?.code).toBe('PermissionDeniedError');
    });

    it('rejects missing range', async () => {
      const { pair } = makeHighlights(['highlights:write']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.create', [
        { styleId: 'yellow' },
      ]);
      expect(res.error?.code).toBe('RpcProtocolError');
    });

    it('rejects missing styleId', async () => {
      const { pair } = makeHighlights(['highlights:write']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.create', [
        { range: { verseId: 43003016 } },
      ]);
      expect(res.error?.code).toBe('RpcProtocolError');
    });
  });

  describe('highlights.list', () => {
    it('lists all highlights', async () => {
      const { pair, bridge } = makeHighlights(['highlights:read']);
      bridge.create({ range: { verseId: 1001001 }, styleId: 'yellow' });
      bridge.create({ range: { verseId: 43003016 }, styleId: 'blue' });
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.list', []);
      expect(res.error).toBeUndefined();
      expect((res.result as unknown[]).length).toBe(2);
    });

    it('filters by verseId', async () => {
      const { pair, bridge } = makeHighlights(['highlights:read']);
      bridge.create({ range: { verseId: 1001001 }, styleId: 'yellow' });
      bridge.create({ range: { verseId: 43003016 }, styleId: 'blue' });
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.list', [43003016]);
      expect(res.error).toBeUndefined();
      expect((res.result as unknown[]).length).toBe(1);
    });
  });

  describe('highlights.update', () => {
    it('updates an existing highlight', async () => {
      const { pair, bridge } = makeHighlights(['highlights:read', 'highlights:write']);
      bridge.create({ range: { verseId: 1001001 }, styleId: 'yellow' });
      const id = bridge.highlights[0].id;
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.update', [
        id,
        { styleId: 'green' },
      ]);
      expect(res.error).toBeUndefined();
      expect((res.result as { styleId: string }).styleId).toBe('green');
    });
  });

  describe('highlights.delete', () => {
    it('deletes a highlight', async () => {
      const { pair, bridge } = makeHighlights(['highlights:write']);
      bridge.create({ range: { verseId: 1001001 }, styleId: 'yellow' });
      const id = bridge.highlights[0].id;
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.delete', [id]);
      expect(res.error).toBeUndefined();
      expect(bridge.highlights).toHaveLength(0);
    });
  });

  describe('highlights.registerStyle', () => {
    it('registers a custom style with highlights:write', async () => {
      const { pair, bridge } = makeHighlights(['highlights:write']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.registerStyle', [
        {
          id: 'ext.test.hl.verbHighlight',
          label: 'Verb Highlight',
          style: { background: '#ff0000' },
        },
      ]);
      expect(res.error).toBeUndefined();
      expect(res.result).toHaveProperty('handle');
      expect(bridge.styles).toHaveLength(1);
    });

    it('rejects without highlights:write', async () => {
      const { pair } = makeHighlights(['highlights:read']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.registerStyle', [
        { id: 'test', label: 'Test', style: {} },
      ]);
      expect(res.error?.code).toBe('PermissionDeniedError');
    });

    it('rejects invalid style descriptor', async () => {
      const { pair } = makeHighlights(['highlights:write']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.registerStyle', [
        { id: '', label: 'Test', style: {} },
      ]);
      expect(res.error?.code).toBe('RpcProtocolError');
    });
  });

  describe('highlights.listStyles', () => {
    it('lists registered styles with highlights:read', async () => {
      const { pair, bridge } = makeHighlights(['highlights:read']);
      bridge.registerStyle('ext.other', {
        id: 'ext.other.nounHighlight',
        label: 'Noun',
        style: { background: { hex: '#00ff00' } },
      });
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.listStyles', []);
      expect(res.error).toBeUndefined();
      expect((res.result as unknown[]).length).toBe(1);
    });
  });

  describe('disposal', () => {
    it('cleans up styles on dispose', () => {
      const pair = pairedTransports();
      const router = new ExtensionRpcRouter(pair.hostSide);
      const bridge = new InMemoryHighlightsBridge();
      const api = new HighlightsApiImpl({
        extensionId: 'ext.test.hl',
        router,
        bridge,
        grant: buildGrant('ext.test.hl', ['highlights:write']),
      });
      api.attach();
      bridge.registerStyle('ext.test.hl', {
        id: 'ext.test.hl.style1',
        label: 'Style 1',
        style: { background: { hex: '#ff0' } },
      });
      expect(bridge.styles).toHaveLength(1);
      api.dispose();
      expect(bridge.styles).toHaveLength(0);
    });

    it('rejects calls after dispose', async () => {
      const { pair, api } = makeHighlights(['highlights:read']);
      api.dispose();
      const res = await workerCall(pair.workerSide, pair.hostSent, 'highlights.list', []);
      expect(res.error?.code).toBe('ExtensionNotActiveError');
    });
  });
});

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

describe('bookmarks', () => {
  describe('bookmarks.add', () => {
    it('adds a bookmark with bookmarks:write', async () => {
      const { pair, bridge } = makeBookmarks(['bookmarks:read', 'bookmarks:write']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.add', [43003016]);
      expect(res.error).toBeUndefined();
      expect(res.result).toHaveProperty('id');
      expect((res.result as { verseId: number }).verseId).toBe(43003016);
      expect(bridge.bookmarks).toHaveLength(1);
    });

    it('adds a bookmark to a collection', async () => {
      const { pair, bridge } = makeBookmarks(['bookmarks:write']);
      bridge.createCollection('Favorites');
      const colId = bridge.collections[0].id;
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.add', [
        43003016,
        colId,
      ]);
      expect(res.error).toBeUndefined();
      expect((res.result as { collectionId: string }).collectionId).toBe(colId);
    });

    it('rejects without bookmarks:write', async () => {
      const { pair } = makeBookmarks(['bookmarks:read']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.add', [43003016]);
      expect(res.error?.code).toBe('PermissionDeniedError');
    });

    it('rejects non-numeric verseId', async () => {
      const { pair } = makeBookmarks(['bookmarks:write']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.add', ['bad']);
      expect(res.error?.code).toBe('RpcProtocolError');
    });
  });

  describe('bookmarks.list', () => {
    it('lists all bookmarks', async () => {
      const { pair, bridge } = makeBookmarks(['bookmarks:read']);
      bridge.add(1001001);
      bridge.add(43003016);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.list', []);
      expect(res.error).toBeUndefined();
      expect((res.result as unknown[]).length).toBe(2);
    });

    it('filters by collectionId', async () => {
      const { pair, bridge } = makeBookmarks(['bookmarks:read']);
      const col = bridge.createCollection('Test');
      bridge.add(1001001, col.id);
      bridge.add(43003016);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.list', [col.id]);
      expect(res.error).toBeUndefined();
      expect((res.result as unknown[]).length).toBe(1);
    });
  });

  describe('bookmarks.remove', () => {
    it('removes a bookmark', async () => {
      const { pair, bridge } = makeBookmarks(['bookmarks:write']);
      bridge.add(43003016);
      const id = bridge.bookmarks[0].id;
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.remove', [id]);
      expect(res.error).toBeUndefined();
      expect(bridge.bookmarks).toHaveLength(0);
    });
  });

  describe('bookmarks.listCollections', () => {
    it('lists collections with bookmarks:read', async () => {
      const { pair, bridge } = makeBookmarks(['bookmarks:read']);
      bridge.createCollection('Favorites');
      bridge.createCollection('Study');
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.listCollections', []);
      expect(res.error).toBeUndefined();
      expect((res.result as unknown[]).length).toBe(2);
    });
  });

  describe('bookmarks.createCollection', () => {
    it('creates a collection with bookmarks:write', async () => {
      const { pair, bridge } = makeBookmarks(['bookmarks:write']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.createCollection', [
        'My Collection',
      ]);
      expect(res.error).toBeUndefined();
      expect(res.result).toHaveProperty('id');
      expect((res.result as { name: string }).name).toBe('My Collection');
      expect(bridge.collections).toHaveLength(1);
    });

    it('rejects without bookmarks:write', async () => {
      const { pair } = makeBookmarks(['bookmarks:read']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.createCollection', [
        'Test',
      ]);
      expect(res.error?.code).toBe('PermissionDeniedError');
    });
  });

  describe('disposal', () => {
    it('rejects calls after dispose', async () => {
      const { pair, api } = makeBookmarks(['bookmarks:read']);
      api.dispose();
      const res = await workerCall(pair.workerSide, pair.hostSent, 'bookmarks.list', []);
      expect(res.error?.code).toBe('ExtensionNotActiveError');
    });
  });
});
