import { describe, expect, it } from 'vitest';
import { beginDraft, draftIsOnWall, draftToRange, tapDraft } from '../wordHighlight';

const V = 43003016;

describe('tapDraft', () => {
  it('does nothing with no draft', () => {
    expect(tapDraft(null, V, 3)).toBeNull();
  });

  it('stretches a one-word draft to a range in either direction', () => {
    expect(tapDraft(beginDraft(V, 4), V, 8)).toEqual({ verseId: V, start: 4, end: 8 });
    expect(tapDraft(beginDraft(V, 4), V, 1)).toEqual({ verseId: V, start: 1, end: 4 });
  });

  it('clears when the highlight itself is tapped', () => {
    expect(tapDraft(beginDraft(V, 4), V, 4)).toBeNull();
    expect(tapDraft({ verseId: V, start: 2, end: 6 }, V, 5)).toBeNull();
    expect(tapDraft({ verseId: V, start: 2, end: 6 }, V, 2)).toBeNull();
  });

  it('moves the nearer end of a range for a tap outside it', () => {
    const range = { verseId: V, start: 4, end: 8 };
    expect(tapDraft(range, V, 10)).toEqual({ verseId: V, start: 4, end: 10 });
    expect(tapDraft(range, V, 1)).toEqual({ verseId: V, start: 1, end: 8 });
  });

  it('leaves the draft alone for a tap in another verse', () => {
    const draft = beginDraft(V, 4);
    expect(tapDraft(draft, V + 1, 4)).toBe(draft);
  });
});

describe('draftToRange / draftIsOnWall', () => {
  it('always sends textEnd, even for one word', () => {
    expect(draftToRange(beginDraft(V, 3))).toEqual({ verseIdStart: V, textStart: 3, textEnd: 3 });
  });

  it('recognises exactly its own range on the wall', () => {
    const draft = { verseId: V, start: 2, end: 5 };
    expect(draftIsOnWall(draft, draftToRange(draft))).toBe(true);
    expect(draftIsOnWall(draft, { verseIdStart: V, textStart: 2, textEnd: 6 })).toBe(false);
    expect(draftIsOnWall(draft, { verseIdStart: V + 1, textStart: 2, textEnd: 5 })).toBe(false);
    expect(draftIsOnWall(draft, null)).toBe(false);
    expect(draftIsOnWall(null, draftToRange(draft))).toBe(false);
  });

  it('reads a wall highlight with no textEnd as a single word', () => {
    expect(draftIsOnWall(beginDraft(V, 3), { verseIdStart: V, textStart: 3 })).toBe(true);
  });
});
