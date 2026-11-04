/** B-027: preset application re-seeds Bible panels from their live passage. */
import { describe, it, expect } from 'vitest';
import { freshenBibleSeeds, recenterBiblePanes } from './LayoutPresetService';
import { useBibleStore } from '../stores/useBibleStore';

describe('freshenBibleSeeds', () => {
  it('replaces a stale contentKey with the live passage', () => {
    useBibleStore.setState({
      panels: new Map([['p1', {
        currentBook: 45, currentChapter: 8, selectedVerseId: 45008028, activeTabIndex: 0, studyOptionsByTab: new Map(),
        openTabs: [{ abbreviation: 'KJV', displayMode: 'standard' }],
      } as never]]),
    });
    const snap = { panels: {
      p1: { params: { contentType: 'bible', contentKey: 'KJV|43|3||standard' } },
      p2: { params: { contentType: 'study', contentKey: 'x' } },
    } } as never;
    freshenBibleSeeds(snap);
    const panels = (snap as any).panels;
    expect(panels.p1.params.contentKey).toBe('KJV|45|8|45008028|standard');
    expect(panels.p2.params.contentKey).toBe('x');
  });
});

describe('recenterBiblePanes (B-027)', () => {
  it('bumps the scroll trigger and centers, for panes that have a selected verse only', () => {
    const base = { openTabs: [{ abbreviation: 'KJV', tabId: 't' }], studyOptionsByTab: new Map(), scrollTrigger: 4, scrollMode: 'nearest' };
    useBibleStore.setState({
      panels: new Map([
        ['with', { ...base, selectedVerseId: 45008028 } as never],
        ['without', { ...base, selectedVerseId: null } as never],
        ['empty', { ...base, selectedVerseId: 1, openTabs: [] } as never],
      ]),
    });
    recenterBiblePanes();
    const panels = useBibleStore.getState().panels as Map<string, any>;
    expect(panels.get('with')).toMatchObject({ scrollTrigger: 5, scrollMode: 'center' });
    expect(panels.get('without')).toMatchObject({ scrollTrigger: 4, scrollMode: 'nearest' });
    expect(panels.get('empty')).toMatchObject({ scrollTrigger: 4 });
  });
});
