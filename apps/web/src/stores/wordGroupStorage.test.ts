import { describe, it, expect, beforeEach } from 'vitest';
import { listWordGroups, saveWordGroup, removeWordGroup, WORD_GROUPS_KEY } from './wordGroupStorage';

describe('wordGroupStorage', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    expect(listWordGroups()).toEqual([]);
  });

  it('saves, replaces by id and removes', () => {
    const a = saveWordGroup({ id: 'g1', label: 'Love', terms: ['love', 'lov*'] });
    expect(a.id).toBe('g1');
    saveWordGroup({ id: 'g2', label: 'Faith', terms: ['faith'] });
    saveWordGroup({ id: 'g1', label: 'Love 2', terms: ['love'] });
    expect(listWordGroups().map((g) => g.label)).toEqual(['Love 2', 'Faith']);
    removeWordGroup('g1');
    expect(listWordGroups().map((g) => g.id)).toEqual(['g2']);
  });

  it('assigns an id to a new group', () => {
    const g = saveWordGroup({ id: '', label: '', terms: ['grace'] });
    expect(g.id).toMatch(/^wg-/);
    expect(g.label).toBe('grace');
  });

  it('survives corrupt storage and drops invalid entries', () => {
    localStorage.setItem(WORD_GROUPS_KEY, '{not json');
    expect(listWordGroups()).toEqual([]);
    localStorage.setItem(WORD_GROUPS_KEY, JSON.stringify([null, { id: 'x' }, { id: 'ok', label: 'ok', terms: ['ok'] }, { id: 'e', terms: [] }]));
    expect(listWordGroups().map((g) => g.id)).toEqual(['ok']);
  });
});
