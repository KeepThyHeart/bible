import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  notes: { status: 'ready', rows: [] as unknown[], folderName: 'Romans', translation: 'KJV', moduleId: 7 } as Record<string, unknown>,
  notesArgs: [] as Array<Record<string, unknown>>,
  activations: [] as Array<{ verse: number; focus: boolean | undefined }>,
  flush: vi.fn(async () => {}),
  deactivate: vi.fn(async () => {}),
  compile: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('./useChapterNotes', () => ({
  useChapterNotes: (args: Record<string, unknown>) => {
    h.notesArgs.push(args);
    return { ...h.notes, setRecord: vi.fn(), reload: vi.fn() };
  },
}));
vi.mock('./useChapterActiveEditor', async () => {
  const R = await import('react');
  return {
    useChapterActiveEditor: () => {
      const [active, setActive] = R.useState<unknown>(null);
      return {
        active,
        activate: async (t: { verseId: number; verse: number }, o?: { focus?: boolean }) => {
          h.activations.push({ verse: t.verse, focus: o?.focus });
          setActive({ verseId: t.verseId, html: '', dirty: false, saving: false, loading: false, conflict: null, autoFocus: !!o?.focus });
        },
        deactivate: async () => { await h.deactivate(); setActive(null); },
        flush: () => h.flush(),
        setHtml: vi.fn(), normalize: vi.fn(), resolveConflict: vi.fn(),
        preserveSelectionFlag: { get: () => false, clear: () => {} },
      };
    },
  };
});
vi.mock('../editor/NoteEditor', () => ({
  default: (p: { autoFocus?: boolean }) => <div className="ProseMirror" data-testid="editor-stub" data-autofocus={String(!!p.autoFocus)} tabIndex={0} />,
}));
vi.mock('../../VersePreviewTooltip', () => ({ default: () => null }));
vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k), locale: 'en', i18n: {} }),
}));
vi.mock('../../../utils/commentaryLinkProcessor', () => ({ reprocessCommentaryLinks: (x: string) => x }));
vi.mock('../../../stores/crossStoreBridge', () => ({
  navigateToVerseInPrimary: (...a: unknown[]) => h.navigate(...a),
  previewVerseInPrimary: vi.fn(),
}));
vi.mock('../../../services/compile/compileRequest', () => ({ requestCompilePassageNotes: (...a: unknown[]) => h.compile(...a) }));
vi.mock('../../../utils/verseReference', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../utils/verseReference')>()),
  getBookNameFromCache: (b: number) => (b === 45 ? 'Romans' : `Book${b}`),
}));
vi.mock('./chapterTitle', () => ({ chapterTitle: (s: { book: number; chapter: number }) => `T${s.book}:${s.chapter}` }));

import ChapterNotesView, { type ChapterNotesHandle } from './ChapterNotesView';
import type { ChapterModeNavState } from '../../../stores/notesChapterNavState';
import { useNotesStore } from '../../../stores/useNotesStore';
import { useBibleStore } from '../../../stores/useBibleStore';
import { useTextSettingsStore } from '../../../stores/useTextSettingsStore';

const vid = (v: number, b = 45, c = 8) => b * 1000000 + c * 1000 + v;
const rec = (verse: number, html: string) => ({ bookName: 'Romans', chapter: 8, verse, relativePath: `Verse Notes/Romans/8/${verse}.bn`, note: { content: html, updated: 't' } });
const mkRows = (withNotes: number[]) => [1, 2, 3].map(v => ({
  verseId: vid(v), verse: v,
  verseHtml: v === 2 ? '<span class="christ-words">Jesus said</span>' : `text ${v}`,
  record: withNotes.includes(v) ? rec(v, `<p>note ${v} <a href="#verse-${vid(1)}">link</a></p>`) : null,
}));

const base = (over: Partial<ChapterModeNavState> = {}): ChapterModeNavState => ({ book: 45, chapter: 8, follow: false, onlyWithNotes: false, ...over });

let states: ChapterModeNavState[] = [];
function Host(props: { initial: ChapterModeNavState; handleRef?: React.MutableRefObject<ChapterNotesHandle | null>; onExit?: (v: number | null) => void; onCompile?: (r: string) => void; onPopOut?: () => void; isDetached?: boolean }) {
  const [state, setState] = useState(props.initial);
  states = [state];
  return (
    <ChapterNotesView
      panelId="p1" isDetached={props.isDetached ?? false} state={state} onPopOut={props.onPopOut}
      onStateChange={u => setState(prev => { const n = u(prev); states.push(n); return n; })}
      onExitToSingle={props.onExit ?? vi.fn()} onCompile={props.onCompile} handleRef={props.handleRef}
    />
  );
}
const last = () => states[states.length - 1];

