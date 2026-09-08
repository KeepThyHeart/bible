/**
 * Escape closes the Parallel Bible Comparison popup.
 *
 * The popup was reachable only by its Cancel button or a backdrop click.
 * Escape is the generic Cancel across the app - every other dialog answers it,
 * through `useDialogShell` or `useOverlayDismissal` - and this one silently did
 * not, so the reader who reached for the key they use everywhere else was left
 * with the popup still on screen.
 *
 * Renders the real `BiblePaneOverlays` with only the parallel picker open;
 * every other overlay is switched off, so nothing else can claim the keystroke.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Pulls in the whole Bible store otherwise; the picker's Compare button is the
// only thing that touches it and this test never clicks it.
vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: { getState: () => ({ setParallelVersions: vi.fn(), navigateToVerse: vi.fn() }) },
}));

import BiblePaneOverlays from './BiblePaneOverlays';

const setShowParallelPicker = vi.fn();

/** Only the parallel picker is open; every other overlay is off. */
function props(overrides: Record<string, unknown> = {}) {
  return {
    panelId: 'panel-1',
    currentBook: 43,
    currentChapter: 3,
    currentBookName: 'John',
    showBookPicker: false,
    setShowBookPicker: vi.fn(),
    showSelector: false,
    setShowSelector: vi.fn(),
    versionSelectorTabId: null,
    setVersionSelectorTabId: vi.fn(),
    availableBibles: [],
    loadingBibles: false,
    openTabs: [],
    openBible: vi.fn(),
    changeTabVersion: vi.fn(),
    showParallelPicker: true,
    setShowParallelPicker,
    parallelSelections: ['', '', '', ''],
    setParallelSelections: vi.fn(),
    isParallelViewMode: false,
    toggleParallelView: vi.fn(),
    contextMenu: null,
    setContextMenu: vi.fn(),
    activeTab: null,
    handleRemoveHighlight: vi.fn(),
    syncAllNotesPanelsWithVerse: vi.fn(),
    setSelectedVerse: vi.fn(),
    setStudyPaneActiveTab: vi.fn(),
    copyOptionsDialog: null,
    setCopyOptionsDialog: vi.fn(),
    highlightMenu: { visible: false },
    setHighlightMenu: vi.fn(),
    handleSelectHighlight: vi.fn(),
    handleCancelHighlightMenu: vi.fn(),
    floatingToolbar: { visible: false, selection: null },
    handleFloatingHighlight: vi.fn(),
    handleFloatingUnderline: vi.fn(),
    handleFloatingRemoveFormatting: vi.fn(),
    dismissFloatingToolbar: vi.fn(),
    noteTooltip: { visible: false },
    setNoteTooltip: vi.fn(),
    handleNoteTooltipClose: vi.fn(),
    handleNoteTooltipEnter: vi.fn(),
    ...overrides,
  } as unknown as ComponentProps<typeof BiblePaneOverlays>;
}

describe('Parallel Bible Comparison popup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('closes on Escape', () => {
    render(<BiblePaneOverlays {...props()} />);
    expect(screen.getByTestId('parallel-version-picker')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(setShowParallelPicker).toHaveBeenCalledWith(false);
  });

  it('does not listen for Escape while it is closed', () => {
    render(<BiblePaneOverlays {...props({ showParallelPicker: false })} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(setShowParallelPicker).not.toHaveBeenCalled();
  });
});
