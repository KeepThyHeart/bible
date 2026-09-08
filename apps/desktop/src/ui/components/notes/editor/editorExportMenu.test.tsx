/**
 * Print / PDF / Word / Markdown in the editor toolbar.
 *
 * All four already existed - as buttons in the notes sidebar, which is
 * collapsed by default in the editor view, so the user looking for "print
 * this" next to "+ Bible Passage" found nothing. They are one dropdown on the
 * insert row now, beside "+ Bible Passage" (see notes-writing.md) - printing
 * acts on the document, not on a run of text - and the toolbar renders it only
 * when the host supplies the actions: a bare editor has no file to print.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));

vi.mock('../../../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'bible_default',
  useBibleStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ navigateToVerseInPrimary: vi.fn(), availableBibles: [], loadAvailableBibles: vi.fn() }),
    { getState: () => ({ panels: new Map() }) },
  ),
}));

vi.mock('../../../services/electronAPI', () => ({
  bibleAPI: { getVerses: vi.fn().mockResolvedValue([]), getVerse: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../VersePreviewTooltip', () => ({ default: () => null }));

import NoteEditor from './NoteEditor';

function renderEditor() {
  const actions = {
    onPrint: vi.fn(),
    onExportPdf: vi.fn(),
    onExportDocx: vi.fn(),
    onExportMarkdown: vi.fn(),
  };
  render(<NoteEditor value="<p>Writing here</p>" onChange={vi.fn()} exportActions={actions} />);
  return actions;
}

describe('the editor toolbar export menu', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each([
    ['editor-export-print', 'onPrint'],
    ['editor-export-pdf', 'onExportPdf'],
    ['editor-export-docx', 'onExportDocx'],
    ['editor-export-markdown', 'onExportMarkdown'],
  ] as const)('routes %s to %s', (testId, action) => {
    const actions = renderEditor();

    fireEvent.click(screen.getByTestId('editor-export-menu'));
    fireEvent.click(screen.getByTestId(testId));

    expect(actions[action]).toHaveBeenCalledTimes(1);
    // Choosing an item closes the menu - it is a command, not a toggle.
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
  });

  it('offers all four in one menu rather than four toolbar buttons', () => {
    renderEditor();

    fireEvent.click(screen.getByTestId('editor-export-menu'));

    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  });

  // Print sits with "+ Bible Passage" on the insert row, not among the
  // formatting toggles: both act on the document rather than on selected text.
  it('sits on the insert row beside "+ Bible Passage"', () => {
    renderEditor();

    const trigger = screen.getByTestId('editor-export-menu');
    const insert = screen.getByTitle('editorToolbar.insertPassageTitle');
    // The trigger is wrapped by ToolbarMenu's anchor div, so compare the row.
    expect(trigger.closest('div')?.parentElement).toBe(insert.parentElement);
  });

  // The editor is also used read-only and (in tests, and in principle
  // elsewhere) without a file behind it. Nothing to export, so nothing offered.
  it('is absent when the host supplies no export actions', () => {
    render(<NoteEditor value="<p>Writing here</p>" onChange={vi.fn()} />);

    expect(screen.queryByTestId('editor-export-menu')).not.toBeInTheDocument();
  });
});
