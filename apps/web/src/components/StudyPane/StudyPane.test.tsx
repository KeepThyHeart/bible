/**
 * Component tests for StudyPane.
 *
 * Pattern: Composite store-connected component that orchestrates child
 * study sections. All child components and external stores are mocked.
 * Tests cover: title/passage label rendering, pin/unpin button behavior,
 * pinned-mismatch banner, preview-available banner, and sync button callbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { ns?: string }) => {
      // Return book number as fake book name for books namespace
      if (opts?.ns === 'books') return `Book${key}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

// ---- Child components (render as simple stubs) ---------------------------
vi.mock('./StudySection', () => ({
  StudySection: ({ children, label }: { children: unknown; label: string }) => (
    <div class="study-section-stub" data-label={label}>{children as any}</div>
  ),
}));

vi.mock('./StudyCrossRefs', () => ({
  StudyCrossRefs: () => <div class="study-crossrefs-stub" />,
}));

vi.mock('./StudyTopics', () => ({
  StudyTopics: ({ onTopicClick }: { onTopicClick?: (...a: unknown[]) => void }) => (
    <div class="study-topics-stub" onClick={() => onTopicClick?.(1, 'nave', 'Love')} />
  ),
}));

vi.mock('./StudySynthesis', () => ({
  StudySynthesis: () => <div class="study-synthesis-stub" />,
}));

vi.mock('./StudyHome', () => ({
  StudyHome: () => <div class="study-home-stub" />,
}));

// ---- parseVerseId mock ---------------------------------------------------
vi.mock('../../utils/verseId', () => ({
  parseVerseId: (id: number) => ({
    bookNumber: Math.floor(id / 1000000),
    chapter: Math.floor((id % 1000000) / 1000),
    verse: id % 1000,
  }),
}));

// ---- getSyncStatus mock --------------------------------------------------
import type { SyncStatusInfo } from '../../utils/syncStatus';

let mockSyncStatus: SyncStatusInfo = {
  status: 'synced',
  currentLabel: '',
  syncLabel: '',
  syncVerseId: null,
};

vi.mock('../../utils/syncStatus', () => ({
  getSyncStatus: () => mockSyncStatus,
}));

// ---- Store state ---------------------------------------------------------
let mockVerseId: number | null = 43003016;
let mockBook: number | null = 43;
let mockChapter: number | null = 3;
let mockVerse: number | null = 16;
let mockPinned = false;
let mockPinnedBook: number | null = null;
let mockPinnedChapter: number | null = null;
let mockPinnedVerse: number | null = null;

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

const mockStudyStoreUnpin = vi.fn();
const mockStudyStorePin = vi.fn();
const mockStudyStoreLoadForVerse = vi.fn();

vi.mock('../../stores/studyStore', () => ({
  studyStore: {
    get verseId() { return mockVerseId; },
    get book() { return mockBook; },
    get chapter() { return mockChapter; },
    get verse() { return mockVerse; },
    get pinned() { return mockPinned; },
    get pinnedBook() { return mockPinnedBook; },
    get pinnedChapter() { return mockPinnedChapter; },
    get pinnedVerse() { return mockPinnedVerse; },
    unpin: () => mockStudyStoreUnpin(),
    pin: () => mockStudyStorePin(),
    loadForVerse: (...args: unknown[]) => mockStudyStoreLoadForVerse(...args),
  },
}));

const mockBibleStoreAdoptPreviewAsStudy = vi.fn();

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({ moduleAbbr: 'KJV', studyVerse: null, previewVerse: null }),
    adoptPreviewAsStudy: (id: number) => mockBibleStoreAdoptPreviewAsStudy(id),
  },
}));

const mockCommentaryStoreNavigateToTopic = vi.fn();
const mockCommentaryStoreLoadForChapter = vi.fn();

vi.mock('../../stores/commentaryStore', () => ({
  commentaryStore: {
    navigateToTopic: (...args: unknown[]) => mockCommentaryStoreNavigateToTopic(...args),
    loadForChapter: (...args: unknown[]) => mockCommentaryStoreLoadForChapter(...args),
  },
}));

import { StudyPane } from './StudyPane';

describe('StudyPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerseId = 43003016;
    mockBook = 43;
    mockChapter = 3;
    mockVerse = 16;
    mockPinned = false;
    mockPinnedBook = null;
    mockPinnedChapter = null;
    mockPinnedVerse = null;
    mockSyncStatus = { status: 'synced', currentLabel: '', syncLabel: '', syncVerseId: null };
  });

  // ------------------------------------------------------------------
  // Basic structure
  // ------------------------------------------------------------------
  it('renders the study pane container', () => {
    const { container } = render(<StudyPane />);
    expect(container.querySelector('.study-pane')).toBeTruthy();
  });

  it('renders the study pane title', () => {
    render(<StudyPane />);
    expect(screen.getByText('studyPane.study')).toBeTruthy();
  });

  it('renders all four child section stubs', () => {
    const { container } = render(<StudyPane />);
    expect(container.querySelector('.study-crossrefs-stub')).toBeTruthy();
    expect(container.querySelector('.study-topics-stub')).toBeTruthy();
    expect(container.querySelector('.study-synthesis-stub')).toBeTruthy();
    expect(container.querySelector('.study-home-stub')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Passage label rendering
  // ------------------------------------------------------------------
  it('renders passage label when book and chapter are set', () => {
    const { container } = render(<StudyPane />);
    const passageEl = container.querySelector('.study-pane__passage');
    expect(passageEl).toBeTruthy();
    // Book43 3:16 (from mocked t() function)
    expect(passageEl?.textContent).toContain('Book43');
    expect(passageEl?.textContent).toContain('3');
    expect(passageEl?.textContent).toContain('16');
  });

  it('renders passage label without verse when verse is null', () => {
    mockVerse = null;
    const { container } = render(<StudyPane />);
    const passageEl = container.querySelector('.study-pane__passage');
    expect(passageEl?.textContent).toContain('Book43');
    expect(passageEl?.textContent).toContain('3');
    expect(passageEl?.textContent).not.toContain(':');
  });

  it('does not render passage label when book is null', () => {
    mockBook = null;
    mockChapter = null;
    const { container } = render(<StudyPane />);
    expect(container.querySelector('.study-pane__passage')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Pin button
  // ------------------------------------------------------------------
  it('renders the pin button', () => {
    const { container } = render(<StudyPane />);
    expect(container.querySelector('.study-pane__pin')).toBeTruthy();
  });

  it('pin button has active class when pinned', () => {
    mockPinned = true;
    mockPinnedBook = 43;
    mockPinnedChapter = 3;
    mockPinnedVerse = 16;
    const { container } = render(<StudyPane />);
    expect(container.querySelector('.study-pane__pin--active')).toBeTruthy();
  });

  it('pin button does not have active class when not pinned', () => {
    mockPinned = false;
    const { container } = render(<StudyPane />);
    expect(container.querySelector('.study-pane__pin--active')).toBeNull();
  });

  it('calls studyStore.pin when pin button is clicked while unpinned', () => {
    mockPinned = false;
    const { container } = render(<StudyPane />);
    fireEvent.click(container.querySelector('.study-pane__pin')!);
    expect(mockStudyStorePin).toHaveBeenCalled();
  });

  it('calls studyStore.unpin when pin button is clicked while pinned', () => {
    mockPinned = true;
    mockPinnedBook = 43;
    mockPinnedChapter = 3;
    const { container } = render(<StudyPane />);
    fireEvent.click(container.querySelector('.study-pane__pin')!);
    expect(mockStudyStoreUnpin).toHaveBeenCalled();
  });

  it('shows pin title when unpinned', () => {
    mockPinned = false;
    const { container } = render(<StudyPane />);
    const btn = container.querySelector('.study-pane__pin')!;
    expect(btn.getAttribute('title')).toBe('studyPane.pinVerse');
  });

  it('shows unpin title when pinned', () => {
    mockPinned = true;
    const { container } = render(<StudyPane />);
    const btn = container.querySelector('.study-pane__pin')!;
    expect(btn.getAttribute('title')).toBe('studyPane.unpinVerse');
  });

  // ------------------------------------------------------------------
  // Pinned-mismatch banner
  // ------------------------------------------------------------------
  it('renders pinned-mismatch banner when sync status is pinned-mismatch', () => {
    mockSyncStatus = {
      status: 'pinned-mismatch',
      currentLabel: 'John 3:16',
      syncLabel: 'Romans 8:28',
      syncVerseId: 45008028,
    };
    const { container } = render(<StudyPane />);
    expect(container.querySelector('.study-pane__pinned-banner')).toBeTruthy();
  });

  it('does not render pinned-mismatch banner when synced', () => {
    const { container } = render(<StudyPane />);
    expect(container.querySelector('.study-pane__pinned-banner')).toBeNull();
  });

  it('clicking sync button in pinned-mismatch banner calls unpin and load actions', () => {
    mockSyncStatus = {
      status: 'pinned-mismatch',
      currentLabel: 'John 3:16',
      syncLabel: 'Romans 8:28',
      syncVerseId: 45008028,
    };
    const { container } = render(<StudyPane />);
    const syncBtn = container.querySelector('.study-pane__pinned-banner .study-pane__sync-btn')!;
    fireEvent.click(syncBtn);
    expect(mockStudyStoreUnpin).toHaveBeenCalled();
    expect(mockCommentaryStoreLoadForChapter).toHaveBeenCalledWith(45, 8);
    expect(mockBibleStoreAdoptPreviewAsStudy).toHaveBeenCalledWith(45008028);
    expect(mockStudyStoreLoadForVerse).toHaveBeenCalledWith(45008028, 45, 8, 28);
  });

  // ------------------------------------------------------------------
  // Preview-available banner
  // ------------------------------------------------------------------
  it('renders preview-available banner when sync status is preview-available', () => {
    mockSyncStatus = {
      status: 'preview-available',
      currentLabel: 'John 3:16',
      syncLabel: 'Romans 8:28',
      syncVerseId: 45008028,
    };
    const { container } = render(<StudyPane />);
    expect(container.querySelector('.study-pane__selected-banner')).toBeTruthy();
  });

  it('does not render preview-available banner when synced', () => {
    const { container } = render(<StudyPane />);
    expect(container.querySelector('.study-pane__selected-banner')).toBeNull();
  });

  it('clicking sync button in preview-available banner loads chapter and adopts preview', () => {
    mockSyncStatus = {
      status: 'preview-available',
      currentLabel: 'John 3:16',
      syncLabel: 'Romans 8:28',
      syncVerseId: 45008028,
    };
    const { container } = render(<StudyPane />);
    const syncBtn = container.querySelector('.study-pane__selected-banner .study-pane__sync-btn')!;
    fireEvent.click(syncBtn);
    expect(mockCommentaryStoreLoadForChapter).toHaveBeenCalledWith(45, 8);
    expect(mockBibleStoreAdoptPreviewAsStudy).toHaveBeenCalledWith(45008028);
  });

  it('does not throw when selectedSync button is clicked with null syncVerseId', () => {
    mockSyncStatus = {
      status: 'preview-available',
      currentLabel: 'John 3:16',
      syncLabel: '',
      syncVerseId: null,
    };
    const { container } = render(<StudyPane />);
    const syncBtn = container.querySelector('.study-pane__selected-banner .study-pane__sync-btn')!;
    expect(() => fireEvent.click(syncBtn)).not.toThrow();
    expect(mockCommentaryStoreLoadForChapter).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Pinned passage label
  // ------------------------------------------------------------------
  it('shows pinned passage label when pinned', () => {
    mockPinned = true;
    mockPinnedBook = 1;
    mockPinnedChapter = 1;
    mockPinnedVerse = 1;
    const { container } = render(<StudyPane />);
    const passageEl = container.querySelector('.study-pane__passage');
    expect(passageEl?.textContent).toContain('Book1');
    expect(passageEl?.textContent).toContain('1:1');
  });
});
