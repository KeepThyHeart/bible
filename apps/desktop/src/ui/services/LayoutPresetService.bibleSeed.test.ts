/** B-027: preset application re-seeds Bible panels from their live passage. */
import { describe, it, expect } from 'vitest';
import { freshenBibleSeeds } from './LayoutPresetService';
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
