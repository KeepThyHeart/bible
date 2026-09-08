import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { enT } from '../testing/enCatalog';

// The tab bar resolves its default aria-label and add-button title itself;
// mocking the hook keeps the test free of a ContextProvider.
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    locale: 'en' as const,
    i18n: {},
  }),
}));
import DraggableTabBar, {
  END_DROP_ZONE_SUFFIX,
  resolveReorderTarget,
  type TabItem,
} from './DraggableTabBar';

/**
 * REGRESSION: there was no way to drop a tab *after* the last one.
 *
 * Only the tabs themselves were droppables, and the destination index was
 * always "the index of the tab you dropped on", so the furthest right a tab
 * could land was the last position minus one - and a drop on the empty part of
 * the strip did nothing at all, because nothing there was a drop target.
 *
 * The index arithmetic is tested through the exported pure resolver rather than
 * by driving @dnd-kit: its collision detection measures element rectangles,
 * and jsdom reports every rectangle as 0x0, so a simulated drag can only ever
 * assert that the library was called - never where the tab would actually go.
 */

const TABS: TabItem[] = [
  { id: 'kjv', label: 'KJV' },
  { id: 'esv', label: 'ESV' },
  { id: 'niv', label: 'NIV' },
];

const IDS = TABS.map(t => t.id);
const END_ID = `commentary-tabs${END_DROP_ZONE_SUFFIX}`;

describe('DraggableTabBar drop-at-end target', () => {
  it('maps a drop on the strip background to the end of the list', () => {
    // `2` (= length - 1), not `3`. Both reorder sinks apply the move as
    // remove-then-insert and reject a destination >= openTabs.length, so
    // length - 1 is the index that puts the tab last. See resolveReorderTarget.
    expect(resolveReorderTarget(IDS, 'kjv', END_ID, END_ID)).toEqual({ from: 0, to: 2 });
    expect(resolveReorderTarget(IDS, 'esv', END_ID, END_ID)).toEqual({ from: 1, to: 2 });
  });

  it('leaves a drop on a tab meaning that tab position', () => {
    expect(resolveReorderTarget(IDS, 'niv', 'kjv', END_ID)).toEqual({ from: 2, to: 0 });
  });

  it('is a no-op when the tab is already last, or the ids are unknown', () => {
    expect(resolveReorderTarget(IDS, 'niv', END_ID, END_ID)).toBeNull();
    expect(resolveReorderTarget(IDS, 'gone', END_ID, END_ID)).toBeNull();
    expect(resolveReorderTarget(IDS, 'kjv', 'gone', END_ID)).toBeNull();
  });

  it('renders the strip background as a real drop target', () => {
    render(
      <DraggableTabBar
        tabs={TABS}
        activeTabIndex={0}
        droppableId="commentary-tabs"
        onTabClick={vi.fn()}
        onTabClose={vi.fn()}
        onReorder={vi.fn()}
        onAddClick={vi.fn()}
      />,
    );
    // Present, and scoped to this bar's droppableId so two tab strips on screen
    // never share one drop target.
    expect(screen.getByTestId(`tab-strip-drop-zone-${END_ID}`)).toBeInTheDocument();
  });
});
