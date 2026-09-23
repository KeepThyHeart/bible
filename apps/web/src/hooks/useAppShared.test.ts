/**
 * Unit tests for useAppShared.
 *
 * This hook is the web app's orchestration hub: it owns the rules that tie the
 * display mode to the right pane's visibility, decide when a verse selection is
 * broadcast on the event bus, and route global keyboard shortcuts. Every one of
 * those is a "the app quietly did the wrong thing" rule rather than something a
 * component test would notice, and its own comments record two bugs already
 * fixed here — the mode switch that left the study pane collapsed, and the
 * preview navigation that emitted a verse from the previous chapter.
 *
 * The stores are replaced with fakes that keep the real observer contract
 * (`subscribe` returning an unsubscribe), so `useStore` drives re-renders the
 * way it does in the app. `eventBus` and `focusSearchField` are real.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/preact';

/**
 * John 3:16 and its chapter, plus Psalm 3:1 for the "verse from another
 * chapter" cases. Declared inside the hoisted block because `vi.hoisted` runs
 * before the module's own `const`s are initialized.
 */
const h = vi.hoisted(() => {
  const JOHN = 43;
  class FakeStore {
    private listeners = new Set<() => void>();
    subscribe(listener: () => void): () => void {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    /** Apply a change and tell subscribers, the way the real stores do. */
    update(mutate: () => void): void {
      mutate();
      this.listeners.forEach(fn => fn());
    }
  }

  interface Tab {
    id: string;
    book?: number;
    chapter?: number;
    displayMode?: string;
    moduleAbbr?: string;
    studyVerse?: number | null;
    previewVerse?: number | null;
    verses?: Array<{ verse_id: number; footnotes?: unknown }>;
  }

  class FakeBibleStore extends FakeStore {
    activeTab: Tab | null = { id: 'tab-1', book: JOHN, chapter: 3, displayMode: 'standard' };
    navigateFromHash = vi.fn();
    getActiveTab(): Tab | null {
      return this.activeTab;
    }
    /**
     * Mirrors the real store rather than stubbing a constant: "already there"
     * means module, book, chapter AND loaded verses all agree with the hash,
     * and the hook's whole behaviour turns on that distinction.
     */
    matchesHash(hash: string): boolean {
      const m = hash.match(/^#\/([^/]+)\/(\d+)\/(\d+)(?:\/(\d+))?$/);
      const tab = this.activeTab;
      return !!m && !!tab
        && tab.moduleAbbr === m[1]
        && tab.book === Number(m[2])
        && tab.chapter === Number(m[3])
        && (tab.verses?.length ?? 0) > 0;
    }
  }

  class FakeCommentaryStore extends FakeStore {
    collapsed = false;
    rightPaneMode = 'commentary';
    collapse = vi.fn();
    expand = vi.fn();
  }

  class FakeSearchStore extends FakeStore {
    isOpen = false;
    searchSeq = 0;
  }

  class FakeSettingsStore extends FakeStore {
    fontSize = 18;
    lineHeight = 1.7;
    studyLineHeight = 1.6;
    studyFontSize = 16;
    studyFontFamily = 'serif';
    fontFamily = 'serif';
    headingFontFamily = 'sans-serif';
  }

  return {
    JOHN,
    JOHN_3_16: 43003016,
    JOHN_3_1: 43003001,
    PSALM_3_1: 19003001,
    bibleStore: new FakeBibleStore(),
    commentaryStore: new FakeCommentaryStore(),
    searchStore: new FakeSearchStore(),
    settingsStore: new FakeSettingsStore(),
    hasBindings: vi.fn(() => false),
    handleKeyEvent: vi.fn(),
  };
});

const { JOHN, JOHN_3_16, JOHN_3_1, PSALM_3_1 } = h;

vi.mock('../stores/bibleStore', () => ({ bibleStore: h.bibleStore }));
vi.mock('../stores/commentaryStore', () => ({ commentaryStore: h.commentaryStore }));
vi.mock('../stores/searchStore', () => ({ searchStore: h.searchStore }));
vi.mock('../stores/settingsStore', () => ({ settingsStore: h.settingsStore }));
vi.mock('../plugins/registries/KeybindingRegistry', () => ({
  keybindingRegistry: {
    hasBindings: h.hasBindings,
    handleKeyEvent: h.handleKeyEvent,
  },
}));

import { useAppShared } from './useAppShared';
import { eventBus } from '../events/eventBus';

const STRONGS_ENTRY = { strongsNumber: 'G2316', word: 'θεός', definition: 'God' };

function providers(getEntry = vi.fn(async () => STRONGS_ENTRY)) {
  return { strongs: { getEntry } } as never;
}

/** Render the hook with the current fake-store state. */
function render(deps = providers()) {
  return renderHook(() => useAppShared(deps));
}

/** Replace the active tab and let the subscribers re-render. */
function setTab(patch: Record<string, unknown>): void {
  act(() => {
    h.bibleStore.update(() => {
      h.bibleStore.activeTab = { ...h.bibleStore.activeTab, ...patch } as never;
    });
  });
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.bibleStore.activeTab = { id: 'tab-1', book: JOHN, chapter: 3, displayMode: 'standard' };
  h.commentaryStore.collapsed = false;
  h.hasBindings.mockReturnValue(false);
  document.body.innerHTML = '';
  window.location.hash = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('display mode drives the right pane', () => {
  it('collapses the pane in reading mode', () => {
    h.bibleStore.activeTab = { id: 'tab-1', book: JOHN, chapter: 3, displayMode: 'reading' };
    render();

    expect(h.commentaryStore.collapse).toHaveBeenCalled();
  });

  it('does not expand on first render', () => {
    // On mount the persisted collapsed state is the user's own choice; forcing
    // the pane open would throw it away on every reload.
    h.commentaryStore.collapsed = true;
    render();

    expect(h.commentaryStore.expand).not.toHaveBeenCalled();
  });

  it('expands again when leaving reading mode', () => {
    h.bibleStore.activeTab = { id: 'tab-1', book: JOHN, chapter: 3, displayMode: 'reading' };
    render();
    h.commentaryStore.expand.mockClear();

    setTab({ displayMode: 'standard' });

    expect(h.commentaryStore.expand).toHaveBeenCalled();
  });

  it('expands on any transition between non-reading modes', () => {
    render();

    setTab({ displayMode: 'study' });

    expect(h.commentaryStore.expand).toHaveBeenCalled();
  });

  it('does nothing when the mode is unchanged', () => {
    render();
    h.commentaryStore.expand.mockClear();
    h.commentaryStore.collapse.mockClear();

    setTab({ chapter: 4 });

    expect(h.commentaryStore.expand).not.toHaveBeenCalled();
    expect(h.commentaryStore.collapse).not.toHaveBeenCalled();
  });

  it('collapses whenever reading mode is entered, not only on the first switch', () => {
    render();

    setTab({ displayMode: 'reading' });
    expect(h.commentaryStore.collapse).toHaveBeenCalledTimes(1);

    setTab({ displayMode: 'standard' });
    setTab({ displayMode: 'reading' });
    expect(h.commentaryStore.collapse).toHaveBeenCalledTimes(2);
  });
});

describe("Strong's popup and tooltip", () => {
  it('opens the popup for a clicked number', async () => {
    const { result } = render();

    await act(async () => {
      await result.current.handleStrongsClick('G2316');
    });

    expect(result.current.strongsPopup?.entry).toBe(STRONGS_ENTRY);
  });

  it('leaves no popup when the lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error('no dictionary');
    });
    const { result } = render(providers(failing as never));

    await act(async () => {
      await result.current.handleStrongsClick('G2316');
    });

    expect(result.current.strongsPopup).toBeNull();
  });

  it('shows a tooltip on hover', async () => {
    const { result } = render();

    await act(async () => {
      await result.current.handleStrongsHover('G2316', new DOMRect(10, 20, 30, 40));
    });

    expect(result.current.strongsTooltip?.entry).toBe(STRONGS_ENTRY);
  });

  it('suppresses the hover tooltip while the popup is open', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.handleStrongsClick('G2316');
    });

    await act(async () => {
      await result.current.handleStrongsHover('G2316', new DOMRect());
    });

    expect(result.current.strongsTooltip).toBeNull();
  });

  it('does not show a tooltip for a hover the pointer already left', async () => {
    // The lookup is async: leaving before it resolves has to cancel it, or a
    // tooltip appears next to a word the pointer is no longer on.
    let resolve!: (entry: typeof STRONGS_ENTRY) => void;
    const pending = vi.fn(() => new Promise(r => { resolve = r as never; }));
    const { result } = render(providers(pending as never));

    let hover!: Promise<void>;
    act(() => {
      hover = result.current.handleStrongsHover('G2316', new DOMRect());
    });
    act(() => {
      result.current.handleStrongsLeave();
    });
    await act(async () => {
      resolve(STRONGS_ENTRY);
      await hover;
    });

    expect(result.current.strongsTooltip).toBeNull();
  });

  it('dismisses both when the display mode changes', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.handleStrongsClick('G2316');
    });
    expect(result.current.strongsPopup).not.toBeNull();

    setTab({ displayMode: 'study' });

    expect(result.current.strongsPopup).toBeNull();
    expect(result.current.strongsTooltip).toBeNull();
  });

  it('clears the tooltip when the chapter changes', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.handleStrongsHover('G2316', new DOMRect());
    });
    expect(result.current.strongsTooltip).not.toBeNull();

    setTab({ chapter: 4 });

    expect(result.current.strongsTooltip).toBeNull();
  });
});

