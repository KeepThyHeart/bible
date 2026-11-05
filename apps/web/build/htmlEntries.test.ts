import { describe, expect, it } from 'vitest';
import { matchesGlob } from 'node:path';
import { HTML_ENTRIES, MODULE_PAGE_GLOBS } from './htmlEntries';

describe('precache globs (W-030)', () => {
  it('keeps every HTML entry except the app shell out of the precache', () => {
    for (const file of Object.values(HTML_ENTRIES)) {
      const ignored = MODULE_PAGE_GLOBS.some((g) => matchesGlob(file, g));
      expect({ file, ignored }).toEqual({ file, ignored: file !== 'index.html' });
    }
  });
});
