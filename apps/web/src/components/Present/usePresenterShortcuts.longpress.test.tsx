// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { presentStore } from '../../stores/presentStore';
import { bibleStore } from '../../stores/bibleStore';
import type { PresentState } from '../../present/protocol';
import { LONG_PRESS_MS, usePresenterShortcuts } from './usePresenterShortcuts';

/**
 * A bare next/previous key on a passage: a plain press steps one verse (on
 * release), a held one jumps a section (once, at the threshold), and either
 * way the Bible pane follows the wall. On anything but a passage the press
 * acts at once.
 */

function Harness() {
  usePresenterShortcuts();
  return null;
}

function wallOn(live: PresentState['live'], index: number): PresentState {
  return {
    version: 3,
    live,
    position: { index, highlight: null },
    display: { fontStep: 5, blanked: false, theme: 'light' },
    session: { id: 's', joinCode: 'ABCD2345', joinsLocked: false, viewerCount: 1 },
  };
}

const PASSAGE = { kind: 'passage' as const, module: 'KJV', book: 43, chapter: 3 };
const VERSES = Array.from({ length: 30 }, (_, i) => ({
  verse: i + 1,
  verse_id: 43003000 + i + 1,
  section_heading: [1, 11, 21].includes(i + 1) ? 'H' : null,
}));

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
  window.dispatchEvent(event);
  return event;
}
const release = (key: string): void => { window.dispatchEvent(new KeyboardEvent('keyup', { key })); };

describe('bare next/previous keys while presenting', () => {
  let step: ReturnType<typeof vi.spyOn>;
  let goTo: ReturnType<typeof vi.spyOn>;
  let focus: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    presentStore.session = { sessionId: 's', joinCode: 'ABCD2345', controlToken: 't', expiresAt: '' };
    presentStore.wall = wallOn(PASSAGE, 12);
    presentStore.acceptClickerKeys = true;
    step = vi.spyOn(presentStore, 'step').mockResolvedValue(true);
    goTo = vi.spyOn(presentStore, 'goTo').mockResolvedValue(true);
    focus = vi.spyOn(bibleStore, 'focusVerseNumber').mockImplementation(() => {});
    vi.spyOn(bibleStore, 'getActiveTab').mockReturnValue(
      { book: 43, chapter: 3, verses: VERSES, studyVerse: 43003012 } as never,
    );
    render(<Harness />);
  });

  afterEach(() => {
    cleanup();
    presentStore.session = null;
    presentStore.wall = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('steps one verse on a plain press, when the key is released', () => {
    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(true);
    expect(step).not.toHaveBeenCalled();
    release('ArrowDown');
    expect(step).toHaveBeenCalledWith('next');
    expect(goTo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2 * LONG_PRESS_MS);
    expect(goTo).not.toHaveBeenCalled();
  });

  it('jumps a section on a long press, once, and not again on release', () => {
    press('ArrowDown');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(goTo).toHaveBeenCalledWith(21);
    // Auto-repeat while held is swallowed, not scrolled or re-fired.
    const repeat = new KeyboardEvent('keydown', { key: 'ArrowDown', repeat: true, cancelable: true });
    window.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    release('ArrowDown');
    expect(step).not.toHaveBeenCalled();
    expect(goTo).toHaveBeenCalledTimes(1);
  });

  it('jumps back to the start of the current section on a long press of Up', () => {
    press('ArrowUp');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(goTo).toHaveBeenCalledWith(11);
  });

  it('takes the Bible pane along with the wall', () => {
    press('PageDown');
    release('PageDown');
    expect(focus).toHaveBeenCalledWith(12);
  });

  it('acts at once on a hymn: there is no section to hold for', () => {
    presentStore.wall = wallOn({ kind: 'hymn', hymnId: 'amazing-grace' }, 0);
    press('ArrowDown');
    expect(step).toHaveBeenCalledWith('next');
    release('ArrowDown');
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('moves only the study verse when nothing is on the wall', () => {
    presentStore.wall = wallOn(null, 0);
    const study = vi.spyOn(bibleStore, 'stepStudyVerse').mockImplementation(() => {});
    press('ArrowDown');
    expect(study).toHaveBeenCalledWith('next');
    expect(step).not.toHaveBeenCalled();
  });
});
