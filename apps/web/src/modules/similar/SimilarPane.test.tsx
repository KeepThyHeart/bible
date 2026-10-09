import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
const hoisted = vi.hoisted(() => ({ navigateToPreview: vi.fn(), addTabWithPassage: vi.fn() }));
vi.mock('../../stores/bibleStore', async () => {
  const { Store } = await import('../../stores/Store');
  class Fake extends Store {
    getSelectedRange() { return { start: 43003016, end: 43003016 }; }
    getActiveModule() { return 'KJV'; }
    navigateToPreview = hoisted.navigateToPreview;
    addTabWithPassage = hoisted.addTabWithPassage;
  }
  return { bibleStore: new Fake() };
});
vi.mock('../../stores/studyStore', async () => {
  const { Store } = await import('../../stores/Store');
  class Fake extends Store { verseId = 43003016; crossRefModule = 'TSKxref'; }
  return { studyStore: new Fake() };
});
vi.mock('../../stores/moduleStore', () => ({
  moduleStore: { getBibleModules: () => [{ abbreviation: 'KJV', language_code: 'en' }] },
}));
vi.mock('../../utils/verseId', () => ({
  parseVerseId: (id: number) => ({ bookNumber: Math.floor(id / 1000000), chapter: Math.floor((id % 1000000) / 1000), verse: id % 1000 }),
}));
vi.mock('./webSimilarService', () => ({
  createWebSimilar: () => ({ service: { reset: () => {} } }),
  formatPassage: () => 'John 3:16',
}));

import { SimilarPane } from './SimilarPane';
import { similarStore } from './similarStore';

const providers = {} as never;
const row = (id: number) => ({
  key: `verse|${id}|${id}`, reference: 'Romans 5:8', text: 'But God commendeth', startVerseId: id, endVerseId: id,
  level: 'verse' as const, similarity: 0.9, isCrossReference: false, crossesTestament: false, via: 'table' as const,
});

describe('SimilarPane', () => {
  beforeEach(() => {
    similarStore.resetForTests();
    vi.spyOn(similarStore, 'follow').mockImplementation(() => {});
    hoisted.navigateToPreview.mockClear();
    hoisted.addTabWithPassage.mockClear();
  });

  it('shows the unavailable message', () => {
    similarStore.status = 'unavailable';
    render(<SimilarPane providers={providers} />);
    expect(screen.getByText('similar.unavailable')).toBeTruthy();
  });

  it('shows download progress', () => {
    similarStore.status = 'downloading';
    similarStore.progress = { loaded: 5, total: 10 };
    render(<SimilarPane providers={providers} />);
    expect(screen.getByRole('status').textContent).toContain('50%');
  });

  it('shows the empty and error states', () => {
    similarStore.status = 'empty';
    const { unmount } = render(<SimilarPane providers={providers} />);
    expect(screen.getByText('similar.empty')).toBeTruthy();
    unmount();
    similarStore.status = 'error';
    render(<SimilarPane providers={providers} />);
    expect(screen.getByText('similar.retry')).toBeTruthy();
  });

  it('renders rows; click navigates, ctrl-click opens a tab, More like this re-centres', async () => {
    similarStore.status = 'ready';
    similarStore.rows = [row(45005008)];
    similarStore.canShowMore = true;
    const moreLike = vi.spyOn(similarStore, 'moreLike').mockImplementation(() => {});
    const showMore = vi.spyOn(similarStore, 'showMore').mockImplementation(() => {});
    render(<SimilarPane providers={providers} />);
    const ref = screen.getByText('Romans 5:8');
    fireEvent.click(ref);
    expect(hoisted.navigateToPreview).toHaveBeenCalledWith(45, 5, 8);
    fireEvent.click(ref, { ctrlKey: true });
    expect(hoisted.addTabWithPassage).toHaveBeenCalledWith('KJV', 45, 5, 8);
    fireEvent.click(screen.getByText('similar.moreLikeThis'));
    expect(moreLike).toHaveBeenCalledWith({ startVerseId: 45005008, endVerseId: 45005008 });
    fireEvent.click(screen.getByText('similar.showMore'));
    expect(showMore).toHaveBeenCalled();
  });

  it('filter controls call the store', () => {
    similarStore.status = 'empty';
    const hide = vi.spyOn(similarStore, 'setHideKnown').mockImplementation(() => {});
    const tst = vi.spyOn(similarStore, 'setTestament').mockImplementation(() => {});
    render(<SimilarPane providers={providers} />);
    act(() => { fireEvent.click(screen.getByLabelText('similar.hideKnown')); });
    expect(hide).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('similar.testament.nt'));
    expect(tst).toHaveBeenCalledWith('nt');
  });

  it('offers the other-testament filter and a range-needs-live message', () => {
    similarStore.status = 'needsLive';
    render(<SimilarPane providers={providers} />);
    expect(screen.getByText('similar.testament.other')).toBeTruthy();
    expect(screen.getByText('similar.rangeNeedsLive')).toBeTruthy();
  });
});
