import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrimaryBibleChapter, resetDetachedChapterForTests } from './usePrimaryBibleChapter';
import { useDetachedVerseFollow, resetDetachedVerseFollowForTests } from './useDetachedVerseFollow';
import { useNotesStore } from '../../../stores/useNotesStore';

let chapterCb: ((verseId: number) => void) | null = null;
let verseCb: ((verseId: number) => void) | null = null;

beforeEach(() => {
  resetDetachedChapterForTests();
  resetDetachedVerseFollowForTests();
  chapterCb = null;
  verseCb = null;
  useNotesStore.setState({ panels: new Map() });
  (window as unknown as { electron: unknown }).electron = {
    window: {
      onBibleChapterChanged: (cb: (v: number) => void) => { chapterCb = cb; },
      onVerseChanged: (cb: (v: number) => void) => { verseCb = cb; },
    },
  };
});
afterEach(() => { (window as unknown as { electron?: unknown }).electron = undefined; });

describe('a pop-out follows the main window', () => {
  it('usePrimaryBibleChapter reports the chapter the main Bible pane announced', () => {
    const { result } = renderHook(() => usePrimaryBibleChapter(true));
    expect(result.current.chapter).toBeNull();
    act(() => { chapterCb?.(19119001); });
    expect(result.current).toMatchObject({ book: 19, chapter: 119, firstVerseId: 19119001 });
    act(() => { chapterCb?.(19023001); });
    expect(result.current).toMatchObject({ book: 19, chapter: 23 });
  });

  it('useDetachedVerseFollow stores the picked verse as the notes panel\'s currentVerseId', () => {
    renderHook(() => useDetachedVerseFollow(true, 'p1'));
    act(() => { verseCb?.(19023004); });
    expect(useNotesStore.getState().panels.get('p1')?.currentVerseId).toBe(19023004);
  });

  it('does nothing in the main window', () => {
    renderHook(() => useDetachedVerseFollow(false, 'p1'));
    expect(verseCb).toBeNull();
  });

  it('a chapter announcement never selects a verse (no row is activated by a chapter move)', () => {
    renderHook(() => useDetachedVerseFollow(true, 'p1'));
    renderHook(() => usePrimaryBibleChapter(true));
    act(() => { chapterCb?.(19119001); });
    expect(useNotesStore.getState().panels.get('p1')?.currentVerseId).toBeUndefined();
  });
});
