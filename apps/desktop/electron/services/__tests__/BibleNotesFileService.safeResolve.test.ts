/**
 * Unit tests for `BibleNotesFileService.safeResolve` - the path traversal
 * guard. `safeResolve` is private, so these tests
 * exercise it indirectly via `ensureSubDir`, which calls it first (before
 * any fs access) and bubbles the thrown error up. A temp directory is used
 * so any successful resolutions touch a real but isolated location.
 *
 * Threats exercised:
 *  - `..` segments (traversal out of notes dir)
 *  - absolute paths
 *  - null bytes (filesystem injection)
 *  - over-length strings (DoS guard)
 *  - prefix-sibling attack (`notes-evil` vs `notes`)
 *  - non-string input
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Electron's `app.getPath` is unavailable in a plain vitest run; stub it
// before the module imports it.
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

import { BibleNotesFileService } from '../BibleNotesFileService';

describe('BibleNotesFileService.safeResolve (via ensureSubDir)', () => {
  let tmpDir: string;
  let svc: BibleNotesFileService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-safe-'));
    svc = new BibleNotesFileService(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('rejects path traversal', () => {
    it('rejects "../" escape', () => {
      expect(() => svc.ensureSubDir('../evil')).toThrow(/escapes notes directory/);
    });

    it('rejects deep "../../../" escape', () => {
      expect(() => svc.ensureSubDir('../../../etc/passwd')).toThrow(/escapes notes directory/);
    });

    it('rejects embedded "/../" after a legitimate prefix', () => {
      expect(() => svc.ensureSubDir('subdir/../../out')).toThrow(/escapes notes directory/);
    });

    it('rejects a prefix-sibling attack (notes-evil vs notes)', () => {
      // If base = /tmp/.../bn-safe-XYZ, path = "../bn-safe-XYZ-evil"
      // without the `+ sep` check, `startsWith(base)` would be true.
      const parent = path.dirname(tmpDir);
      const siblingName = path.basename(tmpDir) + '-evil';
      fs.mkdirSync(path.join(parent, siblingName), { recursive: true });
      try {
        expect(() => svc.ensureSubDir(`../${siblingName}`)).toThrow(
          /escapes notes directory/,
        );
      } finally {
        fs.rmSync(path.join(parent, siblingName), { recursive: true, force: true });
      }
    });
  });

  describe('rejects absolute paths', () => {
    it('rejects POSIX absolute path', () => {
      expect(() => svc.ensureSubDir('/etc/passwd')).toThrow(/absolute paths not allowed/);
    });

    it('rejects current tmp dir as an absolute path', () => {
      expect(() => svc.ensureSubDir(tmpDir)).toThrow(/absolute paths not allowed/);
    });
  });

  describe('rejects invalid character / type inputs', () => {
    it('rejects null byte in middle of string', () => {
      expect(() => svc.ensureSubDir('foo\0bar')).toThrow(/null byte/);
    });

    it('rejects null byte at end', () => {
      expect(() => svc.ensureSubDir('foo\0')).toThrow(/null byte/);
    });

    it('rejects over-length input (> 1000 chars)', () => {
      const longPath = 'a'.repeat(1001);
      expect(() => svc.ensureSubDir(longPath)).toThrow(/too long/);
    });

    it('rejects at exactly 1001 chars (guard boundary)', () => {
      // 1001 trips the guard. We don't assert "1000 is fine" because real
      // filesystems cap component length far below 1000 (ENAMETOOLONG);
      // the guard is a DoS-prevention upper bound, not a validation target.
      const justOver = 'a'.repeat(1001);
      expect(() => svc.ensureSubDir(justOver)).toThrow(/too long/);
    });

    it('rejects non-string input', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => svc.ensureSubDir(null as any)).toThrow(/must be a string/);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => svc.ensureSubDir(undefined as any)).toThrow(/must be a string/);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => svc.ensureSubDir(42 as any)).toThrow(/must be a string/);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => svc.ensureSubDir({} as any)).toThrow(/must be a string/);
    });
  });

  describe('accepts valid paths', () => {
    it('accepts empty string (notes dir itself)', () => {
      expect(() => svc.ensureSubDir('')).not.toThrow();
    });

    it('accepts a simple child', () => {
      expect(() => svc.ensureSubDir('sermons')).not.toThrow();
      expect(fs.existsSync(path.join(tmpDir, 'sermons'))).toBe(true);
    });

    it('accepts nested child', () => {
      expect(() => svc.ensureSubDir('sermons/2024')).not.toThrow();
      expect(fs.existsSync(path.join(tmpDir, 'sermons', '2024'))).toBe(true);
    });

    it('accepts a subdir with dots in the name (not traversal)', () => {
      expect(() => svc.ensureSubDir('v1.0.0')).not.toThrow();
    });

    it('accepts a path containing "." segment (no-op component)', () => {
      expect(() => svc.ensureSubDir('./sermons')).not.toThrow();
    });
  });
});
