/**
 * Component tests for VerseHistory.
 *
 * Pattern: Presentational component with i18n, outside-click handling, and
 * relative timestamps. react-i18next is mocked to return keys. The constants
 * module is mocked so formatPassageRef returns a predictable string without
 * requiring i18n/locale data.  Date.now is frozen via vi.setSystemTime() so
 * relative-time formatting is deterministic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.count !== undefined) return `${key}:${opts.count}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

// Mock constants so formatPassageRef returns a simple deterministic string
// without needing i18n book names.
vi.mock('../../constants', () => ({
  formatPassageRef: (book: number, chapter: number, verse?: number) =>
    verse != null ? `Book${book} ${chapter}:${verse}` : `Book${book} ${chapter}`,
  isSingleChapterBook: () => false,
}));

// Mock getLocalizedBookName used inside formatVerseRange / parseVerseId chain
vi.mock('../../utils/bookNames', () => ({
  getLocalizedBookName: (bookNumber: number) => `Book${bookNumber}`,
}));

import { VerseHistory } from './VerseHistory';

const NOW = 1_700_000_000_000; // fixed timestamp for all tests

describe('VerseHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Empty state ──────────────────────────────────────────────────────────

  it('renders empty state when history is empty', () => {
    const { container } = render(
      <VerseHistory history={[]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector('.verse-history__empty')).toBeTruthy();
    expect(screen.getByText('verseHistory.noHistory')).toBeTruthy();
  });

  it('does not render the title or items when history is empty', () => {
    const { container } = render(
      <VerseHistory history={[]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector('.verse-history__title')).toBeNull();
    expect(container.querySelector('.verse-history__item')).toBeNull();
  });

  // ── With history items ───────────────────────────────────────────────────

  it('renders the title when there are history items', () => {
    const history = [{ verseId: 43003016, timestamp: NOW - 60000 }];
    render(<VerseHistory history={history} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('verseHistory.recentVerses')).toBeTruthy();
  });

  it('renders one button per history entry', () => {
    const history = [
      { verseId: 43003016, timestamp: NOW - 60000 },
      { verseId: 1001001, timestamp: NOW - 120000 },
    ];
    const { container } = render(
      <VerseHistory history={history} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const items = container.querySelectorAll('.verse-history__item');
    expect(items.length).toBe(2);
  });

  it('calls onSelect with the correct verseId when an item is clicked', () => {
    const onSelect = vi.fn();
    const history = [
      { verseId: 43003016, timestamp: NOW - 60000 },
      { verseId: 1001001, timestamp: NOW - 120000 },
    ];
    const { container } = render(
      <VerseHistory history={history} onSelect={onSelect} onClose={vi.fn()} />,
    );
    const items = container.querySelectorAll('.verse-history__item');
    fireEvent.click(items[1]);
    expect(onSelect).toHaveBeenCalledWith(1001001);
  });

  // ── Relative time formatting ─────────────────────────────────────────────

  it('shows "justNow" for timestamps less than 1 minute ago', () => {
    const history = [{ verseId: 43003016, timestamp: NOW - 30000 }]; // 30 s ago
    const { container } = render(
      <VerseHistory history={history} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const timeEl = container.querySelector('.verse-history__time');
    expect(timeEl?.textContent).toBe('verseHistory.justNow');
  });

  it('shows minutesAgo for timestamps 1-59 minutes ago', () => {
    const history = [{ verseId: 43003016, timestamp: NOW - 5 * 60000 }]; // 5 min ago
    const { container } = render(
      <VerseHistory history={history} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const timeEl = container.querySelector('.verse-history__time');
    expect(timeEl?.textContent).toBe('verseHistory.minutesAgo:5');
  });

  it('shows hoursAgo for timestamps 1-23 hours ago', () => {
    const history = [{ verseId: 43003016, timestamp: NOW - 3 * 60 * 60000 }]; // 3 h ago
    const { container } = render(
      <VerseHistory history={history} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const timeEl = container.querySelector('.verse-history__time');
    expect(timeEl?.textContent).toBe('verseHistory.hoursAgo:3');
  });

  it('shows daysAgo for timestamps 24+ hours ago', () => {
    const history = [{ verseId: 43003016, timestamp: NOW - 2 * 24 * 60 * 60000 }]; // 2 d ago
    const { container } = render(
      <VerseHistory history={history} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const timeEl = container.querySelector('.verse-history__time');
    expect(timeEl?.textContent).toBe('verseHistory.daysAgo:2');
  });

  // ── Outside-click handling ───────────────────────────────────────────────

  it('calls onClose when mousedown fires outside the component', () => {
    const onClose = vi.fn();
    const history = [{ verseId: 43003016, timestamp: NOW - 60000 }];
    render(<VerseHistory history={history} onSelect={vi.fn()} onClose={onClose} />);

    // Simulate a click on the document body (outside the component)
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when mousedown fires inside the component', () => {
    const onClose = vi.fn();
    const history = [{ verseId: 43003016, timestamp: NOW - 60000 }];
    const { container } = render(
      <VerseHistory history={history} onSelect={vi.fn()} onClose={onClose} />,
    );

    const inner = container.querySelector('.verse-history')!;
    fireEvent.mouseDown(inner);
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── CSS class structure ──────────────────────────────────────────────────

  it('renders the verse-history root class', () => {
    const { container } = render(
      <VerseHistory history={[]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.querySelector('.verse-history')).toBeTruthy();
  });

  it('renders ref and time spans inside each history item', () => {
    const history = [{ verseId: 43003016, timestamp: NOW - 60000 }];
    const { container } = render(
      <VerseHistory history={history} onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const item = container.querySelector('.verse-history__item')!;
    expect(item.querySelector('.verse-history__ref')).toBeTruthy();
    expect(item.querySelector('.verse-history__time')).toBeTruthy();
  });
});
