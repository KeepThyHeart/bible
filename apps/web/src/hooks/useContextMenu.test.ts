/**
 * Unit tests for useContextMenu.
 *
 * Pattern: orchestration hook. The presentational half is covered by
 * `components/common/ContextMenuPopup.test.tsx`, which asserts that clicking
 * "Study" calls `onAction('study')`. That says nothing about what `'study'`
 * then *does*. This file covers that seam: action string in, event bus
 * traffic out.
 *
 * The menu once had an entry per study target and each of them opened a pane
 * still showing the previously selected verse. They are gone; what survives is
 * the ordering that made them wrong — select the right-clicked verse, load it,
 * then show the pane — which is what these tests pin down.
 *
 * The bus itself is real (it is a few lines of Map bookkeeping and mocking it
 * would only restate the implementation); `bibleStore` is mocked because the
 * only thing this hook asks of it is a single call.
 */
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/preact';

const adoptPreviewAsStudy = vi.fn();

vi.mock('../stores/bibleStore', () => ({
  bibleStore: {
    get adoptPreviewAsStudy() {
      return adoptPreviewAsStudy;
    },
  },
}));

import { useContextMenu } from './useContextMenu';
import { eventBus } from '../events/eventBus';

/** John 3:16 — book 43, chapter 3, verse 16. */
const VERSE_ID = 43003016;

interface Harness {
  action: (name: string) => void;
  setCopyOpen: ReturnType<typeof vi.fn>;
  setMobileView: ReturnType<typeof vi.fn>;
  emit: MockInstance<typeof eventBus.emit>;
}

/**
 * Renders the hook, opens the menu the way a user does — a real `contextmenu`
 * event on `document` — and returns a way to fire menu actions.
 *
 * Going through the listener rather than setting state directly is deliberate:
 * the hook's subscription to `document` is part of what it does, and a test
 * that reached past it would keep passing if the listener were never attached.
 */
function harness({ mobile = false }: { mobile?: boolean } = {}): Harness {
  const setCopyOpen = vi.fn();
  const setMobileView = vi.fn();
  const findVerseAtPoint = vi.fn(() => ({ el: document.body, verseId: VERSE_ID }));

  const { result } = renderHook(() =>
    useContextMenu(
      findVerseAtPoint,
      setCopyOpen,
      mobile ? setMobileView : undefined,
    ),
  );

  act(() => {
    document.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 240,
    }));
  });

  // Spy only after the menu is open, so the assertions see the action's
  // traffic and nothing from opening the menu.
  const emit = vi.spyOn(eventBus, 'emit');

  return {
    action: (name: string) => act(() => result.current.handleContextMenuAction(name)),
    setCopyOpen,
    setMobileView,
    emit,
  };
}

/** The paneId of the single `pane:show` emitted, or undefined if none was. */
function shownPane(emit: Harness['emit']): string | undefined {
  const calls = emit.mock.calls.filter(([name]) => name === 'pane:show');
  expect(calls.length).toBeLessThanOrEqual(1);
  return (calls[0]?.[1] as { paneId: string } | undefined)?.paneId;
}

function emittedNames(emit: Harness['emit']): string[] {
  return emit.mock.calls.map(([name]) => name as string);
}

beforeEach(() => {
  vi.restoreAllMocks();
  adoptPreviewAsStudy.mockClear();
});