describe('keyboard shortcuts', () => {
  const searchField = (): HTMLInputElement => {
    const input = document.createElement('input');
    input.className = 'header__search-field';
    document.body.appendChild(input);
    return input;
  };

  it('opens the copy dialog on Ctrl+C when nothing is selected', () => {
    const { result } = render();

    const event = press({ key: 'c', ctrlKey: true });

    expect(result.current.copyOpen).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Ctrl+C alone when there is a text selection', () => {
    // Otherwise the shortcut steals an ordinary copy of selected verse text.
    const { result } = render();
    document.body.innerHTML = '<p>some selected text</p>';
    const range = document.createRange();
    range.selectNodeContents(document.body.firstChild!);
    window.getSelection()!.addRange(range);

    press({ key: 'c', ctrlKey: true });

    expect(result.current.copyOpen).toBe(false);
    window.getSelection()!.removeAllRanges();
  });

  it.each([
    ['Ctrl+K', { key: 'k', ctrlKey: true }],
    ['Cmd+K', { key: 'k', metaKey: true }],
    ['Ctrl+G', { key: 'g', ctrlKey: true }],
    ['slash', { key: '/' }],
  ])('focuses the search field on %s', (_label, init) => {
    const input = searchField();
    render();

    const event = press(init);

    expect(document.activeElement).toBe(input);
    expect(event.defaultPrevented).toBe(true);
  });

  it('selects the existing query rather than appending to it', () => {
    // Pressing "/" and typing should replace the previous search; a plain
    // focus() leaves the caret at the end and searches for both queries joined.
    const input = searchField();
    input.value = 'previous query';
    render();

    press({ key: '/' });

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('previous query'.length);
  });

  it('ignores a bare slash typed into an input', () => {
    const input = searchField();
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    render();

    press({ key: '/' });

    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(input);
  });

  it('ignores a bare slash typed into a textarea', () => {
    searchField();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    render();

    press({ key: '/' });

    expect(document.activeElement).toBe(textarea);
  });

  it('ignores slash combinations meant for the browser', () => {
    const input = searchField();
    render();

    press({ key: '/', ctrlKey: true });

    expect(document.activeElement).not.toBe(input);
  });

  it('delegates to the plugin keybinding registry only when it has bindings', () => {
    render();

    press({ key: 'x' });
    expect(h.handleKeyEvent).not.toHaveBeenCalled();

    h.hasBindings.mockReturnValue(true);
    press({ key: 'x' });
    expect(h.handleKeyEvent).toHaveBeenCalled();
  });

  it('stops listening once unmounted', () => {
    h.hasBindings.mockReturnValue(true);
    const { unmount } = render();
    unmount();

    press({ key: 'x' });

    expect(h.handleKeyEvent).not.toHaveBeenCalled();
  });
});

