/**
 * Bookmark list rules: add, rename, re-point,
 * reorder, delete. Each test names the rule it checks.
 */
import { describe, expect, test } from 'bun:test';

import {
  addBookmark,
  bookmarkAt,
  moveBookmark,
  removeBookmark,
  renameBookmark,
  rePointBookmark,
  type Bookmark,
} from './bookmarks';

describe('addBookmark', () => {
  test('appends, last in order', () => {
    let list = addBookmark([], 'John 3:16', 43003016);
    list = addBookmark(list, 'Romans 8:28', 45008028);
    expect(list.map((b) => b.name)).toEqual(['John 3:16', 'Romans 8:28']);
  });

  test('ids are never reused, even after a delete', () => {
    let list = addBookmark([], 'A', 1);
    list = addBookmark(list, 'B', 2);
    const bId = list[1]!.id;
    list = removeBookmark(list, bId);
    list = addBookmark(list, 'C', 3);
    expect(list.map((b) => b.id)).not.toContain(bId);
    expect(new Set(list.map((b) => b.id)).size).toBe(list.length);
  });
});

describe('renameBookmark', () => {
  test('changes the name, keeps the place and the target', () => {
    const list = addBookmark([], 'Old name', 1);
    const id = list[0]!.id;
    const renamed = renameBookmark(list, id, 'New name');
    expect(renamed[0]).toEqual({ id, name: 'New name', verseId: 1 });
  });

  test('a missing id leaves the list unchanged', () => {
    const list = addBookmark([], 'A', 1);
    expect(renameBookmark(list, 999, 'B')).toEqual(list);
  });
});

describe('rePointBookmark', () => {
  test('changes the target verse, keeps the name', () => {
    const list = addBookmark([], 'Favourite', 1);
    const id = list[0]!.id;
    const repointed = rePointBookmark(list, id, 2);
    expect(repointed[0]).toEqual({ id, name: 'Favourite', verseId: 2 });
  });
});

describe('removeBookmark', () => {
  test('drops that one bookmark, keeping the rest in order', () => {
    let list = addBookmark([], 'A', 1);
    list = addBookmark(list, 'B', 2);
    list = addBookmark(list, 'C', 3);
    const bId = list[1]!.id;
    expect(removeBookmark(list, bId).map((b) => b.name)).toEqual(['A', 'C']);
  });
});

describe('moveBookmark', () => {
  function threeBookmarks(): readonly Bookmark[] {
    let list = addBookmark([], 'A', 1);
    list = addBookmark(list, 'B', 2);
    list = addBookmark(list, 'C', 3);
    return list;
  }

  test('up swaps with the previous row', () => {
    const list = threeBookmarks();
    const bId = list[1]!.id;
    expect(moveBookmark(list, bId, 'up').map((b) => b.name)).toEqual(['B', 'A', 'C']);
  });

  test('down swaps with the next row', () => {
    const list = threeBookmarks();
    const bId = list[1]!.id;
    expect(moveBookmark(list, bId, 'down').map((b) => b.name)).toEqual(['A', 'C', 'B']);
  });

  test('moving the top row up does nothing — reordering has a top', () => {
    const list = threeBookmarks();
    const aId = list[0]!.id;
    expect(moveBookmark(list, aId, 'up')).toEqual(list);
  });

  test('moving the bottom row down does nothing — reordering has a bottom', () => {
    const list = threeBookmarks();
    const cId = list[2]!.id;
    expect(moveBookmark(list, cId, 'down')).toEqual(list);
  });
});

describe('bookmarkAt', () => {
  test('a typed row number resolves 1-based, top to bottom', () => {
    let list = addBookmark([], 'A', 1);
    list = addBookmark(list, 'B', 2);
    expect(bookmarkAt(list, 2)?.name).toBe('B');
  });

  test('out of range is undefined', () => {
    const list = addBookmark([], 'A', 1);
    expect(bookmarkAt(list, 0)).toBeUndefined();
    expect(bookmarkAt(list, 2)).toBeUndefined();
  });
});