beforeEach(() => {
  h.notes = { status: 'ready', rows: mkRows([1, 3]), folderName: 'Romans', translation: 'KJV', moduleId: 7 };
  h.notesArgs = [];
  h.activations = [];
  h.flush.mockClear(); h.deactivate.mockClear(); h.compile.mockClear(); h.navigate.mockClear();
  useNotesStore.setState({ panels: new Map() });
  useBibleStore.setState({ panels: new Map(), availableBibles: [] } as never);
  useTextSettingsStore.getState().updateSettings('bible', { showRedLetter: true });
});

describe('ChapterNotesView rows', () => {
  it('renders the verse html as the Bible pane does (christ-words kept) and shows red-letter wrapper state', () => {
    const { container } = render(<Host initial={base()} />);
    expect(container.querySelector('.christ-words')).not.toBeNull();
    expect(screen.getByTestId('chapter-verse-text-2').textContent).toContain('Jesus said');
    const text = screen.getByTestId('chapter-verse-text-2');
    expect(text.classList.contains('pane-content-bible')).toBe(true);
    expect(text.classList.contains('no-red-letter')).toBe(false);
    expect(text.style.getPropertyValue('--pane-font-size-bible')).not.toBe('');
  });

  it('adds no-red-letter when red letters are off', () => {
    useTextSettingsStore.getState().updateSettings('bible', { showRedLetter: false });
    render(<Host initial={base()} />);
    expect(screen.getByTestId('chapter-verse-text-1').classList.contains('no-red-letter')).toBe(true);
  });

  it('has a single editor even with several notes; others are read-only with Add note buttons', () => {
    const { container } = render(<Host initial={base({ activeVerse: 1 })} />);
    expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(screen.getByTestId('chapter-editor-1')).toBeTruthy();
    expect(screen.getByTestId('chapter-note-3')).toBeTruthy();
    expect(screen.getByTestId('chapter-add-2')).toBeTruthy();
  });

  it('clicking a note activates it with focus; clicking a link inside does not', async () => {
    render(<Host initial={base()} />);
    fireEvent.click(within(screen.getByTestId('chapter-note-3')).getByText('link'));
    expect(h.activations).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByTestId('chapter-note-3')); });
    expect(h.activations).toEqual([{ verse: 3, focus: true }]);
    expect(last().activeVerse).toBe(3);
    expect(screen.getByTestId('chapter-editor-3')).toBeTruthy();
    expect(screen.queryByTestId('chapter-note-3')).toBeNull();
  });

  it('Add note activates an empty row', async () => {
    render(<Host initial={base()} />);
    await act(async () => { fireEvent.click(screen.getByTestId('chapter-add-2')); });
    expect(h.activations).toEqual([{ verse: 2, focus: true }]);
  });

  it('the verse number goes to the verse in the Bible', () => {
    render(<Host initial={base()} />);
    fireEvent.click(within(screen.getByTestId('chapter-verse-text-2')).getByRole('button'));
    expect(h.navigate).toHaveBeenCalledWith(vid(2));
  });

  it('the filter shows verses with notes plus the active draft row', async () => {
    render(<Host initial={base({ onlyWithNotes: true, activeVerse: 2 })} />);
    await screen.findByTestId('chapter-editor-2');
    expect(screen.queryByTestId('chapter-row-1')).not.toBeNull();
    expect(screen.queryByTestId('chapter-row-2')).not.toBeNull(); // active draft
    expect(screen.queryByTestId('chapter-row-3')).not.toBeNull();
    await act(async () => { fireEvent.keyDown(screen.getByTestId('editor-stub'), { key: 'Escape' }); });
    expect(screen.queryByTestId('chapter-row-2')).toBeNull();
  });

  it('shows the empty message when the filter hides everything', () => {
    h.notes = { ...h.notes, rows: mkRows([]) };
    render(<Host initial={base({ onlyWithNotes: true })} />);
    expect(screen.getByTestId('chapter-empty')).toBeTruthy();
  });
});

