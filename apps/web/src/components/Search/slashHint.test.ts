import { describe, it, expect } from 'vitest';
import { isSlashCommandQuery } from './SearchResultsPanel';

describe('isSlashCommandQuery', () => {
  it('detects slash commands', () => {
    for (const q of ['/note', '/plan', ' /prayer now', '/note-x']) expect(isSlashCommandQuery(q)).toBe(true);
  });
  it('ignores ordinary queries', () => {
    for (const q of ['love', 'John 3:16', 'and/or', '/', '']) expect(isSlashCommandQuery(q)).toBe(false);
  });
});
