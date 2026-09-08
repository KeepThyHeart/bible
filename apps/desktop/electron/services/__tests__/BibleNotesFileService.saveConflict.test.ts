/**
 * Unit tests for the save-conflict false positive fixed in this phase.
 *
 * Root cause: `saveNote`/`saveNoteAbsolute` regenerate `note.updated`
 * themselves (the caller-supplied value is not trusted) and write that to
 * disk - but until this fix, that real written value was discarded (the
 * methods returned `void`), so callers had no way to learn the true
 * on-disk timestamp and had to guess with their own `new Date().toISOString()`.
 * That guess never exactly matched what got written, so the *next* save's
 * `expectedUpdated` always mismatched the disk, and `assertNoConflict` threw
 * `NoteConflictError` even with only one window ever touching the file.
 *
 * This suite proves, against the real filesystem (a temp dir, no fs mocking -
 * matches the pattern in BibleNotesFileService.safeResolve.test.ts):
 *   (i)  Two (and a third, chained) consecutive saves that feed the value
 *        *returned* by the previous save back in as `expectedUpdated` all
 *        succeed - the false positive is gone.
 *   (ii) A save whose `expectedUpdated` does NOT match a genuine external
 *        modification of the on-disk file still throws NoteConflictError -
 *        the real-conflict path was not disabled by the fix.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((_key: string) => os.tmpdir()),
  },
  shell: {
    trashItem: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(''),
    showItemInFolder: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { BibleNotesFileService, NoteConflictError, BnFile } from '../BibleNotesFileService';

function makeNote(overrides: Partial<BnFile> = {}): BnFile {
  const now = new Date().toISOString();
  return {
    bn: 1,
    type: 'document',
    title: 'Sermon Outline',
    tags: [],
    passages: [],
    created: now,
    updated: now,
    content: { type: 'doc', content: [] },
    metadata: {},
    ...overrides,
  };
}

describe('BibleNotesFileService — save-conflict false positive', () => {
  let tmpDir: string;
  let svc: BibleNotesFileService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-conflict-'));
    svc = new BibleNotesFileService(tmpDir);
    // Consecutive `saveNote` calls in a synchronous test can land in the same
    // millisecond, which would make two distinct writes produce the SAME
    // `updated` ISO string - masking a real bug (the guard compares by
    // equality) as a passing test. Fake timers + manual ticks guarantee each
    // save gets a distinct, deterministic timestamp.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  /** Advance the fake clock so the next `saveNote` gets a distinct timestamp. */
  function tick(ms = 1000): void {
    vi.setSystemTime(new Date(Date.now() + ms));
  }

  it('returns the real written `updated` timestamp from saveNote', () => {
    const note = makeNote();
    const returned = svc.saveNote('outline', note, undefined);
    expect(typeof returned).toBe('string');
    // The service mutates `note.updated` in place to the same value it returns.
    expect(returned).toBe(note.updated);

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'outline.bn'), 'utf-8')
    ) as BnFile;
    expect(onDisk.updated).toBe(returned);
  });

  it('three consecutive saves, each using the previous save\'s returned timestamp as the baseline, all succeed (rapid Ctrl+S never false-conflicts)', () => {
    const note = makeNote();

    // Save #1: brand-new file, no baseline to check yet.
    const updated1 = svc.saveNote('outline', note, undefined);

    // Save #2: baseline = what save #1 actually wrote (post-fix renderer
    // behavior). This is the exact "press Ctrl+S again" case that was
    // spuriously throwing NoteConflictError before the fix.
    tick();
    note.content = { type: 'doc', content: [{ type: 'paragraph' }] };
    const updated2 = svc.saveNote('outline', note, updated1);
    expect(updated2).not.toBe(updated1);

    // The now-stale save #1 baseline is correctly rejected against the disk
    // state save #2 left behind - proves the fix didn't disable the guard.
    expect(() => svc.saveNote('outline', { ...note }, updated1)).toThrow(NoteConflictError);

    // Save #3: baseline = what save #2 wrote. Proves the chain keeps working
    // indefinitely, not just once.
    tick();
    note.content = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] };
    expect(() => svc.saveNote('outline', note, updated2)).not.toThrow();
  });

  it('a genuine external modification of the file on disk still throws NoteConflictError', () => {
    const note = makeNote();
    const baseline = svc.saveNote('outline', note, undefined);

    // Simulate another window/process (or an external editor) modifying the
    // file directly, independent of this service instance.
    const filePath = path.join(tmpDir, 'outline.bn');
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BnFile;
    onDisk.content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'external edit' }] }],
    };
    onDisk.updated = new Date(Date.now() + 60_000).toISOString(); // clearly different
    fs.writeFileSync(filePath, JSON.stringify(onDisk), 'utf-8');

    // Our in-memory `note` still carries the original baseline - saving now
    // must be refused, not silently allowed through by the fix.
    note.content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'local edit' }] }],
    };
    expect(() => svc.saveNote('outline', note, baseline)).toThrow(NoteConflictError);

    try {
      svc.saveNote('outline', note, baseline);
      throw new Error('expected saveNote to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NoteConflictError);
      const conflictErr = err as NoteConflictError;
      expect(conflictErr.expectedUpdated).toBe(baseline);
      expect(conflictErr.diskUpdated).toBe(onDisk.updated);
    }
  });

  it('saveNoteAbsolute exhibits the same fixed and still-guarded behavior', () => {
    const filePath = path.join(tmpDir, 'abs-note.bn');
    const note = makeNote({ title: 'Absolute Path Note' });

    const firstUpdated = svc.saveNoteAbsolute(filePath, note, undefined);
    note.content = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(() => svc.saveNoteAbsolute(filePath, note, firstUpdated)).not.toThrow();

    // Genuine external change still trips the guard.
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BnFile;
    onDisk.updated = new Date(Date.now() + 60_000).toISOString();
    fs.writeFileSync(filePath, JSON.stringify(onDisk), 'utf-8');
    expect(() => svc.saveNoteAbsolute(filePath, note, note.updated)).toThrow(NoteConflictError);
  });
});
