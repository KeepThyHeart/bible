import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createBnFileSyncAdapter, sanitizeBnPath, type BnFileSyncAdapter } from '../BnFileSyncAdapter';

let tmp: string;
let notes: string;
let marks: Array<[string, string, boolean]>;
let warns: Array<[string, string]>;

function make(extra: Partial<Parameters<typeof createBnFileSyncAdapter>[0]> = {}): BnFileSyncAdapter {
  return createBnFileSyncAdapter({
    notesDir: notes,
    markDirty: (k, key, del) => { marks.push([k, key, del]); },
    warn: (p, r) => { warns.push([p, r]); },
    now: () => new Date('2026-10-09T12:00:00Z'),
    ...extra,
  });
}
const write = (rel: string, obj: unknown): void => {
  const full = path.join(notes, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(obj));
};
const ctx = {} as never;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bnsync-'));
  notes = path.join(tmp, 'notes');
  fs.mkdirSync(notes);
  marks = [];
  warns = [];
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe('collect', () => {
  it('marks new, edited, deleted and renamed files', async () => {
    const a = make();
    write('a.bn', { title: 'a' });
    write('dir/b.bn', { title: 'b' });
    await a.collect!();
    expect(marks.sort()).toEqual([['bn.file', 'a.bn', false], ['bn.file', 'dir/b.bn', false]]);

    marks = [];
    await a.collect!();
    expect(marks).toEqual([]);

    write('a.bn', { title: 'a2' });
    await a.collect!();
    expect(marks).toEqual([['bn.file', 'a.bn', false]]);

    marks = [];
    fs.unlinkSync(path.join(notes, 'dir/b.bn'));
    await a.collect!();
    expect(marks).toEqual([['bn.file', 'dir/b.bn', true]]);

    marks = [];
    fs.renameSync(path.join(notes, 'a.bn'), path.join(notes, 'c.bn'));
    await a.collect!();
    expect(marks.sort()).toEqual([['bn.file', 'a.bn', true], ['bn.file', 'c.bn', false]]);
  });

  it('does not mark a touched-but-identical file, and ignores .bak, hidden and temp files', async () => {
    const a = make();
    write('a.bn', { t: 1 });
    fs.writeFileSync(path.join(notes, 'a.bn.bak'), 'history');
    fs.writeFileSync(path.join(notes, '.x.bn.123.tmp'), '{}');
    fs.writeFileSync(path.join(notes, 'readme.txt'), 'x');
    await a.collect!();
    expect(marks).toEqual([['bn.file', 'a.bn', false]]);
    marks = [];
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(notes, 'a.bn'), future, future);
    await a.collect!();
    expect(marks).toEqual([]);
  });

  it('persists state across restarts when a stateFile is given', async () => {
    const stateFile = path.join(tmp, 'ud', 'bn-state.json');
    write('a.bn', { t: 1 });
    await make({ stateFile }).collect!();
    marks = [];
    fs.unlinkSync(path.join(notes, 'a.bn'));
    await make({ stateFile }).collect!();
    expect(marks).toEqual([['bn.file', 'a.bn', true]]);
  });

  it('does not echo a remote-applied file back as a local change', async () => {
    const a = make();
    await a.collect!();
    a.codec.upsert({ path: 'r.bn', bn: { x: 1 }, mtime: '2026-01-01T00:00:00.000Z' }, undefined, ctx);
    await a.collect!();
    expect(marks).toEqual([]);
  });
});

describe('codec', () => {
  it('encodes a file as BnFileData and derives one natural key regardless of case and NFC', () => {
    const a = make();
    write('Notes/Café.bn', { title: 'x' });
    const d = a.codec.encode('Notes/Café.bn', ctx)!;
    expect(d).toMatchObject({ path: 'Notes/Café.bn', bn: { title: 'x' } });
    expect(typeof d['mtime']).toBe('string');
    const nfd = 'NOTES/CAFE\u0301.bn';
    const k1 = a.codec.naturalKey!({ path: 'Notes/Caf\u00e9.bn' });
    const k2 = a.codec.naturalKey!({ path: nfd });
    expect(k1).toEqual({ scope: 'bn.file', key: 'notes/caf\u00e9.bn' });
    expect(k2).toEqual(k1);
  });

  it('skips files over the record limit with a warning', () => {
    const a = make();
    write('big.bn', { blob: 'x'.repeat(1024 * 1024) });
    expect(a.codec.encode('big.bn', ctx)).toBeNull();
    expect(warns).toEqual([['big.bn', 'too-large']]);
    write('ok.bn', { blob: 'x'.repeat(1000) });
    expect(a.codec.encode('ok.bn', ctx)).not.toBeNull();
  });

  it('warns and returns null for invalid JSON', () => {
    const a = make();
    fs.writeFileSync(path.join(notes, 'bad.bn'), '{nope');
    expect(a.codec.encode('bad.bn', ctx)).toBeNull();
    expect(warns).toEqual([['bad.bn', 'invalid-json']]);
  });
});

