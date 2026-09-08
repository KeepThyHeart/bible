/**
 * The sidebar's "Document" section has its own Rename action (separate from
 * the breadcrumb's rename icon in UserNotesEditorView). It must also stay
 * hidden for verse notes, whose title is derived from the verse reference.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import UserNotesSidebar from './UserNotesSidebar';
import { ContextProvider, type AppServices } from '../../../contexts/ContextProvider';
import type { BnFile } from '../../../services/fileNotesAPI';
import { enT } from '../../../testing/enCatalog';

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function makeNote(overrides: Partial<BnFile> = {}): BnFile {
  return {
    bn: 1,
    type: 'document',
    title: 'My Note',
    tags: [],
    passages: [],
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    content: '',
    metadata: {},
    ...overrides,
  };
}

function baseProps(overrides: Partial<React.ComponentProps<typeof UserNotesSidebar>> = {}) {
  return {
    view: 'editor' as const,
    sideTab: 'browse' as const,
    setSideTab: vi.fn(),
    isInVerseNotesFolder: false,
    canCreateNewNote: true,
    canCreateNewFolder: true,
    currentNote: makeNote(),
    currentNotePath: 'Documents/My Note.bn',
    currentPath: 'Documents',
    editorIsDirty: false,
    onLoadDirectory: vi.fn(),
    onSaveNote: vi.fn(),
    onShowNewNoteDialog: vi.fn(),
    onShowNewFolderDialog: vi.fn(),
    onOpenFile: vi.fn(),
    onShowMoveDialog: vi.fn(),
    onRequestRename: vi.fn(),
    onExportMarkdown: vi.fn(),
    onExportDocx: vi.fn(),
    onExportPdf: vi.fn(),
    onSaveAs: vi.fn(),
    onPrint: vi.fn(),
    onOpenInExplorer: vi.fn(),
    ...overrides,
  };
}

function renderSidebar(overrides: Partial<React.ComponentProps<typeof UserNotesSidebar>> = {}) {
  return render(
    <ContextProvider services={createMockServices()}>
      <UserNotesSidebar {...baseProps(overrides)} />
    </ContextProvider>,
  );
}

describe('UserNotesSidebar - Rename action visibility', () => {
  // The sidebar's action labels go through `tf()` (see src/ui/utils/tFallback.ts),
  // which falls back to the English source text when the i18n stub echoes the
  // key back unchanged (as the mock `t` here does) - so assertions match the
  // rendered English fallback, not the raw catalog key.
  it('shows Rename for a regular document note', () => {
    renderSidebar({ currentNote: makeNote({ type: 'document' }) });
    expect(screen.getByText('Rename')).toBeInTheDocument();
  });

  it('hides Rename for a verse note', () => {
    renderSidebar({ currentNote: makeNote({ type: 'verse_note', title: 'John 3:16' }) });
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
  });

  it('still shows Move to... for a verse note (only rename is blocked)', () => {
    renderSidebar({ currentNote: makeNote({ type: 'verse_note', title: 'John 3:16' }) });
    expect(screen.getByText('Move to...')).toBeInTheDocument();
  });
});
