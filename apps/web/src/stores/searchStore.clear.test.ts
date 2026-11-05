/** 0209 W3: clear() bumps clearSeq; leaving Ideas ends the "unavailable" notice. */
import { describe, it, expect, beforeEach } from 'vitest';
import { searchStore } from './searchStore';

describe('searchStore (0209 W3)', () => {
  beforeEach(() => {
    searchStore.clear();
    searchStore.searchType = 'keyword';
    searchStore.semanticInit = { status: 'idle', stage: '', detail: '' };
  });

  it('clear() bumps clearSeq and empties the query', () => {
    searchStore.query = 'mercy';
    const before = searchStore.clearSeq;
    searchStore.clear();
    expect(searchStore.clearSeq).toBe(before + 1);
    expect(searchStore.query).toBe('');
  });

  it('switching to Ideas does not bump clearSeq (the box keeps its text)', () => {
    const before = searchStore.clearSeq;
    searchStore.setSearchType('semantic');
    expect(searchStore.clearSeq).toBe(before);
  });

  it('switching back to Standard dismisses the Ideas-unavailable error', () => {
    searchStore.setSearchType('semantic');
    searchStore.semanticInit = { status: 'error', stage: 'error', detail: 'x' };
    searchStore.setSearchType('keyword');
    expect(searchStore.semanticInit.status).toBe('idle');
  });
});
