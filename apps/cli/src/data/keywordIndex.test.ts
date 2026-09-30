import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { keywordIndexDirFor } from './keywordIndex';

describe('keywordIndexDirFor', () => {
  const own = (path: string, kind: 'repo' | 'cli' | 'override' | 'desktop-user' | 'desktop-bundled') => ({ path, root: { kind } });

  test('sits beside a `modules` folder the CLI or a checkout owns', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-kwi-'));
    try {
      mkdirSync(join(root, 'modules'));
      expect(keywordIndexDirFor(own(join(root, 'modules', 'bible_kjv.db'), 'repo'), {})).toBe(join(root, 'keyword-index'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('falls back to BIBLE_HOME when the module is not in a `modules` folder', () => {
    expect(keywordIndexDirFor(own('/elsewhere/bible_kjv.db', 'cli'), { BIBLE_HOME: '/home/x/.bible' })).toBe(
      join('/home/x/.bible', 'keyword-index'),
    );
  });

  test('never writes into the desktop app\'s folders, even when they sit in a `modules` folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-kwi-'));
    try {
      mkdirSync(join(root, 'modules'));
      for (const kind of ['desktop-user', 'desktop-bundled'] as const) {
        expect(keywordIndexDirFor(own(join(root, 'modules', 'bible_kjv.db'), kind), { BIBLE_HOME: '/h/.bible' })).toBe(
          join('/h/.bible', 'keyword-index'),
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
