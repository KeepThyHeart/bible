/** B-010: with ELECTRON_USER_DATA set, the default notes dir lives under it. */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn((key: string) => (key === 'documents' ? '/home/real/Documents' : '/tmp')) },
  shell: {},
}));
vi.mock('electron-log', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { BibleNotesFileService } from '../BibleNotesFileService';

describe('BibleNotesFileService default dir', () => {
  const orig = process.env.ELECTRON_USER_DATA;
  afterEach(() => {
    if (orig === undefined) delete process.env.ELECTRON_USER_DATA;
    else process.env.ELECTRON_USER_DATA = orig;
  });

  it('uses Documents/BibleReader normally', () => {
    delete process.env.ELECTRON_USER_DATA;
    expect(new BibleNotesFileService().getNotesDir()).toBe(path.join('/home/real/Documents', 'BibleReader'));
  });

  it('uses <userData>/BibleReader when ELECTRON_USER_DATA is set', () => {
    process.env.ELECTRON_USER_DATA = '/tmp/profile-x';
    expect(new BibleNotesFileService().getNotesDir()).toBe(path.join('/tmp/profile-x', 'BibleReader'));
  });
});