describe('ChapterNotesView keyboard', () => {
  it('Alt+PageDown / Alt+PageUp move the editor to the next / previous row with focus', async () => {
    render(<Host initial={base({ activeVerse: 1 })} />);
    await screen.findByTestId('chapter-editor-1');
    h.activations = [];
    const root = screen.getByTestId('chapter-notes-view');
    await act(async () => { fireEvent.keyDown(root, { key: 'PageDown', altKey: true }); });
    expect(h.activations).toEqual([{ verse: 2, focus: true }]);
    await act(async () => { fireEvent.keyDown(root, { key: 'PageUp', altKey: true }); });
    expect(h.activations.at(-1)).toEqual({ verse: 1, focus: true });
    await act(async () => { fireEvent.keyDown(root, { key: 'PageUp', altKey: true }); });
    expect(last().activeVerse).toBe(1); // already first: stays
  });

  it('keyboard activation scrolls the row to the start, and again once the editor is laid out', async () => {
    const spy = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      render(<Host initial={base({ activeVerse: 1 })} />);
      await act(async () => {});
      spy.mockClear();
      await act(async () => { fireEvent.keyDown(screen.getByTestId('chapter-notes-view'), { key: 'PageDown', altKey: true }); });
      expect(spy).toHaveBeenCalledWith({ block: 'start' });
      const before = spy.mock.calls.length;
      await act(async () => { await new Promise<void>(r => requestAnimationFrame(() => r())); });
      expect(spy.mock.calls.length).toBeGreaterThan(before);
      expect(spy.mock.calls.every(c => c[0].block === 'start')).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });

  it('Alt+PageDown with no active row opens the first visible row', async () => {
    render(<Host initial={base()} />);
    await act(async () => { fireEvent.keyDown(screen.getByTestId('chapter-notes-view'), { key: 'PageDown', altKey: true }); });
    expect(h.activations).toEqual([{ verse: 1, focus: true }]);
  });

  it('Alt+PageDown skips rows hidden by the filter', async () => {
    render(<Host initial={base({ onlyWithNotes: true, activeVerse: 1 })} />);
    await screen.findByTestId('chapter-editor-1');
    h.activations = [];
    await act(async () => { fireEvent.keyDown(screen.getByTestId('chapter-notes-view'), { key: 'PageDown', altKey: true }); });
    expect(h.activations).toEqual([{ verse: 3, focus: true }]);
  });

  it('Escape in the editor deactivates the row', async () => {
    render(<Host initial={base({ activeVerse: 1 })} />);
    await screen.findByTestId('chapter-editor-1');
    await act(async () => { fireEvent.keyDown(screen.getByTestId('editor-stub'), { key: 'Escape' }); });
    expect(h.deactivate).toHaveBeenCalled();
    expect(last().activeVerse).toBeUndefined();
    expect(screen.queryByTestId('editor-stub')).toBeNull();
  });
});

describe('ChapterNotesView Escape and pop-out', () => {
  it('Escape returns keyboard focus to the row it closed (its note viewer or Add button)', async () => {
    render(<Host initial={base({ activeVerse: 2 })} />);
    await screen.findByTestId('chapter-editor-2');
    await act(async () => { fireEvent.keyDown(screen.getByTestId('editor-stub'), { key: 'Escape' }); });
    expect(document.activeElement).toBe(screen.getByTestId('chapter-add-2'));
  });

  it('Escape on a row with a note refocuses its viewer', async () => {
    render(<Host initial={base({ activeVerse: 3 })} />);
    await screen.findByTestId('chapter-editor-3');
    await act(async () => { fireEvent.keyDown(screen.getByTestId('editor-stub'), { key: 'Escape' }); });
    expect(document.activeElement).toBe(screen.getByTestId('chapter-note-3'));
  });

  it('Escape deactivates even when an inner handler already called preventDefault', async () => {
    render(<Host initial={base({ activeVerse: 1 })} />);
    const stub = await screen.findByTestId('editor-stub');
    stub.addEventListener('keydown', e => e.preventDefault());
    await act(async () => { fireEvent.keyDown(stub, { key: 'Escape' }); });
    expect(h.deactivate).toHaveBeenCalled();
  });

  it('Escape leaves the row alone while a menu popup is open', async () => {
    render(<Host initial={base({ activeVerse: 1 })} />);
    const stub = await screen.findByTestId('editor-stub');
    const popup = document.createElement('div');
    popup.setAttribute('data-tippy-root', '');
    popup.innerHTML = '<div data-state="visible"></div>';
    document.body.appendChild(popup);
    try {
      await act(async () => { fireEvent.keyDown(stub, { key: 'Escape' }); });
      expect(h.deactivate).not.toHaveBeenCalled();
    } finally {
      popup.remove();
    }
  });

  it('the toolbar has a pop-out button that calls the pane handler, hidden in a pop-out', () => {
    const onPopOut = vi.fn();
    const { unmount } = render(<Host initial={base()} onPopOut={onPopOut} />);
    fireEvent.click(screen.getByTestId('chapter-pop-out'));
    expect(onPopOut).toHaveBeenCalledTimes(1);
    unmount();
    render(<Host initial={base()} onPopOut={onPopOut} isDetached />);
    expect(screen.queryByTestId('chapter-pop-out')).toBeNull();
  });
});

