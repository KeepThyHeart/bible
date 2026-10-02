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
  default: ({ defaultDirection }: { defaultDirection?: string }) => (
    <div data-testid="note-editor" dir={defaultDirection ?? 'ltr-ui'} />
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
