import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import CommentaryHome from './CommentaryHome';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enString, enT } from '../testing/enCatalog';

// Create a controllable mock
const mockUseCommentaryPanel = vi.fn();

vi.mock('../stores/hooks/useCommentaryPanel', () => ({
  useCommentaryPanel: (...args: unknown[]) => mockUseCommentaryPanel(...args),
}));

// Mock useBibleStore
vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    { getState: vi.fn().mockReturnValue({ navigateToVerseInPrimary: vi.fn() }) },
  ),
}));

// Mock VersePreviewTooltip
vi.mock('./VersePreviewTooltip', () => ({
  default: () => null,
}));

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      // Echoes the key, and appends the interpolation arguments when there are
      // any, so a test can assert both that a string is localized *and* what it
      // was given - `{filtered} of {total}` is a claim about numbers.
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

const defaultPanelState = {
  homeData: [],
  homeLoading: false,
  openTabs: [],
  mutedModules: new Set<string>(),
  promotedModules: new Set<string>(),
  toggleMuted: vi.fn(),
  togglePromoted: vi.fn(),
};

describe('CommentaryHome', () => {
  const onOpenTab = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCommentaryPanel.mockReturnValue(defaultPanelState);
  });

  it('shows "navigate to a verse" message when no verse is selected', () => {
    renderWithProviders(
      <CommentaryHome
        currentVerseId={null}
        onOpenTab={onOpenTab}
      />,
    );
    expect(screen.getByText(enString('commentaryHome.navigateToAVerseToSee'))).toBeInTheDocument();
  });

  it('shows empty state when no commentaries have content', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      homeData: [],
    });
    renderWithProviders(
      <CommentaryHome
        currentVerseId={43003016}
        onOpenTab={onOpenTab}
      />,
    );
    expect(screen.getByText(/No commentaries have content for this verse/)).toBeInTheDocument();
  });

  it('shows loading spinner when homeLoading is true and no data', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      homeLoading: true,
    });
    renderWithProviders(
      <CommentaryHome
        currentVerseId={43003016}
        onOpenTab={onOpenTab}
      />,
    );
    expect(screen.getByText(/Loading commentaries/)).toBeInTheDocument();
  });

  it('renders header filter and sort controls when verse is selected with data', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      homeData: [
        {
          abbreviation: 'MHC',
          name: 'Matthew Henry Commentary',
          entries: [{ entry_id: 1, entry_level: 'verse', content: 'God loves the world', word_count: 100 }],
          totalWordCount: 100,
        },
      ],
    });
    renderWithProviders(
      <CommentaryHome
        currentVerseId={43003016}
        onOpenTab={onOpenTab}
      />,
    );
    expect(screen.getByPlaceholderText(enString('commentaryHome.filterPlaceholder'))).toBeInTheDocument();
    expect(screen.getByText(enString('commentaryHome.sortDefault'))).toBeInTheDocument();
  });

  // The box matches on name and abbreviation but was labelled only "Filter...",
  // which named neither what it filters nor which of the lists on screen - and
  // it had no accessible name at all.
  it('names what the filter box filters, for sighted and assistive users alike', () => {
    mockUseCommentaryPanel.mockReturnValue(defaultPanelState);
    renderWithProviders(
      <CommentaryHome currentVerseId={43003016} onOpenTab={onOpenTab} />,
    );
    const box = screen.getByPlaceholderText(enString('commentaryHome.filterPlaceholder'));
    expect(box).toHaveAccessibleName(enString('commentaryHome.filterLabel'));
  });

  it('localizes the heading rather than hardcoding English', () => {
    mockUseCommentaryPanel.mockReturnValue(defaultPanelState);
    renderWithProviders(
      <CommentaryHome currentVerseId={43003016} onOpenTab={onOpenTab} />,
    );
    // The reference itself comes from the verse formatter; what matters here is
    // that the heading is the catalog message and not English in the component.
    expect(screen.getByRole('heading')).toHaveTextContent(
      new RegExp('^' + enString('commentaryHome.heading').split('{')[0]!),
    );
  });

  it('shows module count', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      homeData: [
        {
          abbreviation: 'MHC',
          name: 'Matthew Henry Commentary',
          entries: [{ entry_id: 1, entry_level: 'verse', content: 'test', word_count: 50 }],
          totalWordCount: 50,
        },
      ],
    });
    renderWithProviders(
      <CommentaryHome
        currentVerseId={43003016}
        onOpenTab={onOpenTab}
      />,
    );
    expect(
      screen.getByText(enT('commentaryHome.moduleCount', { filtered: 1, total: 1 })),
    ).toBeInTheDocument();
  });

  it('renders Markdown-formatted entry content as HTML in the preview', () => {
    // The bundled SYNTHESIS module ships content_format: "markdown"; the preview
    // must not leak raw Markdown marks. See CommentaryEntryView for the sibling case.
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      homeData: [
        {
          abbreviation: 'SYNTHESIS',
          name: 'Combined Summary',
          entries: [
            {
              entry_id: 1,
              entry_level: 'verse',
              // Deliberately does not lead with a heading: markdownToHtml strips a
              // leading H1 by design (synthesis entries repeat the reference as a title).
              content: 'A summary of the verse.\n\nOverview\n--------\n\nGod **loved** the world.',
              word_count: 50,
            },
          ],
          totalWordCount: 50,
        },
      ],
    });
    const { container } = renderWithProviders(
      <CommentaryHome
        currentVerseId={43003016}
        onOpenTab={onOpenTab}
      />,
    );
    // Modules render collapsed; the entry preview only mounts once expanded.
    // The digest module displays as "Combined Summary", never the raw SYNTHESIS abbreviation.
    fireEvent.click(screen.getByText('Combined Summary'));
    expect(screen.queryByText('SYNTHESIS')).not.toBeInTheDocument();
    expect(container.querySelector('h1, h2')).not.toBeNull();
    expect(container.querySelector('strong')).not.toBeNull();
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toContain('====');
  });

  it('leaves HTML-formatted entry content untouched', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      homeData: [
        {
          abbreviation: 'MHC',
          name: 'Matthew Henry Commentary',
          entries: [
            {
              entry_id: 1,
              entry_level: 'verse',
              content: '<p>God <em>loved</em> the world.</p>',
              word_count: 50,
            },
          ],
          totalWordCount: 50,
        },
      ],
    });
    const { container } = renderWithProviders(
      <CommentaryHome
        currentVerseId={43003016}
        onOpenTab={onOpenTab}
      />,
    );
    fireEvent.click(screen.getByText('MHC'));
    expect(container.querySelector('em')).not.toBeNull();
    expect(container.textContent).toContain('God loved the world.');
  });

  it('shows commentary abbreviation in module list', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      homeData: [
        {
          abbreviation: 'MHC',
          name: 'Matthew Henry Commentary',
          entries: [{ entry_id: 1, entry_level: 'verse', content: 'test content', word_count: 50 }],
          totalWordCount: 50,
        },
      ],
    });
    renderWithProviders(
      <CommentaryHome
        currentVerseId={43003016}
        onOpenTab={onOpenTab}
      />,
    );
    expect(screen.getByText('MHC')).toBeInTheDocument();
  });

  it('labels the SYNTHESIS module "Combined Summary" instead of the raw abbreviation, with no secondary name line', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      homeData: [
        {
          abbreviation: 'SYNTHESIS',
          name: 'Commentary Synthesis', // raw DB name - must never surface in the UI
          entries: [{ entry_id: 1, entry_level: 'verse', content: 'test content', word_count: 50 }],
          totalWordCount: 50,
        },
      ],
    });
    renderWithProviders(
      <CommentaryHome
        currentVerseId={43003016}
        onOpenTab={onOpenTab}
      />,
    );
    expect(screen.getByText('Combined Summary')).toBeInTheDocument();
    expect(screen.queryByText('SYNTHESIS')).not.toBeInTheDocument();
    expect(screen.queryByText('Commentary Synthesis')).not.toBeInTheDocument();
  });

  describe('Favorite action', () => {
    const mhcModule = {
      abbreviation: 'MHC',
      name: 'Matthew Henry Commentary',
      entries: [{ entry_id: 1, entry_level: 'verse' as const, content: 'test content', word_count: 50 }],
      totalWordCount: 50,
    };

    it('shows Favorite/Unfavorite i18n keys instead of hardcoded Promote/Unpromote text, and toggles via togglePromoted', () => {
      const togglePromoted = vi.fn();
      mockUseCommentaryPanel.mockReturnValue({
        ...defaultPanelState,
        togglePromoted,
        homeData: [mhcModule],
      });
      renderWithProviders(
        <CommentaryHome currentVerseId={43003016} onOpenTab={onOpenTab} />,
      );
      fireEvent.click(screen.getByText('MHC'));
      expect(screen.getByText(enString('commentaryHome.favoriteLabel'))).toBeInTheDocument();
      expect(screen.queryByText('Promote')).not.toBeInTheDocument();
      expect(screen.queryByText('Unpromote')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText(enString('commentaryHome.favoriteLabel')));
      expect(togglePromoted).toHaveBeenCalledWith('MHC');
    });

    it('shows a favorited badge (with title) on the collapsed row when a module is promoted', () => {
      mockUseCommentaryPanel.mockReturnValue({
        ...defaultPanelState,
        promotedModules: new Set(['MHC']),
        homeData: [mhcModule],
      });
      renderWithProviders(
        <CommentaryHome currentVerseId={43003016} onOpenTab={onOpenTab} />,
      );
      expect(screen.getByTitle(enString('commentaryHome.favoritedBadgeTitle'))).toBeInTheDocument();
      // Expanded actions show "Unfavorite" for an already-promoted module.
      fireEvent.click(screen.getByText('MHC'));
      expect(screen.getByText(enString('commentaryHome.unfavoriteLabel'))).toBeInTheDocument();
    });
  });

  describe('Mute confirmation', () => {
    const mhcModule = {
      abbreviation: 'MHC',
      name: 'Matthew Henry Commentary',
      entries: [{ entry_id: 1, entry_level: 'verse' as const, content: 'test content', word_count: 50 }],
      totalWordCount: 50,
    };

    it('requires confirmation before muting, and only calls toggleMuted after confirming', () => {
      const toggleMuted = vi.fn();
      mockUseCommentaryPanel.mockReturnValue({
        ...defaultPanelState,
        toggleMuted,
        homeData: [mhcModule],
      });
      renderWithProviders(
        <CommentaryHome currentVerseId={43003016} onOpenTab={onOpenTab} />,
      );
      fireEvent.click(screen.getByText('MHC'));
      fireEvent.click(screen.getByText(enString('commentaryHome.muteLabel')));

      // Dialog is shown; muting has NOT happened yet.
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      expect(toggleMuted).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
      expect(toggleMuted).toHaveBeenCalledWith('MHC');
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });

    it('cancelling the mute confirmation leaves the module unmuted', () => {
      const toggleMuted = vi.fn();
      mockUseCommentaryPanel.mockReturnValue({
        ...defaultPanelState,
        toggleMuted,
        homeData: [mhcModule],
      });
      renderWithProviders(
        <CommentaryHome currentVerseId={43003016} onOpenTab={onOpenTab} />,
      );
      fireEvent.click(screen.getByText('MHC'));
      fireEvent.click(screen.getByText(enString('commentaryHome.muteLabel')));
      fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));

      expect(toggleMuted).not.toHaveBeenCalled();
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });

    it('unmuting does NOT require confirmation', () => {
      const toggleMuted = vi.fn();
      mockUseCommentaryPanel.mockReturnValue({
        ...defaultPanelState,
        toggleMuted,
        mutedModules: new Set(['MHC']),
        homeData: [mhcModule],
      });
      renderWithProviders(
        <CommentaryHome currentVerseId={43003016} onOpenTab={onOpenTab} />,
      );
      // Muted modules render collapsed under the "Muted (N)" section header.
      fireEvent.click(screen.getByText(enT('commentaryHome.muted', { v1: 1 })));
      fireEvent.click(screen.getByText('MHC'));
      fireEvent.click(screen.getByText(enString('commentaryHome.unmuteLabel')));

      expect(toggleMuted).toHaveBeenCalledWith('MHC');
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });
  });
});