describe('useContextMenu — opening the menu', () => {
  it('opens at the pointer when the click landed on a verse', () => {
    const { emit } = harness();
    expect(emit).toBeDefined();
  });

  it('does not open when the click landed outside a verse', () => {
    const setCopyOpen = vi.fn();
    const findVerseAtPoint = vi.fn(() => null);

    const { result } = renderHook(() =>
      useContextMenu(findVerseAtPoint, setCopyOpen),
    );

    act(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    expect(result.current.contextMenu).toBeNull();
  });

  it('leaves the browser menu alone when the click landed outside a verse', () => {
    const findVerseAtPoint = vi.fn(() => null);
    renderHook(() => useContextMenu(findVerseAtPoint, vi.fn()));

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
  });

  it('suppresses the browser menu when the click landed on a verse', () => {
    const findVerseAtPoint = vi.fn(() => ({ el: document.body, verseId: VERSE_ID }));
    renderHook(() => useContextMenu(findVerseAtPoint, vi.fn()));

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('useContextMenu — the study action', () => {
  it('opens the study pane', () => {
    const { action: fire, emit } = harness();
    fire('study');
    expect(shownPane(emit)).toBe('study');
  });

  it('expands the right pane so the study pane is visible when collapsed', () => {
    const { action: fire, emit } = harness();
    fire('study');
    expect(emittedNames(emit)).toContain('pane:expand');
  });

  it('adopts the right-clicked verse as the study verse', () => {
    const { action: fire } = harness();
    fire('study');
    expect(adoptPreviewAsStudy).toHaveBeenCalledWith(VERSE_ID);
  });

  it('loads the right-clicked verse, not the chapter', () => {
    const { action: fire, emit } = harness();
    fire('study');

    expect(emit).toHaveBeenCalledWith('study:load-verse', {
      verseId: VERSE_ID,
      book: 43,
      chapter: 3,
      verse: 16,
    });
    expect(emittedNames(emit)).not.toContain('commentary:load-chapter');
  });

  it('emits the verse load even when that verse is already selected', () => {
    // adoptPreviewAsStudy alone is not enough: useAppShared only emits
    // bible:verse-selected when studyVerse *changes*, so right-clicking the
    // already-selected verse would otherwise open an empty pane.
    const { action: fire, emit } = harness();
    fire('study');
    expect(emittedNames(emit)).toContain('study:load-verse');
  });

  it('selects the verse before showing the pane', () => {
    // The reported defect: the Study pane opened on whatever verse had been
    // selected before the right-click. Ordering is the fix, so it is asserted.
    const { action: fire, emit } = harness();
    fire('study');

    const showIndex = emittedNames(emit).indexOf('pane:show');
    expect(showIndex).toBeGreaterThanOrEqual(0);
    expect(adoptPreviewAsStudy).toHaveBeenCalledWith(VERSE_ID);
    expect(emittedNames(emit).indexOf('study:load-verse')).toBeLessThan(showIndex);
  });

  it('closes the menu once an action has been taken', () => {
    const setCopyOpen = vi.fn();
    const findVerseAtPoint = vi.fn(() => ({ el: document.body, verseId: VERSE_ID }));
    const { result } = renderHook(() => useContextMenu(findVerseAtPoint, setCopyOpen));

    act(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(result.current.contextMenu).not.toBeNull();

    act(() => result.current.handleContextMenuAction('study'));
    expect(result.current.contextMenu).toBeNull();
  });

  it('ignores an unknown action rather than opening an empty pane', () => {
    const { action: fire, emit } = harness();
    fire('nonsense');
    expect(emittedNames(emit)).toEqual([]);
    expect(adoptPreviewAsStudy).not.toHaveBeenCalled();
  });

  it.each(['crossrefs', 'topics', 'commentary', 'dictionary'])(
    'no longer handles the retired %s action',
    (action) => {
      // These four collapsed into `study`. Left in place they would keep
      // opening panes on the previously selected verse.
      const { action: fire, emit } = harness();
      fire(action);
      expect(emittedNames(emit)).toEqual([]);
      expect(adoptPreviewAsStudy).not.toHaveBeenCalled();
    },
  );
});

describe('useContextMenu — copy', () => {
  it('opens the copy dialog without touching the right pane', () => {
    const { action: fire, setCopyOpen, emit } = harness();
    fire('copy');

    expect(setCopyOpen).toHaveBeenCalledWith(true);
    expect(emittedNames(emit)).toEqual([]);
  });

  it('adopts the right-clicked verse so the dialog opens on it', () => {
    const { action: fire } = harness();
    fire('copy');
    expect(adoptPreviewAsStudy).toHaveBeenCalledWith(VERSE_ID);
  });
});

describe('useContextMenu — mobile view switching', () => {
  it('switches the mobile view to the study hub', () => {
    const { action: fire, setMobileView } = harness({ mobile: true });
    fire('study');
    expect(setMobileView).toHaveBeenCalledWith('study');
  });

  it('does not switch views for copy', () => {
    const { action: fire, setMobileView } = harness({ mobile: true });
    fire('copy');
    expect(setMobileView).not.toHaveBeenCalled();
  });

  it('is optional — desktop passes no setter and must not throw', () => {
    const { action: fire } = harness({ mobile: false });
    expect(() => fire('study')).not.toThrow();
  });
});
