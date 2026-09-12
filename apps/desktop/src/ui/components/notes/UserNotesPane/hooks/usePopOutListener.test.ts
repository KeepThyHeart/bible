/**
 * Unit tests for the notes pane's dual-edit guard.
 *
 * Notes are backed by files on disk, not by store state, so if the same note
 * stays open in the editor in both the main window and a popped-out window,
 * whichever saves last silently overwrites the other. `DockviewTabRenderer`
 * fires a `notes-pane-popped-out` event after a successful detach, and this
 * hook is what makes the *original* pane step back to the file browser.
 *
 * This is the one pop-out path that can lose user data, so the tests cover the
 * targeting (only the pane that was popped out reacts) and the save-before-exit
 * ordering as well as the happy path.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePopOutListener } from './usePopOutListener';

const PANEL = 'panel-notes-1';

let handleSaveNote: Mock;
let loadDirectory: Mock;

function baseArgs(overrides: Partial<Parameters<typeof usePopOutListener>[0]> = {}) {
  return {
    panelId: PANEL,
    isDetached: false,
    view: 'editor' as const,
    editorIsDirty: false,
    currentPath: 'C:/notes/romans',
    handleSaveNote,
    loadDirectory,
    ...overrides,
  };
}

/** Fire the event DockviewTabRenderer dispatches after a successful pop-out. */
function firePopOut(panelId: string = PANEL) {
  window.dispatchEvent(new CustomEvent('notes-pane-popped-out', { detail: { panelId } }));
}

beforeEach(() => {
  handleSaveNote = vi.fn();
  loadDirectory = vi.fn();
});

describe('usePopOutListener', () => {
  it('returns the in-place pane to the file browser when its panel pops out', () => {
    renderHook(() => usePopOutListener(baseArgs()));
    firePopOut();

    expect(loadDirectory).toHaveBeenCalledTimes(1);
    expect(loadDirectory).toHaveBeenCalledWith('C:/notes/romans');
  });

  it('saves first when the editor has unsaved changes', () => {
    renderHook(() => usePopOutListener(baseArgs({ editorIsDirty: true })));
    firePopOut();

    expect(handleSaveNote).toHaveBeenCalledTimes(1);
    // Ordering matters: leaving the editor before the save would drop the edit.
    expect(handleSaveNote.mock.invocationCallOrder[0])
      .toBeLessThan(loadDirectory.mock.invocationCallOrder[0]);
  });

  it('does not save when the editor is clean', () => {
    renderHook(() => usePopOutListener(baseArgs({ editorIsDirty: false })));
    firePopOut();

    expect(handleSaveNote).not.toHaveBeenCalled();
    expect(loadDirectory).toHaveBeenCalled();
  });

  it('ignores an event aimed at a different panel', () => {
    // Two notes panes can be open side by side; popping out one must not close
    // the other's editor.
    renderHook(() => usePopOutListener(baseArgs({ editorIsDirty: true })));
    firePopOut('some-other-panel');

    expect(handleSaveNote).not.toHaveBeenCalled();
    expect(loadDirectory).not.toHaveBeenCalled();
  });

  it('does nothing when the pane is already showing the browser', () => {
    renderHook(() => usePopOutListener(baseArgs({ view: 'browser', editorIsDirty: true })));
    firePopOut();

    expect(handleSaveNote).not.toHaveBeenCalled();
    expect(loadDirectory).not.toHaveBeenCalled();
  });

  it('does not listen at all inside the detached window', () => {
    // The detached copy is the one that should keep editing; if it listened it
    // would immediately close the editor it was just opened to show.
    renderHook(() => usePopOutListener(baseArgs({ isDetached: true, editorIsDirty: true })));
    firePopOut();

    expect(handleSaveNote).not.toHaveBeenCalled();
    expect(loadDirectory).not.toHaveBeenCalled();
  });

  it('tolerates an event with no detail', () => {
    renderHook(() => usePopOutListener(baseArgs()));

    expect(() => window.dispatchEvent(new CustomEvent('notes-pane-popped-out'))).not.toThrow();
    expect(loadDirectory).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount', () => {
    // A leaked listener would keep a closed pane's stale handlers alive and
    // could re-save an old buffer over a newer file.
    const { unmount } = renderHook(() => usePopOutListener(baseArgs()));
    unmount();
    firePopOut();

    expect(loadDirectory).not.toHaveBeenCalled();
  });

  it('acts on the latest path after a re-render', () => {
    const { rerender } = renderHook(
      (args: Parameters<typeof usePopOutListener>[0]) => usePopOutListener(args),
      { initialProps: baseArgs() }
    );

    rerender(baseArgs({ currentPath: 'C:/notes/psalms' }));
    firePopOut();

    expect(loadDirectory).toHaveBeenCalledWith('C:/notes/psalms');
    expect(loadDirectory).toHaveBeenCalledTimes(1);
  });

  it('reacts only once per pop-out event', () => {
    renderHook(() => usePopOutListener(baseArgs()));
    firePopOut();
    expect(loadDirectory).toHaveBeenCalledTimes(1);
  });
});