describe('broadcasting the selected verse', () => {
  let emit: MockInstance<typeof eventBus.emit>;

  beforeEach(() => {
    emit = vi.spyOn(eventBus, 'emit');
  });

  afterEach(() => {
    emit.mockRestore();
  });

  const selections = () =>
    emit.mock.calls.filter(([name]) => name === 'bible:verse-selected').map(([, payload]) => payload);

  it('announces the study verse', () => {
    h.bibleStore.activeTab = {
      id: 'tab-1', book: JOHN, chapter: 3, displayMode: 'standard', studyVerse: JOHN_3_16,
    };
    render();

    expect(selections()).toContainEqual(
      expect.objectContaining({ verseId: JOHN_3_16, book: JOHN, chapter: 3, verse: 16 }),
    );
  });

  it('carries the footnotes of that verse', () => {
    const footnotes = [{ position: 3, marker: 'a', text: 'Or: only begotten' }];
    h.bibleStore.activeTab = {
      id: 'tab-1',
      book: JOHN,
      chapter: 3,
      displayMode: 'standard',
      studyVerse: JOHN_3_16,
      verses: [{ verse_id: JOHN_3_1 }, { verse_id: JOHN_3_16, footnotes }],
    };
    render();

    expect(selections()).toContainEqual(expect.objectContaining({ footnotes }));
  });

  it('says nothing while the study verse belongs to another chapter', () => {
    // Mid preview-navigation the tab's book/chapter have moved but studyVerse
    // has not; emitting here sends the study panes a verse id that does not
    // match the book and chapter beside it.
    h.bibleStore.activeTab = {
      id: 'tab-1', book: JOHN, chapter: 3, displayMode: 'standard', studyVerse: PSALM_3_1,
    };
    render();

    expect(selections()).toEqual([]);
  });

  it('falls back to verse 1 when no verse is selected', () => {
    render();

    expect(selections()).toContainEqual(
      expect.objectContaining({ verseId: JOHN_3_1, book: JOHN, chapter: 3, verse: 1 }),
    );
  });

  it('withholds the fallback during preview navigation', () => {
    // previewVerse set means the reader is peeking at a chapter they have not
    // committed to, so the study panes should stay on the verse they were on.
    h.bibleStore.activeTab = {
      id: 'tab-1', book: JOHN, chapter: 3, displayMode: 'standard', previewVerse: JOHN_3_16,
    };
    render();

    expect(selections()).toEqual([]);
  });

  it('says nothing when there is no active tab', () => {
    h.bibleStore.activeTab = null;
    render();

    expect(selections()).toEqual([]);
  });
});

