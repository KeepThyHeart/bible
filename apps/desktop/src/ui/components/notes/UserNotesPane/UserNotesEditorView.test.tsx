/**
 * Verse notes derive their title from the linked verse reference (see
 * BibleNotesFileService.createVerseNote) and must not be user-renameable -
 * unlike documents/journal/prayer notes, which keep the free-text title.
 * This checks that the rename affordance is not merely disabled but absent
 * entirely from the breadcrumb when `titleEditable` is false.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserNotesEditorView from './UserNotesEditorView';
import { ContextProvider, type AppServices } from '../../../contexts/ContextProvider';

const dirApi = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('../../../services/noteDirectionAPI', () => ({ noteDirectionAPI: dirApi }));
vi.mock('../editor/NoteEditor', () => ({
  default: ({ defaultDirection, directionControl }: { defaultDirection?: string; directionControl?: React.ReactNode }) => (
    <div data-testid="note-editor" dir={defaultDirection ?? 'ltr-ui'}>
      <div data-testid="more-row">{directionControl}</div>
    </div>
  ),
}));

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function baseProps(overrides: Partial<React.ComponentProps<typeof UserNotesEditorView>> = {}) {
  return {
    editorContent: '',
    setEditorContent: vi.fn(),
    editorIsDirty: false,
    isSaving: false,
    lastSaved: undefined,
    showEditorSidebar: false,
    setShowEditorSidebar: vi.fn(),
    breadcrumbs: [{ label: 'Home', path: '' }, { label: 'John 3:16', path: 'Verse Notes/John/3/16.bn' }],
    onBreadcrumbNavigate: vi.fn(),
    onRequestRenameTitle: vi.fn(),
    titleEditable: true,
    onPopOut: vi.fn(),
    exportActions: {
      onPrint: vi.fn(),
      onExportPdf: vi.fn(),
      onExportDocx: vi.fn(),
      onExportMarkdown: vi.fn(),
    },
    ...overrides,
  };
}

function renderView(overrides: Partial<React.ComponentProps<typeof UserNotesEditorView>> = {}) {
  return render(
    <ContextProvider services={createMockServices()}>
      <UserNotesEditorView {...baseProps(overrides)} />
    </ContextProvider>,
  );
}

describe('UserNotesEditorView - title editability', () => {
  it('shows the rename-title icon for an editable (non-verse) note', () => {
    renderView({ titleEditable: true });
    expect(screen.getByTitle('userNotesPane.renameNoteTitle')).toBeInTheDocument();
  });

  it('omits the rename-title icon entirely for a verse note (not just disabled)', () => {
    renderView({ titleEditable: false });
    expect(screen.queryByTitle('userNotesPane.renameNoteTitle')).not.toBeInTheDocument();
  });

  it('still shows the pop-out icon regardless of title editability', () => {
    renderView({ titleEditable: false });
    expect(screen.getByTitle('userNotesPane.popOutTitle')).toBeInTheDocument();
  });

  it('invokes onRequestRenameTitle when the rename icon is clicked', () => {
    const onRequestRenameTitle = vi.fn();
    renderView({ titleEditable: true, onRequestRenameTitle });
    screen.getByTitle('userNotesPane.renameNoteTitle').click();
    expect(onRequestRenameTitle).toHaveBeenCalledTimes(1);
  });

  it('invokes onPopOut when the pop-out icon is clicked', () => {
    const onPopOut = vi.fn();
    renderView({ onPopOut });
    screen.getByTitle('userNotesPane.popOutTitle').click();
    expect(onPopOut).toHaveBeenCalledTimes(1);
  });
});

describe('UserNotesEditorView - note direction', () => {
  it('loads the stored direction, applies it as the editor root dir and saves changes', async () => {
    dirApi.get.mockResolvedValue('rtl');
    dirApi.set.mockResolvedValue(undefined);
    renderView({ notePath: 'Docs/a.bn' });
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('dir', 'rtl'));
    expect(dirApi.get).toHaveBeenCalledWith('Docs/a.bn');
    const select = screen.getByLabelText('editorToolbar.noteDirectionLabel') as HTMLSelectElement;
    expect(select.value).toBe('rtl');

    fireEvent.change(select, { target: { value: 'ltr' } });
    expect(dirApi.set).toHaveBeenLastCalledWith('Docs/a.bn', 'ltr');
    expect(screen.getByTestId('note-editor')).toHaveAttribute('dir', 'ltr');

    fireEvent.change(select, { target: { value: 'default' } });
    expect(dirApi.set).toHaveBeenLastCalledWith('Docs/a.bn', null);
    expect(screen.getByTestId('note-editor')).toHaveAttribute('dir', 'ltr-ui');
  });

  it('shows no control without a note path', () => {
    renderView();
    expect(screen.queryByLabelText('editorToolbar.noteDirectionLabel')).not.toBeInTheDocument();
  });
});

describe('UserNotesEditorView - breadcrumb title (B-011)', () => {
  it('does not let the current note title shrink/clip next to the Saved badge', () => {
    renderView({ breadcrumbs: [{ label: 'Home', path: '' }, { label: 'Matthew 6:12', path: 'x.bn' }] });
    const current = screen.getByText('Matthew 6:12').closest('[aria-current="true"]') as HTMLElement;
    expect(current.className).toContain('flex-shrink-0');
    expect(current.className).not.toContain('truncate');
  });
});

describe('UserNotesEditorView - sidebar toggle', () => {
  it('uses a changing name without aria-pressed (one cue, not two)', () => {
    renderView({ showEditorSidebar: true });
    const btn = screen.getByRole('button', { name: 'userNotesPane.hideSidebar' });
    expect(btn).not.toHaveAttribute('aria-pressed');
  });
});

describe('UserNotesEditorView - Delete button', () => {
  it('shows a visible Delete button in the header when the host supplies onRequestDelete', () => {
    const onRequestDelete = vi.fn();
    renderView({ titleEditable: false, onRequestDelete });
    fireEvent.click(screen.getByRole('button', { name: /notesFolderBrowser\.menuDelete/ }));
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
  });

  it('omits it otherwise', () => {
    renderView();
    expect(screen.queryByRole('button', { name: /notesFolderBrowser\.menuDelete/ })).not.toBeInTheDocument();
  });
});

describe('UserNotesEditorView - save status', () => {
  it('shows "Saved" for a note with a file', () => {
    renderView({ editorIsDirty: false });
    expect(screen.getByText('userNotesPane.savedStatus')).toBeInTheDocument();
  });

  it('shows no saved status for an unsaved draft', () => {
    renderView({ editorIsDirty: false, isDraft: true });
    expect(screen.queryByText('userNotesPane.savedStatus')).not.toBeInTheDocument();
  });
});

describe('UserNotesEditorView - header layout', () => {
  it('lets the header wrap and keeps the note direction select out of it (it lives in the toolbar More row)', () => {
    renderView({ notePath: 'Docs/a.bn' });
    const nav = screen.getByLabelText('userNotesPane.breadcrumbLabel');
    expect(nav.parentElement?.className).toContain('flex-wrap');
    expect(nav.querySelector('select')).toBeNull();
    expect(screen.getByTestId('more-row').querySelector('select')).not.toBeNull();
  });
});
