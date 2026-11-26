/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  compile: vi.fn(),
  parse: vi.fn(),
}));

vi.mock('../../../services/compile/compilePassageNotes', () => ({
  MAX_COMPILE_VERSES: 2000,
  compilePassageNotes: h.compile,
}));
vi.mock('../../../services/compile/parsePassageList', () => ({ parsePassageList: h.parse }));
vi.mock('../../../services/verseFetchCache', () => ({ getVersesCached: vi.fn() }));
vi.mock('../../../utils/verseReference', () => ({ getBookNameFromCache: () => 'Romans' }));
vi.mock('../../../services/localizedReferenceParser', () => ({
  getLocalizedReferenceParser: () => ({ getBookName: () => 'Romans' }),
}));
vi.mock('../../../services/fileNotesAPI', () => ({
  listDirectory: vi.fn(),
  createNote: vi.fn(),
  saveNote: vi.fn(),
  readVerseNotes: vi.fn(),
  printNote: vi.fn(),
  exportNotePdf: vi.fn(),
  exportNoteDocx: vi.fn(),
}));
vi.mock('../UserNotesPane/hooks/useMoveDialogFolders', () => ({
  useMoveDialogFolders: () => ['', 'Sermons', 'Verse Notes', 'Verse Notes/Romans'],
}));
vi.mock('../editor/NoteViewer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="viewer">{content}</div>,
}));

import { useBibleStore } from '../../../stores/useBibleStore';
import * as api from '../../../services/fileNotesAPI';
import CompilePassageNotesDialog from './CompilePassageNotesDialog';
import { ContextProvider, type AppServices } from '../../../contexts/ContextProvider';

const services = {
  registry: {},
  whenContext: {},
  keybindings: {},
  i18n: {
    t: (k: string) => k,
    currentLocale: 'en',
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  },
} as unknown as AppServices;

const spec = { label: 'Romans 8', book: 45, startId: 45008001, endId: 45008039, source: 'Rom 8' };
const okResult = { ok: true, html: '<h2>Romans 8</h2><p>note</p>', verseCount: 39, noteCount: 3, emptyPassages: [] };

function renderDialog(props: Partial<React.ComponentProps<typeof CompilePassageNotesDialog>> = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <ContextProvider services={services}>
      <CompilePassageNotesDialog open initialReference="Rom 8" onClose={onClose} onCreated={onCreated} {...props} />
    </ContextProvider>
  );
  return { onClose, onCreated };
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useBibleStore.setState({ availableBibles: [], loadAvailableBibles: vi.fn() } as never);
  localStorage.clear();
  h.parse.mockReturnValue({ passages: [spec], unrecognized: [] });
  h.compile.mockResolvedValue(okResult);
  vi.mocked(api.listDirectory).mockResolvedValue([]);
  vi.mocked(api.createNote).mockImplementation(async (_p: string, title: string) => ({
    title,
    content: '',
    updated: 'u0',
  } as never));
  vi.mocked(api.saveNote).mockResolvedValue('u1');
  vi.mocked(api.printNote).mockResolvedValue({ success: true } as never);
  vi.mocked(api.exportNotePdf).mockResolvedValue({ success: true } as never);
  vi.mocked(api.exportNoteDocx).mockResolvedValue('/tmp/x.docx');
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('CompilePassageNotesDialog', () => {
  it('prefills the references and shows the preview and an enabled footer when compiled', async () => {
    renderDialog();
    expect((screen.getByTestId('compile-references') as HTMLTextAreaElement).value).toBe('Rom 8');
    await settle();
    expect(screen.getByTestId('compile-status').getAttribute('data-ok')).toBe('true');
    expect(screen.getByTestId('viewer').textContent).toContain('note');
    expect((screen.getByTestId('compile-title') as HTMLInputElement).value).toBe('Romans 8');
    expect((screen.getByTestId('compile-create') as HTMLButtonElement).disabled).toBe(false);
    // Verse Notes folders are not offered as a destination.
    const opts = Array.from(screen.getByTestId('compile-folder').querySelectorAll('option')).map((o) => o.value);
    expect(opts).toEqual(['', 'Sermons']);
  });

  it('creates the note with template + html, adding (2) on a name clash', async () => {
    vi.mocked(api.listDirectory).mockResolvedValue([
      { name: 'Romans 8.bn', path: 'Romans 8.bn', isDirectory: false, modified: '' },
    ]);
    const { onCreated, onClose } = renderDialog();
    await settle();
    fireEvent.change(screen.getByTestId('compile-template'), { target: { value: 'verse-study' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('compile-create'));
    });
    expect(api.createNote).toHaveBeenCalledWith('Romans 8 (2)', 'Romans 8', 'study');
    const [path, note] = vi.mocked(api.saveNote).mock.calls[0];
    expect(path).toBe('Romans 8 (2).bn');
    expect((note as { content: string }).content.endsWith(okResult.html)).toBe(true);
    expect((note as { content: string }).content.length).toBeGreaterThan(okResult.html.length);
    expect(onCreated).toHaveBeenCalledWith('Romans 8 (2).bn');
    expect(onClose).toHaveBeenCalled();
  });

  it('creates in the chosen folder', async () => {
    renderDialog();
    await settle();
    fireEvent.change(screen.getByTestId('compile-folder'), { target: { value: 'Sermons' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('compile-create'));
    });
    expect(api.listDirectory).toHaveBeenCalledWith('Sermons');
    expect(api.saveNote).toHaveBeenCalledWith('Sermons/Romans 8.bn', expect.anything());
  });

  it('prints with a full document and creates no note', async () => {
    renderDialog();
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('compile-print'));
    });
    const doc = vi.mocked(api.printNote).mock.calls[0][0];
    expect(doc).toContain('<!DOCTYPE html>');
    expect(doc).toContain('note');
    await act(async () => {
      fireEvent.click(screen.getByTestId('compile-pdf'));
    });
    expect(api.exportNotePdf).toHaveBeenCalledWith(expect.stringContaining('<!DOCTYPE html>'), 'Romans 8');
    expect(api.createNote).not.toHaveBeenCalled();
    expect(api.saveNote).not.toHaveBeenCalled();
  });

  it('exports Word with the raw html', async () => {
    renderDialog();
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('compile-docx'));
    });
    expect(api.exportNoteDocx).toHaveBeenCalledWith('Romans 8', okResult.html, 'Romans 8');
    expect(api.createNote).not.toHaveBeenCalled();
  });

  it('disables the buttons over the verse limit and shows unrecognized text', async () => {
    h.parse.mockReturnValue({ passages: [spec], unrecognized: ['foo'] });
    h.compile.mockResolvedValue({ ok: false, reason: 'too-many-verses', verseCount: 2500 });
    renderDialog();
    await settle();
    expect(screen.getByTestId('compile-status').getAttribute('data-ok')).toBe('false');
    for (const id of ['compile-create', 'compile-print', 'compile-pdf', 'compile-docx']) {
      expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByTestId('compile-unrecognized').textContent).toContain('foo');
    expect(screen.queryByTestId('viewer')).toBeNull();
  });

  it('does not run the footer buttons before a compile result exists', async () => {
    renderDialog();
    expect((screen.getByTestId('compile-create') as HTMLButtonElement).disabled).toBe(true);
  });
});
