/**
 * bibleWorker message handling, over a fake wa-sqlite.
 *
 * The real async build is not re-entrant: overlapping opens could bind a handle
 * registered as one module to another module's file (ASV text shown as KJV).
 * These pin the two defences: messages run one at a time, and an opened file
 * must name itself as the module it was opened for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** File path -> the abbreviation its module_info holds. */
const files = new Map<string, string>();
let inFlight = 0;
let maxInFlight = 0;
let nextHandle = 1;
const handles = new Map<number, string>();

const tick = () => new Promise((r) => setTimeout(r, 0));

const fakeApi = {
  vfs_register: () => {},
  async open_v2(path: string) {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await tick();
    await tick();
    inFlight--;
    const h = nextHandle++;
    handles.set(h, path);
    return h;
  },
  async close(h: number) { handles.delete(h); },
  async exec(h: number, sql: string, cb: (row: unknown[]) => void) {
    if (sql.includes('module_info')) cb([files.get(handles.get(h)!) ?? null]);
    else if (sql.includes('sqlite_master')) cb([0]);
  },
};

vi.mock('wa-sqlite/dist/wa-sqlite-async.mjs', () => ({ default: async () => ({}) }));
vi.mock('wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js', () => ({ OriginPrivateFileSystemVFS: class {} }));
vi.mock('wa-sqlite', () => ({ Factory: () => fakeApi, SQLITE_ROW: 100 }));

type Posted = Record<string, unknown>;
let posted: Posted[];

async function loadWorker(): Promise<(data: unknown) => void> {
  vi.resetModules();
  posted = [];
  (self as unknown as { postMessage: (m: Posted) => void }).postMessage = (m) => { posted.push(m); };
  await import('./bibleWorker');
  const handler = (self as unknown as { onmessage: (e: { data: unknown }) => void }).onmessage;
  return (data) => handler({ data });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) await tick();
}

beforeEach(() => {
  files.clear();
  handles.clear();
  inFlight = 0;
  maxInFlight = 0;
  files.set('modules/KJV.db', 'KJV');
  files.set('modules/ASV.db', 'ASV');
  files.set('modules/WEB.db', 'WEB');
});

describe('bibleWorker', () => {
  it('handles messages one at a time even when posted in the same tick', async () => {
    const send = await loadWorker();
    send({ type: 'openDb', module: 'KJV' });
    send({ type: 'openDb', module: 'ASV' });
    send({ type: 'openDb', module: 'WEB' });
    await settle();

    expect(maxInFlight).toBe(1);
    expect(posted.filter((m) => m.type === 'dbReady').map((m) => m.module)).toEqual(['KJV', 'ASV', 'WEB']);
  });

  it('refuses a file whose module_info names a different module', async () => {
    files.set('modules/KJV.db', 'ASV');
    const send = await loadWorker();
    send({ type: 'openDb', module: 'KJV' });
    await settle();

    expect(posted.some((m) => m.type === 'dbReady')).toBe(false);
    const err = posted.find((m) => m.type === 'error');
    expect(err).toMatchObject({ requestId: -1, module: 'KJV' });
    expect(handles.size).toBe(0);
  });

  it('reports a module it no longer has open', async () => {
    const send = await loadWorker();
    send({ type: 'getChapter', requestId: 7, module: 'KJV', book: 43, chapter: 3 });
    await settle();

    expect(posted).toContainEqual({ type: 'dbClosed', module: 'KJV' });
    expect(posted).toContainEqual(expect.objectContaining({ type: 'error', requestId: 7 }));
  });
});