describe('remote apply', () => {
  it('writes atomically: a crash between temp write and rename leaves the old file intact', () => {
    const a = make();
    write('a.bn', { v: 'old' });
    const real = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('crash'); });
    expect(() => a.codec.upsert({ path: 'a.bn', bn: { v: 'new' }, mtime: '2026-01-01T00:00:00Z' }, 'a.bn', ctx)).toThrow('crash');
    vi.mocked(fs.renameSync).mockImplementation(real);
    expect(JSON.parse(fs.readFileSync(path.join(notes, 'a.bn'), 'utf-8'))).toEqual({ v: 'old' });
    expect(fs.readdirSync(notes)).toEqual(['a.bn']);
  });

  it('writes new files into subfolders and keeps the existing on-disk spelling', () => {
    const a = make();
    write('Notes/Todo.bn', { v: 1 });
    const key = a.codec.upsert({ path: 'notes/todo.bn', bn: { v: 2 }, mtime: '2026-01-01T00:00:00Z' }, 'Notes/Todo.bn', ctx);
    expect(key).toBe('Notes/Todo.bn');
    expect(JSON.parse(fs.readFileSync(path.join(notes, 'Notes/Todo.bn'), 'utf-8'))).toEqual({ v: 2 });
    expect(a.codec.upsert({ path: 'x/y/z.bn', bn: { v: 3 }, mtime: '2026-01-01T00:00:00Z' }, undefined, ctx)).toBe('x/y/z.bn');
    expect(fs.existsSync(path.join(notes, 'x/y/z.bn'))).toBe(true);
  });

  it.each([
    '../evil.bn', 'a/../../evil.bn', '/etc/evil.bn', 'C:/evil.bn', 'C:\\evil.bn', '..\\evil.bn', 'a\0.bn',
    'noext', 'a.txt', '', 'a//b.bn', '.hidden.bn', 'a.bn.tmp',
  ])('rejects hostile path %j and writes nothing', (p) => {
    const a = make();
    expect(sanitizeBnPath(p)).toBeNull();
    expect(() => a.codec.decode({ path: p, bn: {}, mtime: 'x' }, ctx)).toThrow();
    expect(() => a.codec.upsert({ path: p, bn: {}, mtime: 'x' }, undefined, ctx)).toThrow();
    expect(() => a.codec.remove(p, ctx)).toThrow();
    expect(fs.readdirSync(tmp)).toEqual(['notes']);
    expect(fs.readdirSync(notes)).toEqual([]);
  });

  it('refuses to write through a symlinked folder that leaves notesDir', () => {
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(notes, 'link'));
    const a = make();
    expect(() => a.codec.upsert({ path: 'link/x.bn', bn: {}, mtime: 'x' }, undefined, ctx)).toThrow();
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('decode validates the record shape', () => {
    const a = make();
    expect(a.codec.decode({ path: 'a.bn', bn: { t: 1 }, mtime: 'm' }, ctx)).toEqual({ ok: true, row: { path: 'a.bn', bn: { t: 1 }, mtime: 'm' } });
    expect(() => a.codec.decode({ path: 'a.bn', bn: [1], mtime: 'm' }, ctx)).toThrow();
    expect(() => a.codec.decode({ path: 'a.bn', bn: {}, mtime: 5 }, ctx)).toThrow();
  });

  it('remove deletes the file but leaves .bak history, and tolerates a missing file', () => {
    const a = make();
    write('a.bn', {});
    fs.writeFileSync(path.join(notes, 'a.bn.bak'), 'history');
    a.codec.remove('a.bn', ctx);
    expect(fs.existsSync(path.join(notes, 'a.bn'))).toBe(false);
    expect(fs.readFileSync(path.join(notes, 'a.bn.bak'), 'utf-8')).toBe('history');
    expect(() => a.codec.remove('a.bn', ctx)).not.toThrow();
  });

  it('afterApply forwards only bn.file changes to the watcher callback', async () => {
    const seen: unknown[] = [];
    const a = make({ onFilesChanged: (c) => { seen.push(c); } });
    await a.afterApply!([{ kind: 'bn.file', localKey: 'a.bn', deleted: false }, { kind: 'user_note', localKey: '1', deleted: false }]);
    expect(seen).toEqual([[{ localKey: 'a.bn', deleted: false }]]);
  });
});

describe('conflict copy', () => {
  it('saves the loser next to the file with a dated name, never overwriting', async () => {
    const a = make();
    write('dir/n.bn', { v: 'winner' });
    const k1 = a.conflictCopy('dir/n.bn', { path: 'dir/n.bn', bn: { v: 'loser' }, mtime: 'm' });
    expect(k1).toBe('dir/n (conflicted copy 2026-10-09).bn');
    const k2 = a.conflictCopy('dir/n.bn', { bn: { v: 'loser2' } });
    expect(k2).toBe('dir/n (conflicted copy 2026-10-09 2).bn');
    expect(JSON.parse(fs.readFileSync(path.join(notes, k1), 'utf-8'))).toEqual({ v: 'loser' });
    expect(JSON.parse(fs.readFileSync(path.join(notes, 'dir/n.bn'), 'utf-8'))).toEqual({ v: 'winner' });
    expect(marks).toContainEqual(['bn.file', k1, false]);
    marks = [];
    await a.collect!();
    expect(marks.map((m) => m[1])).toContain(k1);
  });
});