describe('hash navigation', () => {
  it('navigates to the hash present on mount', () => {
    window.location.hash = '#/John/3/16';
    render();

    expect(h.bibleStore.navigateFromHash).toHaveBeenCalledWith('#/John/3/16');
  });

  it('does not navigate when there is no hash', () => {
    render();

    expect(h.bibleStore.navigateFromHash).not.toHaveBeenCalled();
  });

  it('does not re-navigate to a hash the store has already resolved', () => {
    // main.tsx resolves the opening hash before the first render, so this is
    // the normal state at mount: the tab is already on the reference and its
    // verses are loaded. Navigating again re-fetched a chapter that was on
    // screen — one wasted chapter request per cold load.
    h.bibleStore.activeTab = {
      id: 'tab-1',
      moduleAbbr: 'KJV',
      book: JOHN,
      chapter: 3,
      displayMode: 'standard',
      verses: [{ verse_id: 43003001 }],
    };
    window.location.hash = `#/KJV/${JOHN}/3`;

    render();

    expect(h.bibleStore.navigateFromHash).not.toHaveBeenCalled();
  });

  it('still navigates when the tab points at the hash but has no verses yet', () => {
    // A restored session can name the reference before its text has arrived.
    // That is not "already there", and skipping it would leave the pane empty.
    h.bibleStore.activeTab = {
      id: 'tab-1',
      moduleAbbr: 'KJV',
      book: JOHN,
      chapter: 3,
      displayMode: 'standard',
      verses: [],
    };
    window.location.hash = `#/KJV/${JOHN}/3`;

    render();

    expect(h.bibleStore.navigateFromHash).toHaveBeenCalledWith(`#/KJV/${JOHN}/3`);
  });

  it('follows later hash changes', () => {
    render();

    window.location.hash = '#/Psalm/23';
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(h.bibleStore.navigateFromHash).toHaveBeenCalledWith('#/Psalm/23');
  });

  it('stops following once unmounted', () => {
    const { unmount } = render();
    unmount();

    window.location.hash = '#/Psalm/23';
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(h.bibleStore.navigateFromHash).not.toHaveBeenCalled();
  });
});