describe('ChapterNotesView toolbar', () => {
  it('previous / next chapter cross books', () => {
    render(<Host initial={base({ book: 1, chapter: 50 })} />);
    fireEvent.click(screen.getByTestId('chapter-next'));
    expect(last()).toMatchObject({ book: 2, chapter: 1 });
    fireEvent.click(screen.getByTestId('chapter-prev'));
    expect(last()).toMatchObject({ book: 1, chapter: 50 });
  });

  it('disables previous at Genesis 1', () => {
    render(<Host initial={base({ book: 1, chapter: 1 })} />);
    expect((screen.getByTestId('chapter-prev') as HTMLButtonElement).disabled).toBe(true);
  });

  it('toggles are aria-pressed and update state', () => {
    render(<Host initial={base()} />);
    const only = screen.getByTestId('chapter-only-notes');
    expect(only.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(only);
    expect(only.getAttribute('aria-pressed')).toBe('true');
    expect(last().onlyWithNotes).toBe(true);
    expect(screen.getByTestId('chapter-follow').getAttribute('aria-pressed')).toBe('false');
  });

  it('Compile passes the chapter title (default: the compile request)', () => {
    const onCompile = vi.fn();
    const { unmount } = render(<Host initial={base()} onCompile={onCompile} />);
    fireEvent.click(screen.getByTestId('chapter-compile'));
    expect(onCompile).toHaveBeenCalledWith('T45:8');
    unmount();
    render(<Host initial={base()} />);
    fireEvent.click(screen.getByTestId('chapter-compile'));
    expect(h.compile).toHaveBeenCalledWith({ reference: 'T45:8' });
  });

  it('Single note flushes first, then reports the active verse', async () => {
    const onExit = vi.fn();
    render(<Host initial={base({ activeVerse: 3 })} onExit={onExit} />);
    await screen.findByTestId('chapter-editor-3');
    await act(async () => { fireEvent.click(screen.getByTestId('chapter-single')); });
    expect(h.flush).toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledWith(vid(3));
  });

  it('Single note with no active row reports null', async () => {
    const onExit = vi.fn();
    render(<Host initial={base()} onExit={onExit} />);
    await act(async () => { fireEvent.click(screen.getByTestId('chapter-single')); });
    expect(onExit).toHaveBeenCalledWith(null);
  });

  it('translation select follows the Bible pane until one is picked', () => {
    useBibleStore.setState({
      availableBibles: [{ abbreviation: 'KJV', module_id: 7 }, { abbreviation: 'ESV', module_id: 8 }],
      panels: new Map([['b', { openTabs: [{ tabId: 't', abbreviation: 'ESV' }], activeTabIndex: 0, versesByTab: new Map(), studyOptionsByTab: new Map(), previewVerseId: null }]]),
    } as never);
    render(<Host initial={base()} />);
    expect(h.notesArgs.at(-1)?.translation).toBe('ESV');
    const select = screen.getByTestId('chapter-translation') as HTMLSelectElement;
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: 'KJV' } });
    expect(last().translation).toBe('KJV');
    expect(h.notesArgs.at(-1)?.translation).toBe('KJV');
    fireEvent.change(select, { target: { value: '' } });
    expect(last().translation).toBeUndefined();
  });

  it('hides the translation select with one Bible', () => {
    useBibleStore.setState({ availableBibles: [{ abbreviation: 'KJV', module_id: 7 }] } as never);
    render(<Host initial={base()} />);
    expect(screen.queryByTestId('chapter-translation')).toBeNull();
  });
});

