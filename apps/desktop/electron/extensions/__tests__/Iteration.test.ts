/**
 * Unit tests for iteration + tokens + word-selection event.
 *
 * Tests cover:
 *   - bible.iterateVerses: cursor stability, page size clamping, range filtering
 *   - bible.getVerseTokens: round-tripping token data, null for non-interlinear
 *   - bible.onDidSelectVerseWord: event forwarding
 *   - commentary.iterateEntries: cursor-based paging
 *   - dictionary.iterateEntries: cursor-based paging with keyPrefix filter
 *   - book.iterateSections: cursor-based paging
 *   - Permission gating on all new methods
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import {
  BibleApiImpl,
  BookApiImpl,
  CommentaryApiImpl,
  DictionaryApiImpl,
  InMemoryBibleBridge,
  InMemoryBookBridge,
  InMemoryCommentaryBridge,
  InMemoryDictionaryBridge,
} from '../api-impl';

type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;
type RpcEvent = Extensions.RpcEvent;
type RpcSubscribe = Extensions.RpcSubscribe;
type VerseIterationResult = Extensions.VerseIterationResult;
type CommentaryIterationResult = Extensions.CommentaryIterationResult;
type DictionaryIterationResult = Extensions.DictionaryIterationResult;
type BookIterationResult = Extensions.BookIterationResult;
type VerseTokenDto = Extensions.VerseTokenDto;

// --- Paired transports -----------------------------------------------------

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

let nextReqId = 1;

async function workerCall(
  workerSide: IRpcTransport,
  hostSent: unknown[],
  method: string,
  args: unknown[],
): Promise<RpcResponse> {
  const startLen = hostSent.length;
  const id = `w-${nextReqId++}`;
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
  throw new Error(`workerCall: no response for ${method}`);
}

function isEventOn(env: unknown, channel: string): boolean {
  return (
    typeof env === 'object' &&
    env !== null &&
    (env as RpcEvent).kind === 'event' &&
    (env as RpcEvent).channel === channel
  );
}

// --- bible.iterateVerses ----------------------------------------------------

describe('BibleApiImpl — iteration + tokens', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let router: ExtensionRpcRouter;
  let bridge: InMemoryBibleBridge;

  beforeEach(() => {
    pair = pairedTransports();
    router = new ExtensionRpcRouter(pair.hostSide);
    bridge = new InMemoryBibleBridge();

    // Seed 5 verses: Gen 1:1-1:3, John 3:16-3:17
    bridge.verses.set(1001001, { verseId: 1001001, text: 'In the beginning' });
    bridge.verses.set(1001002, { verseId: 1001002, text: 'And the earth was' });
    bridge.verses.set(1001003, { verseId: 1001003, text: 'And God said' });
    bridge.verses.set(43003016, { verseId: 43003016, text: 'For God so loved' });
    bridge.verses.set(43003017, { verseId: 43003017, text: 'For God sent not' });

    // Seed tokens for John 3:16
    bridge.tokens.set(43003016, [
      { index: 0, text: 'For', startOffset: 0, endOffset: 3 },
      { index: 1, text: 'God', startOffset: 4, endOffset: 7, strongsNumber: 'G2316' },
      { index: 2, text: 'so', startOffset: 8, endOffset: 10 },
      { index: 3, text: 'loved', startOffset: 11, endOffset: 16, lemma: 'agapao', strongsNumber: 'G25' },
    ]);

    const api = new BibleApiImpl({
      extensionId: 'ext.test',
      router,
      bridge,
      grant: buildGrant('ext.test', ['bible:read']),
    });
    api.attach();
  });

  it('iterates all verses with default page size', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.iterateVerses', [
      { module: 'kjv' },
    ]);
    expect(res.error).toBeUndefined();
    const result = res.result as VerseIterationResult;
    expect(result.verses).toHaveLength(5);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  it('respects pageSize and returns a cursor for the next page', async () => {
    const res1 = await workerCall(pair.workerSide, pair.hostSent, 'bible.iterateVerses', [
      { module: 'kjv', pageSize: 2 },
    ]);
    const page1 = res1.result as VerseIterationResult;
    expect(page1.verses).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    // Use cursor for next page
    const res2 = await workerCall(pair.workerSide, pair.hostSent, 'bible.iterateVerses', [
      { module: 'kjv', pageSize: 2, cursor: page1.nextCursor },
    ]);
    const page2 = res2.result as VerseIterationResult;
    expect(page2.verses).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    // Third page - last verse
    const res3 = await workerCall(pair.workerSide, pair.hostSent, 'bible.iterateVerses', [
      { module: 'kjv', pageSize: 2, cursor: page2.nextCursor },
    ]);
    const page3 = res3.result as VerseIterationResult;
    expect(page3.verses).toHaveLength(1);
    expect(page3.hasMore).toBe(false);

    // All verse IDs across pages should be unique and ordered
    const allIds = [
      ...page1.verses.map((v) => v.verseId),
      ...page2.verses.map((v) => v.verseId),
      ...page3.verses.map((v) => v.verseId),
    ];
    expect(allIds).toHaveLength(5);
    for (let i = 1; i < allIds.length; i++) {
      expect(allIds[i]).toBeGreaterThan(allIds[i - 1]!);
    }
  });

  it('filters by verse range', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.iterateVerses', [
      { module: 'kjv', startVerseId: 1001001, endVerseId: 1001003 },
    ]);
    const result = res.result as VerseIterationResult;
    expect(result.verses).toHaveLength(3);
    expect(result.verses.every((v) => v.verseId >= 1001001 && v.verseId <= 1001003)).toBe(true);
  });

  it('clamps pageSize to 1000 max', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.iterateVerses', [
      { module: 'kjv', pageSize: 5000 },
    ]);
    expect(res.error).toBeUndefined();
    // With only 5 verses, clamping to 1000 still returns all 5
    expect((res.result as VerseIterationResult).verses).toHaveLength(5);
  });

  it('rejects missing module', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.iterateVerses', [{}]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  // --- bible.getVerseTokens ----------------------------------------------

  it('returns tokens for a verse with interlinear data', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.getVerseTokens', [
      43003016,
    ]);
    expect(res.error).toBeUndefined();
    const tokens = res.result as VerseTokenDto[];
    expect(tokens).toHaveLength(4);
    expect(tokens[1]).toMatchObject({ text: 'God', strongsNumber: 'G2316' });
    expect(tokens[3]).toMatchObject({ lemma: 'agapao', strongsNumber: 'G25' });
  });

  it('returns null for a verse without token data', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.getVerseTokens', [
      1001001,
    ]);
    expect(res.error).toBeUndefined();
    expect(res.result).toBeNull();
  });

  it('rejects non-number verseId', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.getVerseTokens', [
      'oops',
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  // --- bible.onDidSelectVerseWord ----------------------------------------

  it('emits onDidSelectVerseWord when subscribed', async () => {
    const channel = 'bible.onDidSelectVerseWord';

    // Fire before subscription - should not emit
    bridge.fireWordSelection({
      verseId: 43003016,
      range: { verseId: 43003016, startOffset: 4, endOffset: 7 },
      word: 'God',
    });
    expect(pair.hostSent.filter((e) => isEventOn(e, channel))).toHaveLength(0);

    // Subscribe
    const sub: RpcSubscribe = { kind: 'subscribe', id: 'sub-ws', channel };
    pair.workerSide.send(sub);
    await new Promise((r) => setImmediate(r));

    // Fire after subscription - should emit
    bridge.fireWordSelection({
      verseId: 43003016,
      range: { verseId: 43003016, startOffset: 4, endOffset: 7 },
      word: 'God',
      token: { index: 1, text: 'God', startOffset: 4, endOffset: 7, strongsNumber: 'G2316' },
    });
    const events = pair.hostSent.filter((e) => isEventOn(e, channel));
    expect(events).toHaveLength(1);
    expect((events[0] as RpcEvent).payload).toMatchObject({ word: 'God', verseId: 43003016 });
  });

  // --- permission gating -------------------------------------------------

  it('rejects iteration without bible:read', async () => {
    const pair2 = pairedTransports();
    const router2 = new ExtensionRpcRouter(pair2.hostSide);
    const api = new BibleApiImpl({
      extensionId: 'ext.noperm',
      router: router2,
      bridge,
      grant: buildGrant('ext.noperm', []),
    });
    api.attach();

    const res = await workerCall(pair2.workerSide, pair2.hostSent, 'bible.iterateVerses', [
      { module: 'kjv' },
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');

    const res2 = await workerCall(pair2.workerSide, pair2.hostSent, 'bible.getVerseTokens', [
      43003016,
    ]);
    expect(res2.error?.code).toBe('PermissionDeniedError');
  });
});

// --- commentary.iterateEntries ----------------------------------------------

describe('CommentaryApiImpl — iteration', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let bridge: InMemoryCommentaryBridge;

  beforeEach(() => {
    pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    bridge = new InMemoryCommentaryBridge();
    bridge.modules.push({ id: 'mhc', abbreviation: 'mhc', name: 'Henry' });

    // Seed 3 entries for mhc covering Gen 1:1, 1:2, John 3:16
    const entries = new Map<number, Extensions.CommentaryEntryDto>();
    entries.set(1001001, {
      id: '1', moduleId: 'mhc', startVerseId: 1001001, endVerseId: 1001001, content: 'A',
    });
    entries.set(1001002, {
      id: '2', moduleId: 'mhc', startVerseId: 1001002, endVerseId: 1001002, content: 'B',
    });
    entries.set(43003016, {
      id: '3', moduleId: 'mhc', startVerseId: 43003016, endVerseId: 43003016, content: 'C',
    });
    bridge.entries.set('mhc', entries);

    new CommentaryApiImpl({
      extensionId: 'ext.test',
      router,
      bridge,
      grant: buildGrant('ext.test', ['commentary:read']),
    }).attach();
  });

  it('iterates all entries with paging', async () => {
    const res1 = await workerCall(pair.workerSide, pair.hostSent, 'commentary.iterateEntries', [
      { moduleId: 'mhc', pageSize: 2 },
    ]);
    const page1 = res1.result as CommentaryIterationResult;
    expect(page1.entries).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const res2 = await workerCall(pair.workerSide, pair.hostSent, 'commentary.iterateEntries', [
      { moduleId: 'mhc', pageSize: 2, cursor: page1.nextCursor },
    ]);
    const page2 = res2.result as CommentaryIterationResult;
    expect(page2.entries).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  it('filters by verse range', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'commentary.iterateEntries', [
      { moduleId: 'mhc', startVerseId: 1001001, endVerseId: 1001002 },
    ]);
    const result = res.result as CommentaryIterationResult;
    expect(result.entries).toHaveLength(2);
  });

  it('rejects missing moduleId', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'commentary.iterateEntries', [
      {},
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });
});

// --- dictionary.iterateEntries ----------------------------------------------

describe('DictionaryApiImpl — iteration', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let bridge: InMemoryDictionaryBridge;

  beforeEach(() => {
    pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    bridge = new InMemoryDictionaryBridge();
    bridge.modules.push({ id: 'strongs', abbreviation: 'strongs', name: "Strong's" });

    const entries = new Map<string, Extensions.DictionaryEntryDto>();
    entries.set('G25', { key: 'G25', moduleId: 'strongs', headword: 'agapao', content: 'to love', strongsNumber: 'G25' });
    entries.set('G2316', { key: 'G2316', moduleId: 'strongs', headword: 'theos', content: 'God', strongsNumber: 'G2316' });
    entries.set('H430', { key: 'H430', moduleId: 'strongs', headword: 'elohim', content: 'God (Hebrew)', strongsNumber: 'H430' });
    bridge.entries.set('strongs', entries);

    new DictionaryApiImpl({
      extensionId: 'ext.test',
      router,
      bridge,
      grant: buildGrant('ext.test', ['dictionary:read']),
    }).attach();
  });

  it('iterates all entries with paging', async () => {
    const res1 = await workerCall(pair.workerSide, pair.hostSent, 'dictionary.iterateEntries', [
      { moduleId: 'strongs', pageSize: 2 },
    ]);
    const page1 = res1.result as DictionaryIterationResult;
    expect(page1.entries).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const res2 = await workerCall(pair.workerSide, pair.hostSent, 'dictionary.iterateEntries', [
      { moduleId: 'strongs', pageSize: 2, cursor: page1.nextCursor },
    ]);
    const page2 = res2.result as DictionaryIterationResult;
    expect(page2.entries).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  it('filters by keyPrefix', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'dictionary.iterateEntries', [
      { moduleId: 'strongs', keyPrefix: 'G' },
    ]);
    const result = res.result as DictionaryIterationResult;
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((e) => e.key.startsWith('G'))).toBe(true);
  });

  it('rejects missing moduleId', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'dictionary.iterateEntries', [
      {},
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });
});

// --- book.iterateSections ---------------------------------------------------

describe('BookApiImpl — iteration', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let bridge: InMemoryBookBridge;

  beforeEach(() => {
    pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    bridge = new InMemoryBookBridge();
    bridge.modules.push({ id: 'book1', abbreviation: 'book1', name: 'Test Book' });

    const sections = new Map<string, Extensions.BookSectionDto>();
    sections.set('1', {
      id: '1', moduleId: 'book1', title: 'Chapter 1', depth: 0, hasChildren: true, order: 0,
      content: 'Chapter 1 content', isHtml: true,
    });
    sections.set('2', {
      id: '2', moduleId: 'book1', parentId: '1', title: 'Section 1.1', depth: 1,
      hasChildren: false, order: 1, content: 'Section 1.1 content', isHtml: true,
    });
    sections.set('3', {
      id: '3', moduleId: 'book1', title: 'Chapter 2', depth: 0, hasChildren: false, order: 2,
      content: 'Chapter 2 content', isHtml: true,
    });
    bridge.sections.set('book1', sections);

    new BookApiImpl({
      extensionId: 'ext.test',
      router,
      bridge,
      grant: buildGrant('ext.test', ['book:read']),
    }).attach();
  });

  it('iterates all sections with paging', async () => {
    const res1 = await workerCall(pair.workerSide, pair.hostSent, 'book.iterateSections', [
      { moduleId: 'book1', pageSize: 2 },
    ]);
    const page1 = res1.result as BookIterationResult;
    expect(page1.sections).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const res2 = await workerCall(pair.workerSide, pair.hostSent, 'book.iterateSections', [
      { moduleId: 'book1', pageSize: 2, cursor: page1.nextCursor },
    ]);
    const page2 = res2.result as BookIterationResult;
    expect(page2.sections).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });

  it('filters by rootSectionId', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'book.iterateSections', [
      { moduleId: 'book1', rootSectionId: '1' },
    ]);
    const result = res.result as BookIterationResult;
    // Should include section 1 itself + its child section 2
    expect(result.sections).toHaveLength(2);
    expect(result.sections.map((s) => s.id).sort()).toEqual(['1', '2']);
  });

  it('rejects missing moduleId', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'book.iterateSections', [{}]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });
});