describe('findVerseAtPoint', () => {
  /** Lay out three verses as 20px-tall rows, since jsdom/happy-dom has no layout. */
  function verseColumn(): HTMLElement[] {
    document.body.innerHTML = `
      <div class="bible-content">
        <div class="verse" data-verse-id="43003001"></div>
        <div class="verse" data-verse-id="43003002"></div>
        <div class="verse" data-verse-id="43003003"></div>
      </div>`;
    const verses = Array.from(document.querySelectorAll<HTMLElement>('.verse'));
    verses.forEach((el, i) => {
      el.getBoundingClientRect = () => ({ top: i * 20, height: 20, bottom: i * 20 + 20 }) as DOMRect;
    });
    return verses;
  }

  it('returns the verse the point is inside', () => {
    const verses = verseColumn();
    const { result } = render();

    expect(result.current.findVerseAtPoint(verses[1], 0, 30)).toEqual({
      el: verses[1],
      verseId: 43003002,
    });
  });

  it('walks up from a child element to its verse', () => {
    const verses = verseColumn();
    const word = document.createElement('span');
    verses[2].appendChild(word);
    const { result } = render();

    expect(result.current.findVerseAtPoint(word, 0, 50)?.verseId).toBe(43003003);
  });

  it('falls back to the vertically nearest verse when the point is between them', () => {
    // Right-clicking the gap between verses should still act on a verse rather
    // than doing nothing.
    verseColumn();
    const content = document.querySelector<HTMLElement>('.bible-content')!;
    const { result } = render();

    expect(result.current.findVerseAtPoint(content, 0, 8)?.verseId).toBe(43003001);
    expect(result.current.findVerseAtPoint(content, 0, 55)?.verseId).toBe(43003003);
  });

  it('returns null outside the bible content', () => {
    verseColumn();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const { result } = render();

    expect(result.current.findVerseAtPoint(outside, 0, 30)).toBeNull();
  });

  it('returns null when the content area holds no verses', () => {
    document.body.innerHTML = '<div class="bible-content"></div>';
    const content = document.querySelector<HTMLElement>('.bible-content')!;
    const { result } = render();

    expect(result.current.findVerseAtPoint(content, 0, 30)).toBeNull();
  });
});
