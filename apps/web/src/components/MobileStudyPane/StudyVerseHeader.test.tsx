/**
 * Component tests for StudyVerseHeader.
 *
 * Pattern: Component with i18n, local state, and complex conditional rendering.
 * react-i18next is mocked to return keys. bibleStore and useVerseText hook are
 * mocked to avoid network calls and store complexity.
 * Tests cover both the collapsed and expanded views, toggle behavior, and callbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// Mock the useVerseText hook to avoid bibleStore/API dependencies
vi.mock('../../hooks/useVerseText', () => ({
  useVerseText: vi.fn(() => ''),
}));

// Mock localStorage (used by loadExpandPref/saveExpandPref) — jsdom provides it
// but we want control over the initial state.

import { StudyVerseHeader } from './StudyVerseHeader';
import { useVerseText } from '../../hooks/useVerseText';

const mockUseVerseText = vi.mocked(useVerseText);

function defaultProps(overrides: Partial<Parameters<typeof StudyVerseHeader>[0]> = {}) {
  return {
    verseLabel: 'John 3:16',
    verseId: 43003016,
    pinned: false,
    onTogglePin: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onNavigateBible: vi.fn(),
    history: [],
    onHistorySelect: vi.fn(),
    ...overrides,
  };
}

describe('StudyVerseHeader', () => {
  beforeEach(() => {
    // Always start collapsed so tests are predictable regardless of localStorage
    localStorage.setItem('bible-reader-study-verse-expanded', 'false');
    mockUseVerseText.mockReturnValue('');
    vi.clearAllMocks();
  });

  // ── Collapsed view ──────────────────────────────────────────────────────

  describe('collapsed view', () => {
    it('renders the collapsed class when not expanded', () => {
      const { container } = render(<StudyVerseHeader {...defaultProps()} />);
      expect(container.querySelector('.study-verse-header--collapsed')).toBeTruthy();
    });

    it('shows the verse label in the reference button', () => {
      render(<StudyVerseHeader {...defaultProps()} />);
      expect(screen.getByText('John 3:16')).toBeTruthy();
    });

    it('shows "Select a verse" when verseLabel is empty', () => {
      render(<StudyVerseHeader {...defaultProps({ verseLabel: '' })} />);
      expect(screen.getByText('Select a verse')).toBeTruthy();
    });

    it('renders the expand button', () => {
      render(<StudyVerseHeader {...defaultProps()} />);
      expect(screen.getByText('studyVerseHeader.expand')).toBeTruthy();
    });

    it('applies pinned class when pinned=true', () => {
      const { container } = render(<StudyVerseHeader {...defaultProps({ pinned: true })} />);
      expect(container.querySelector('.study-verse-header--pinned')).toBeTruthy();
    });

    it('does not apply pinned class when pinned=false', () => {
      const { container } = render(<StudyVerseHeader {...defaultProps({ pinned: false })} />);
      expect(container.querySelector('.study-verse-header--pinned')).toBeNull();
    });

    it('calls onTogglePin when pin button clicked', () => {
      const onTogglePin = vi.fn();
      const { container } = render(<StudyVerseHeader {...defaultProps({ onTogglePin })} />);
      const pinBtn = container.querySelector('.study-verse-header__pin')!;
      fireEvent.click(pinBtn);
      expect(onTogglePin).toHaveBeenCalledTimes(1);
    });

    it('calls onNavigateBible when reference button clicked', () => {
      const onNavigateBible = vi.fn();
      const { container } = render(<StudyVerseHeader {...defaultProps({ onNavigateBible })} />);
      const refBtn = container.querySelector('.study-verse-header__ref')!;
      fireEvent.click(refBtn);
      expect(onNavigateBible).toHaveBeenCalledTimes(1);
    });

    it('expands when the expand button is clicked', () => {
      const { container } = render(<StudyVerseHeader {...defaultProps()} />);
      const expandBtn = screen.getByText('studyVerseHeader.expand');
      fireEvent.click(expandBtn);
      // No longer collapsed
      expect(container.querySelector('.study-verse-header--collapsed')).toBeNull();
    });
  });

  // ── Expanded view ───────────────────────────────────────────────────────

  describe('expanded view', () => {
    beforeEach(() => {
      localStorage.setItem('bible-reader-study-verse-expanded', 'true');
    });

    it('renders the expanded view when localStorage says expanded', () => {
      const { container } = render(<StudyVerseHeader {...defaultProps()} />);
      // Expanded view does not have the collapsed modifier
      expect(container.querySelector('.study-verse-header--collapsed')).toBeNull();
    });

    it('shows collapse button in expanded view', () => {
      render(<StudyVerseHeader {...defaultProps()} />);
      expect(screen.getByText('studyVerseHeader.collapse')).toBeTruthy();
    });

    it('collapses when the collapse button is clicked', () => {
      const { container } = render(<StudyVerseHeader {...defaultProps()} />);
      fireEvent.click(screen.getByText('studyVerseHeader.collapse'));
      expect(container.querySelector('.study-verse-header--collapsed')).toBeTruthy();
    });

    it('renders prev and next navigation buttons', () => {
      const { container } = render(<StudyVerseHeader {...defaultProps()} />);
      const navBtns = container.querySelectorAll('.study-verse-header__nav');
      expect(navBtns.length).toBe(2);
    });

    it('calls onPrev when prev button clicked', () => {
      const onPrev = vi.fn();
      const { container } = render(<StudyVerseHeader {...defaultProps({ onPrev })} />);
      const prevBtn = container.querySelector('.fa-chevron-left')!.closest('button')!;
      fireEvent.click(prevBtn);
      expect(onPrev).toHaveBeenCalledTimes(1);
    });

    it('calls onNext when next button clicked', () => {
      const onNext = vi.fn();
      const { container } = render(<StudyVerseHeader {...defaultProps({ onNext })} />);
      const nextBtn = container.querySelector('.fa-chevron-right')!.closest('button')!;
      fireEvent.click(nextBtn);
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('renders verse text when useVerseText returns a value', () => {
      mockUseVerseText.mockReturnValue('For God so loved the world...');
      render(<StudyVerseHeader {...defaultProps()} />);
      expect(screen.getByText(/For God so loved/)).toBeTruthy();
    });

    it('does not render verse text block when useVerseText returns empty string', () => {
      mockUseVerseText.mockReturnValue('');
      const { container } = render(<StudyVerseHeader {...defaultProps()} />);
      expect(container.querySelector('.study-verse-header__text')).toBeNull();
    });

    it('applies pinned class when pinned=true', () => {
      const { container } = render(<StudyVerseHeader {...defaultProps({ pinned: true })} />);
      expect(container.querySelector('.study-verse-header--pinned')).toBeTruthy();
    });

    it('shows history dropdown when history button clicked', () => {
      const { container } = render(<StudyVerseHeader {...defaultProps()} />);
      const histBtn = container.querySelector('.study-verse-header__history-btn')!;
      fireEvent.click(histBtn);
      expect(container.querySelector('.verse-history')).toBeTruthy();
    });

    it('closes history dropdown when clicked again', () => {
      const { container } = render(<StudyVerseHeader {...defaultProps()} />);
      const histBtn = container.querySelector('.study-verse-header__history-btn')!;
      fireEvent.click(histBtn); // open
      fireEvent.click(histBtn); // close
      expect(container.querySelector('.verse-history')).toBeNull();
    });

    it('calls onHistorySelect when a history item is selected', () => {
      const onHistorySelect = vi.fn();
      const history = [
        { verseId: 43003016, timestamp: Date.now() - 60000 },
      ];
      const { container } = render(
        <StudyVerseHeader {...defaultProps({ history, onHistorySelect })} />,
      );
      // Open history
      fireEvent.click(container.querySelector('.study-verse-header__history-btn')!);
      // Click the first item
      const item = container.querySelector('.verse-history__item')!;
      fireEvent.click(item);
      expect(onHistorySelect).toHaveBeenCalledWith(43003016);
    });
  });
});
