import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { keywordIndexDirFor } from './keywordIndex';

describe('keywordIndexDirFor', () => {
  test('sits beside a `modules` folder, the layout the desktop and web apps use', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-kwi-'));
    try {
      mkdirSync(join(root, 'modules'));
      expect(keywordIndexDirFor(join(root, 'modules', 'bible_kjv.db'), {})).toBe(join(root, 'keyword-index'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('falls back to BIBLE_HOME when the module is not in a `modules` folder', () => {
    expect(keywordIndexDirFor('/elsewhere/bible_kjv.db', { BIBLE_HOME: '/home/x/.bible' })).toBe(
      join('/home/x/.bible', 'keyword-index'),
    );
  });
});