describe('ChapterNotesView Follow', () => {
  const bibleAt = (book: number, chapter: number, preview: number | null = null) =>
    act(() => {
      useBibleStore.setState({
        panels: new Map([['b', {
          openTabs: [{ tabId: 't', abbreviation: 'KJV' }], activeTabIndex: 0, previewVerseId: preview, studyOptionsByTab: new Map(),
          versesByTab: new Map([['t', [{ verse_id: vid(1, book, chapter) }]]]),
        }]]),
      } as never);
    });
  const pick = (id: number) => act(() => { useNotesStore.setState({ panels: new Map([['p1', { currentVerseId: id } as never]]) }); });

  it('a picked verse in another chapter changes the chapter and activates it without focus', async () => {
    h.notes = { ...h.notes, rows: mkRows([1, 3]) };
    render(<Host initial={base({ follow: true })} />);
    pick(vid(2, 45, 9));
    expect(last()).toMatchObject({ book: 45, chapter: 9, activeVerse: 2 });
    // rows for the new chapter arrive
    h.notes = { ...h.notes, rows: [2].map(v => ({ verseId: vid(v, 45, 9), verse: v, verseHtml: 'x', record: null })) };
    h.activations = [];
    await act(async () => { fireEvent.click(screen.getByTestId('chapter-follow')); fireEvent.click(screen.getByTestId('chapter-follow')); });
    expect(h.activations.at(-1)).toEqual({ verse: 2, focus: false });
  });

  it('the Bible loading another chapter moves the view; a preview does not', () => {
    bibleAt(45, 8);
    render(<Host initial={base({ follow: true })} />);
    bibleAt(46, 2, vid(5, 46, 2));
    expect(last().chapter).toBe(8);
    bibleAt(45, 9);
    expect(last()).toMatchObject({ book: 45, chapter: 9 });
  });

  it('with Follow off it stays and shows the strip; Go there jumps', () => {
    bibleAt(45, 8);
    render(<Host initial={base({ follow: false })} />);
    expect(screen.queryByTestId('chapter-not-following')).toBeNull();
    bibleAt(45, 10);
    expect(last().chapter).toBe(8);
    expect(screen.getByTestId('chapter-not-following')).toBeTruthy();
    fireEvent.click(screen.getByTestId('chapter-go-there'));
    expect(last()).toMatchObject({ book: 45, chapter: 10 });
    expect(screen.queryByTestId('chapter-not-following')).toBeNull();
  });

  it('turning Follow on jumps to the Bible chapter at once', () => {
    bibleAt(45, 8);
    render(<Host initial={base({ follow: false })} />);
    bibleAt(46, 3);
    fireEvent.click(screen.getByTestId('chapter-follow'));
    expect(last()).toMatchObject({ book: 46, chapter: 3, follow: true });
  });
});

describe('ChapterNotesView handle', () => {
  it('openVerse in another chapter loads it and activates with focus', async () => {
    const ref = { current: null } as React.MutableRefObject<ChapterNotesHandle | null>;
    render(<Host initial={base({ follow: false })} handleRef={ref} />);
    expect(ref.current).not.toBeNull();
    act(() => ref.current!.openVerse(vid(2, 45, 9), { focus: true }));
    expect(last()).toMatchObject({ chapter: 9, activeVerse: 2, follow: false });
    h.notes = { ...h.notes, rows: [{ verseId: vid(2, 45, 9), verse: 2, verseHtml: 'x', record: null }] };
    h.activations = [];
    await act(async () => { fireEvent.keyDown(screen.getByTestId('chapter-notes-view'), { key: 'x' }); });
    // re-render with the new rows happens on the next state change
    await act(async () => { fireEvent.click(screen.getByTestId('chapter-only-notes')); fireEvent.click(screen.getByTestId('chapter-only-notes')); });
    expect(h.activations.at(-1)).toEqual({ verse: 2, focus: true });
  });

  it('flush is exposed and the handle is cleared on unmount', async () => {
    const ref = { current: null } as React.MutableRefObject<ChapterNotesHandle | null>;
    const { unmount } = render(<Host initial={base()} handleRef={ref} />);
    await act(async () => { await ref.current!.flush(); });
    expect(h.flush).toHaveBeenCalled();
    unmount();
    expect(ref.current).toBeNull();
  });
});
