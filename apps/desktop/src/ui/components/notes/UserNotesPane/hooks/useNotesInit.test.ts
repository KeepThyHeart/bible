/**
 * Unit tests for useNotesInit's restore path - "come back to the note I was
 * writing".
 *
 * The pane keeps its position (view / sidebar sub-tab / folder / open note) in
 * local React state; `useFileNotesStore.panelNavStates` is the copy that
 * survives an unmount, a pop-out, and a quit. This hook is both ends of that:
 * it reads the remembered position on mount and writes it back on every
 * navigation.
 *
 * The cases that matter and are easy to get wrong:
 *  - the remembered note is gone from disk (renamed, moved, deleted) - startup
 *    must fall back to its folder silently, never throw and never surface an
 *    error banner;
 *  - the registration effect fires on the first commit, before the async
 *    restore has resolved, so it must not overwrite the remembered position
 *    with the pane's mount-time defaults;
 *  - unmount must NOT clear the entry (a dockview panel unmounts on every tab
 *    switch, and the position has to outlive that as well as a quit).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotesInit } from './useNotesInit';
import type { BnFile } from '../../../../services/fileNotesAPI';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import {
  useFileNotesStore,
  setNotesPanelNavState,
  getNotesPanelNavState,
  type NotesPanelNavState,
} from '../../../../stores/useFileNotesStore';

vi.mock('../../../../services/fileNotesAPI', () => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  isInitialized: vi.fn().mockResolvedValue(true),
  ensureVerseNotesFolder: vi.fn().mockResolvedValue(undefined),
  readNote: vi.fn(),
  readNoteAbsolute: vi.fn(),
}));

const resetContent = vi.fn();
vi.mock('../../../../stores/useNoteEditorStore', () => ({
  useNoteEditorStore: { getState: () => ({ resetContent }) },
}));

const setDynamicSubtitle = vi.fn();
vi.mock('../../../../stores/useLayoutStore', () => ({
  useLayoutStore: { getState: () => ({ setDynamicSubtitle }) },
}));

const PANEL = 'notes_default';

const SAVED: NotesPanelNavState = {
  view: 'editor',
  sideTab: 'recent',
  currentPath: 'Documents/Sermons',
  currentNotePath: 'Documents/Sermons/Romans 8.bn',
};

function makeNote(overrides: Partial<BnFile> = {}): BnFile {
  return {
    bn: 1,
    type: 'document',
    title: 'Romans 8',
    tags: [],
    passages: [],
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    content: '<p>Nothing can separate us…</p>',
    metadata: {},
    ...overrides,
  };
}

type Args = Parameters<typeof useNotesInit>[0];

function baseArgs(overrides: Partial<Args> = {}): Args {
  return {
    panelId: PANEL,
    isDetached: false,
    initialView: undefined,
    initialSideTab: undefined,
    initialCurrentPath: undefined,
    initialCurrentNotePath: undefined,
    // Mount-time defaults of the pane, deliberately: this is exactly the state
    // that must not be written over the remembered position.
    view: 'browser',
    sideTab: 'browse',
    currentPath: '',
    currentNotePath: '',
    currentNote: null,
    loadDirectory: vi.fn(),
    setShowSetup: vi.fn(),
    setCurrentNote: vi.fn(),
    setCurrentNotePath: vi.fn(),
    setView: vi.fn(),
    setSideTab: vi.fn(),
    ...overrides,
  };
}

async function mount(args: Args) {
  const rendered = renderHook((props: Args) => useNotesInit(props), { initialProps: args });
  // Flush the bootstrap effect's promise chain.
  await act(async () => { await Promise.resolve(); });
  return rendered;
}

describe('useNotesInit - restoring a remembered position', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileNotesStore.setState({ notesDirectory: 'C:/Users/pete/Notes', recentFiles: [], panelNavStates: {} });
    vi.mocked(fileNotesAPI.isInitialized).mockResolvedValue(true);
    vi.mocked(fileNotesAPI.readNote).mockResolvedValue(makeNote());
    vi.mocked(fileNotesAPI.readNoteAbsolute).mockResolvedValue(makeNote());
  });

  it('reopens the remembered note and sub-tab', async () => {
    setNotesPanelNavState(PANEL, SAVED);
    const args = baseArgs();

    await mount(args);

    expect(fileNotesAPI.readNote).toHaveBeenCalledWith('Documents/Sermons/Romans 8.bn');
    expect(args.setCurrentNote).toHaveBeenCalledWith(expect.objectContaining({ title: 'Romans 8' }));
    expect(args.setCurrentNotePath).toHaveBeenCalledWith('Documents/Sermons/Romans 8.bn');
    expect(args.setView).toHaveBeenCalledWith('editor');
    expect(args.setSideTab).toHaveBeenCalledWith('recent');
    expect(resetContent).toHaveBeenCalledWith('<p>Nothing can separate us…</p>');
    expect(args.loadDirectory).not.toHaveBeenCalled();
  });

  it('reads an absolute remembered path with readNoteAbsolute', async () => {
    setNotesPanelNavState(PANEL, { ...SAVED, currentNotePath: 'C:/Users/pete/Notes/Romans 8.bn' });
    const args = baseArgs();

    await mount(args);

    expect(fileNotesAPI.readNoteAbsolute).toHaveBeenCalledWith('C:/Users/pete/Notes/Romans 8.bn');
    expect(fileNotesAPI.readNote).not.toHaveBeenCalled();
  });

  it('falls back to the remembered folder when the note file is gone', async () => {
    vi.mocked(fileNotesAPI.readNote).mockResolvedValue(null);
    setNotesPanelNavState(PANEL, SAVED);
    const args = baseArgs();

    await mount(args);

    expect(args.loadDirectory).toHaveBeenCalledWith('Documents/Sermons');
    expect(args.setView).not.toHaveBeenCalledWith('editor');
    expect(args.setCurrentNote).not.toHaveBeenCalled();
    // The sub-tab is still restored - it doesn't depend on the note existing.
    expect(args.setSideTab).toHaveBeenCalledWith('recent');
  });

  it('falls back to the remembered folder when reading the note throws', async () => {
    // The fallback is deliberately noisy in the log and silent in the UI.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(fileNotesAPI.readNote).mockRejectedValue(new Error('ENOENT'));
    setNotesPanelNavState(PANEL, SAVED);
    const args = baseArgs();

    await expect(mount(args)).resolves.toBeDefined();

    expect(args.loadDirectory).toHaveBeenCalledWith('Documents/Sermons');
    expect(args.setShowSetup).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back to the notes root when the remembered folder is gone too', async () => {
    vi.mocked(fileNotesAPI.readNote).mockResolvedValue(null);
    setNotesPanelNavState(PANEL, { ...SAVED, currentPath: '' });
    const args = baseArgs();

    await mount(args);

    expect(args.loadDirectory).toHaveBeenCalledWith('');
  });

  it('stays in the browser when that is where the panel was left', async () => {
    // currentNotePath survives a "back to the folder" navigation, so the view
    // is what decides whether the editor reopens.
    setNotesPanelNavState(PANEL, { ...SAVED, view: 'browser' });
    const args = baseArgs();

    await mount(args);

    expect(args.loadDirectory).toHaveBeenCalledWith('Documents/Sermons');
    expect(fileNotesAPI.readNote).not.toHaveBeenCalled();
  });

  it('opens at the notes root when nothing was remembered for this panel', async () => {
    const args = baseArgs();

    await mount(args);

    expect(args.loadDirectory).toHaveBeenCalledWith('');
    expect(args.setSideTab).not.toHaveBeenCalled();
  });

  it('shows the setup dialog (and restores nothing) when notes are not initialised', async () => {
    vi.mocked(fileNotesAPI.isInitialized).mockResolvedValue(false);
    setNotesPanelNavState(PANEL, SAVED);
    const args = baseArgs();

    await mount(args);

    expect(args.setShowSetup).toHaveBeenCalledWith(true);
    expect(args.loadDirectory).not.toHaveBeenCalled();
    expect(fileNotesAPI.readNote).not.toHaveBeenCalled();
  });
});

describe('useNotesInit - registering the position', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileNotesStore.setState({ notesDirectory: 'C:/Users/pete/Notes', recentFiles: [], panelNavStates: {} });
    vi.mocked(fileNotesAPI.isInitialized).mockResolvedValue(true);
    vi.mocked(fileNotesAPI.readNote).mockResolvedValue(makeNote());
  });

  it('does not overwrite the remembered position before the restore has run', async () => {
    setNotesPanelNavState(PANEL, SAVED);

    // No await: this is the state of the world on the first commit, which is
    // exactly when the registration effect fires.
    const { unmount } = renderHook((props: Args) => useNotesInit(props), { initialProps: baseArgs() });

    expect(getNotesPanelNavState(PANEL)).toEqual(SAVED);

    // Let the in-flight restore settle so its state update doesn't land after
    // the test has finished (React logs an act() warning against the next one).
    await act(async () => { await Promise.resolve(); });
    unmount();
  });

  it('records the position once the pane has navigated', async () => {
    const { rerender } = await mount(baseArgs());

    // The pane's own state catches up with what the restore asked for.
    await act(async () => {
      rerender(baseArgs({
        view: 'editor',
        sideTab: 'recent',
        currentPath: 'Documents/Sermons',
        currentNotePath: 'Documents/Sermons/Romans 8.bn',
        currentNote: makeNote(),
      }));
    });

    expect(getNotesPanelNavState(PANEL)).toEqual(SAVED);
  });

  it('keeps the position on unmount so a tab switch or a quit does not lose it', async () => {
    const { unmount } = await mount(baseArgs({ currentPath: 'Journal' }));

    unmount();

    expect(getNotesPanelNavState(PANEL)).toEqual({
      view: 'browser',
      sideTab: 'browse',
      currentPath: 'Journal',
      currentNotePath: '',
    });
  });

  it('does not register for a detached window, and restores from its handover instead', async () => {
    setNotesPanelNavState(PANEL, SAVED);
    const args = baseArgs({
      isDetached: true,
      initialView: 'editor',
      initialSideTab: 'browse',
      initialCurrentPath: 'Journal',
      initialCurrentNotePath: 'Journal/2026-09-02.bn',
    });

    await mount(args);

    expect(fileNotesAPI.readNote).toHaveBeenCalledWith('Journal/2026-09-02.bn');
    expect(args.setSideTab).toHaveBeenCalledWith('browse');
    // The main window's entry is untouched by the detached pane.
    expect(getNotesPanelNavState(PANEL)).toEqual(SAVED);
  });

  it('opens a note handed over by an older pop-out payload that carried no view', async () => {
    const args = baseArgs({
      isDetached: true,
      initialCurrentPath: 'Journal',
      initialCurrentNotePath: 'Journal/2026-09-02.bn',
    });

    await mount(args);

    expect(fileNotesAPI.readNote).toHaveBeenCalledWith('Journal/2026-09-02.bn');
    expect(args.setView).toHaveBeenCalledWith('editor');
  });
});
