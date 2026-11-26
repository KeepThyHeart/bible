import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotesStore } from '../../../stores/useNotesStore';
import { useChapterFollow, type UseChapterFollowArgs } from './useChapterFollow';
import type { PrimaryBibleChapter } from './usePrimaryBibleChapter';

const setVerse = (id: number | undefined) =>
  act(() => { useNotesStore.setState({ panels: new Map([['p1', { currentVerseId: id } as never]]) }); });
const bible = (book: number, chapter: number, over: Partial<PrimaryBibleChapter> = {}): PrimaryBibleChapter =>
  ({ book, chapter, firstVerseId: book * 1000000 + chapter * 1000 + 1, previewActive: false, translation: 'KJV', ...over });

const onTarget = vi.fn();
const mount = (p: Partial<UseChapterFollowArgs> = {}) =>
  renderHook((props: UseChapterFollowArgs) => useChapterFollow(props), {
    initialProps: { panelId: 'p1', follow: true, book: 45, chapter: 8, primary: bible(45, 8), onTarget, ...p },
  });

beforeEach(() => { onTarget.mockReset(); setVerse(45008002); });

describe('useChapterFollow', () => {
  it('does not move at mount (seeded refs)', () => {
    mount();
    expect(onTarget).not.toHaveBeenCalled();
  });

  it('a picked verse in another chapter becomes a target without focus', () => {
    mount();
    setVerse(46013004);
    expect(onTarget).toHaveBeenCalledWith({ book: 46, chapter: 13, verseId: 46013004, focus: false });
  });

  it('the Bible loading another chapter moves the view, but not while previewing', () => {
    const h = mount();
    h.rerender({ panelId: 'p1', follow: true, book: 45, chapter: 8, onTarget, primary: bible(45, 9, { previewActive: true }) });
    expect(onTarget).not.toHaveBeenCalled();
    h.rerender({ panelId: 'p1', follow: true, book: 45, chapter: 8, onTarget, primary: bible(45, 9) });
    expect(onTarget).toHaveBeenCalledWith({ book: 45, chapter: 9, focus: false });
  });

  it('with follow off nothing moves and a strip is offered; goThere jumps', () => {
    const h = mount({ follow: false });
    h.rerender({ panelId: 'p1', follow: false, book: 45, chapter: 8, onTarget, primary: bible(45, 9) });
    setVerse(45009003);
    expect(onTarget).not.toHaveBeenCalled();
    expect(h.result.current.notFollowing).toEqual({ book: 45, chapter: 9 });
    act(() => h.result.current.goThere());
    expect(onTarget).toHaveBeenCalledWith({ book: 45, chapter: 9, verseId: 45009003, focus: false });
  });

  it('no strip when the chapters match or a preview shows', () => {
    expect(mount({ follow: false }).result.current.notFollowing).toBeNull();
    expect(mount({ follow: false, primary: bible(46, 1, { previewActive: true }) }).result.current.notFollowing).toBeNull();
  });
});
