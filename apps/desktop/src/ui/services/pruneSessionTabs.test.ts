import { describe, it, expect } from 'vitest';
import { pruneSessionTabs } from './pruneSessionTabs';

const tab = (abbreviation: string) => ({ abbreviation, name: abbreviation });

describe('pruneSessionTabs', () => {
  it('returns the session untouched when every tab is installed', () => {
    const session = { openTabs: [tab('Barnes'), tab('Gill')], activeTabIndex: 1 };
    expect(pruneSessionTabs(session, new Set(['Barnes', 'Gill']))).toBe(session);
  });

  it('keeps every tab when the installed list is unknown', () => {
    const session = { openTabs: [tab('Finney')], activeTabIndex: 0 };
    expect(pruneSessionTabs(session, null)).toBe(session);
  });

  it('passes through a missing or empty session', () => {
    expect(pruneSessionTabs(undefined, new Set())).toBeUndefined();
    const empty = { openTabs: [] };
    expect(pruneSessionTabs(empty, new Set())).toBe(empty);
  });

  it('drops tabs for modules that are not installed', () => {
    const result = pruneSessionTabs({ openTabs: [tab('Barnes'), tab('Finney')], activeTabIndex: 0 }, new Set(['Barnes']));
    expect(result?.openTabs).toEqual([tab('Barnes')]);
    expect(result?.activeTabIndex).toBe(0);
  });

  it('leaves no tabs when none of them is installed (a fresh install)', () => {
    const result = pruneSessionTabs({ openTabs: [tab('Finney')], activeTabIndex: 0 }, new Set());
    expect(result?.openTabs).toEqual([]);
    expect(result?.activeTabIndex).toBe(0);
  });

  it('follows the active tab to its new index when earlier tabs are dropped', () => {
    const result = pruneSessionTabs(
      { openTabs: [tab('Gone'), tab('Barnes'), tab('Gill')], activeTabIndex: 2 },
      new Set(['Barnes', 'Gill']),
    );
    expect(result?.openTabs.map(t => t.abbreviation)).toEqual(['Barnes', 'Gill']);
    expect(result?.activeTabIndex).toBe(1);
  });

  it('moves to the nearest surviving tab when the active one is dropped', () => {
    const result = pruneSessionTabs(
      { openTabs: [tab('Barnes'), tab('Gone'), tab('Gill')], activeTabIndex: 1 },
      new Set(['Barnes', 'Gill']),
    );
    expect(result?.openTabs.map(t => t.abbreviation)).toEqual(['Barnes', 'Gill']);
    expect(result?.activeTabIndex).toBe(0);
  });

  it('forgets per-tab state for dropped modules', () => {
    const result = pruneSessionTabs(
      {
        openTabs: [tab('Barnes'), tab('Finney')],
        activeTabIndex: 0,
        currentSectionByTab: { Barnes: 1, Finney: 7 },
        currentEntryByTab: { Finney: 'x' },
      },
      new Set(['Barnes']),
    );
    expect(result?.currentSectionByTab).toEqual({ Barnes: 1 });
    expect(result?.currentEntryByTab).toEqual({});
  });

  it('prunes only the strip entries of its own type', () => {
    const result = pruneSessionTabs(
      {
        openTabs: [tab('Finney')],
        activeTabIndex: 0,
        tabOrder: [
          { type: 'book', abbreviation: 'Finney' },
          { type: 'dictionary', abbreviation: 'Finney' },
        ],
      },
      new Set(),
      'book',
    );
    expect(result?.tabOrder).toEqual([{ type: 'dictionary', abbreviation: 'Finney' }]);
  });
});
