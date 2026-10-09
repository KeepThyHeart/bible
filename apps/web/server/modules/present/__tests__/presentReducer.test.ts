import { describe, it, expect } from 'vitest';
import {
  LIMITS,
  addHighlightToList,
  applyIntent,
  highlightsOverlap,
  initialState,
  mergeHighlightRanges,
  removeHighlightFromList,
  validateHighlight,
  validateIntent,
  validateItem,
  validatePlan,
  type IntentContext,
} from '../reducer';
import {
  MAX_FONT_STEP, MAX_HIGHLIGHTS, MIN_FONT_STEP,
  type HighlightRange, type PresentPassageItem, type StoredPresentState,
} from '../../../../src/modules/present/lib/protocol';

/** John 3, so `next` has a real end to run into. */
const ctx: IntentContext = { chapterLength: () => 36, slideCount: () => null };
/** A module that is not installed: the reducer must still work. */
const noModules: IntentContext = { chapterLength: () => null, slideCount: () => null };

const JOHN_3: PresentPassageItem = { kind: 'passage', module: 'KJV', book: 43, chapter: 3 };

function seeded(overrides: Partial<StoredPresentState> = {}): StoredPresentState {
  return { ...initialState('SESSION000000000', 'ABCD2345'), ...overrides };
}

function showing(index: number, item = JOHN_3): StoredPresentState {
  return seeded({ live: item, position: { index, highlights: [] } });
}

// ---------------------------------------------------------------------------
// Item validation
// ---------------------------------------------------------------------------

describe('validateItem', () => {
  it('accepts a whole-chapter passage', () => {
    expect(validateItem({ kind: 'passage', module: 'KJV', book: 43, chapter: 3 }))
      .toEqual(JOHN_3);
  });

  it('accepts a verse range and keeps it', () => {
    expect(validateItem({ ...JOHN_3, verseStart: 16, verseEnd: 17 }))
      .toEqual({ ...JOHN_3, verseStart: 16, verseEnd: 17 });
  });

  it('rejects a range that ends before it starts', () => {
    expect(validateItem({ ...JOHN_3, verseStart: 17, verseEnd: 16 })).toBeNull();
  });

  it('rejects module names that could reach the filesystem', () => {
    expect(validateItem({ ...JOHN_3, module: '../../../etc/passwd' })).toBeNull();
    expect(validateItem({ ...JOHN_3, module: 'KJV/../main' })).toBeNull();
    expect(validateItem({ ...JOHN_3, module: '' })).toBeNull();
  });

  it('rejects out-of-range books and chapters', () => {
    expect(validateItem({ ...JOHN_3, book: 0 })).toBeNull();
    expect(validateItem({ ...JOHN_3, book: 67 })).toBeNull();
    expect(validateItem({ ...JOHN_3, chapter: 0 })).toBeNull();
    expect(validateItem({ ...JOHN_3, book: 43.5 })).toBeNull();
  });

  it('drops keys that are not in the contract', () => {
    // The item is echoed to every viewer, so an unrecognised field is either a
    // client bug or an attempt to use the session as a message bus.
    const item = validateItem({ ...JOHN_3, evil: '<script>', note: 'hello' });
    expect(item).toEqual(JOHN_3);
  });

  it('trims a text slide and enforces its cap', () => {
    expect(validateItem({ kind: 'text', body: '  I believe.  ' }))
      .toEqual({ kind: 'text', body: 'I believe.' });
    expect(validateItem({ kind: 'text', body: '   ' })).toBeNull();
    expect(validateItem({ kind: 'text', body: 'x'.repeat(LIMITS.textBody + 1) })).toBeNull();
  });

  it('accepts a hymn by id', () => {
    expect(validateItem({ kind: 'hymn', hymnId: 'amazing-grace' }))
      .toEqual({ kind: 'hymn', hymnId: 'amazing-grace' });
  });

  it('keeps a verse order the presenter chose', () => {
    // A refrain between every verse, or only verses one and four: the file's
    // own order is a default, not a constraint.
    expect(validateItem({ kind: 'hymn', hymnId: 'amazing-grace', verseOrder: ['1', 'R', '2'] }))
      .toEqual({ kind: 'hymn', hymnId: 'amazing-grace', verseOrder: ['1', 'R', '2'] });
  });

  it('rejects a hymn id that is not a slug', () => {
    // Ids are what saved service plans reference, and they reach a filesystem
    // lookup; anything that is not a slug did not come from the library.
    expect(validateItem({ kind: 'hymn', hymnId: '../../etc/passwd' })).toBeNull();
    expect(validateItem({ kind: 'hymn', hymnId: 'Amazing Grace' })).toBeNull();
    expect(validateItem({ kind: 'hymn', hymnId: '' })).toBeNull();
  });

  it('rejects a verse order with tokens that are not section names', () => {
    expect(validateItem({ kind: 'hymn', hymnId: 'x', verseOrder: ['1', 'Z'] })).toBeNull();
    expect(validateItem({ kind: 'hymn', hymnId: 'x', verseOrder: [] })).toBeNull();
    expect(validateItem({ kind: 'hymn', hymnId: 'x', verseOrder: '1 R 2' })).toBeNull();
  });

  it('trims a quote and enforces its cap', () => {
    expect(validateItem({ kind: 'quote', text: '  To be, or not to be.  ' }))
      .toEqual({ kind: 'quote', text: 'To be, or not to be.' });
    expect(validateItem({ kind: 'quote', text: '   ' })).toBeNull();
    expect(validateItem({ kind: 'quote', text: 'x'.repeat(LIMITS.quoteText + 1) })).toBeNull();
  });

  it('keeps a quote attribution and enforces its cap', () => {
    expect(validateItem({ kind: 'quote', text: 'Amazing grace.', attribution: 'John Newton' }))
      .toEqual({ kind: 'quote', text: 'Amazing grace.', attribution: 'John Newton' });
    expect(validateItem({ kind: 'quote', text: 'x', attribution: 'y'.repeat(LIMITS.quoteAttribution + 1) }))
      .toBeNull();
  });

  it('rejects anything that is not an item at all', () => {
    expect(validateItem(null)).toBeNull();
    expect(validateItem('passage')).toBeNull();
    expect(validateItem([])).toBeNull();
    expect(validateItem({ kind: 'video', url: 'http://x' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Highlight validation
// ---------------------------------------------------------------------------

describe('validateHighlight', () => {
  it('accepts a single-word highlight', () => {
    expect(validateHighlight({ verseIdStart: 43003016, textStart: 0 }))
      .toEqual({ verseIdStart: 43003016, textStart: 0 });
  });

  it('accepts a run within one verse', () => {
    expect(validateHighlight({ verseIdStart: 43003016, textStart: 2, textEnd: 7 }))
      .toEqual({ verseIdStart: 43003016, textStart: 2, textEnd: 7 });
  });

  it('rejects a backwards run inside one verse', () => {
    expect(validateHighlight({ verseIdStart: 43003016, textStart: 7, textEnd: 2 })).toBeNull();
  });

  it('allows a lower end index when the range spans verses', () => {
    // Word 2 of verse 17 legitimately comes after word 7 of verse 16: the
    // indices belong to different token runs.
    expect(validateHighlight({
      verseIdStart: 43003016, textStart: 7, verseIdEnd: 43003017, textEnd: 2,
    })).toEqual({ verseIdStart: 43003016, textStart: 7, verseIdEnd: 43003017, textEnd: 2 });
  });

  it('rejects a range that ends in an earlier verse', () => {
    expect(validateHighlight({
      verseIdStart: 43003017, textStart: 0, verseIdEnd: 43003016, textEnd: 0,
    })).toBeNull();
  });

  it('rejects impossible verse ids and word indices', () => {
    expect(validateHighlight({ verseIdStart: 0, textStart: 0 })).toBeNull();
    expect(validateHighlight({ verseIdStart: 99999999, textStart: 0 })).toBeNull();
    expect(validateHighlight({ verseIdStart: 43003016, textStart: -1 })).toBeNull();
    expect(validateHighlight({ verseIdStart: 43003016, textStart: LIMITS.verseWords + 1 })).toBeNull();
  });

  it('rejects an unknown style rather than silently dropping it', () => {
    expect(validateHighlight({ verseIdStart: 43003016, textStart: 0, style: 'blink' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Combining highlights
// ---------------------------------------------------------------------------

describe('highlightsOverlap', () => {
  it('treats touching or crossing ranges in one verse as overlapping', () => {
    const a: HighlightRange = { verseIdStart: 43003016, textStart: 0, textEnd: 3 };
    expect(highlightsOverlap(a, { verseIdStart: 43003016, textStart: 3, textEnd: 5 })).toBe(true);
    expect(highlightsOverlap(a, { verseIdStart: 43003016, textStart: 2 })).toBe(true);
    expect(highlightsOverlap(a, { verseIdStart: 43003016, textStart: 4 })).toBe(false);
  });

  it('treats separate verses as never overlapping unless a range spans between them', () => {
    const a: HighlightRange = { verseIdStart: 43003016, textStart: 0 };
    const b: HighlightRange = { verseIdStart: 43003017, textStart: 0 };
    expect(highlightsOverlap(a, b)).toBe(false);
    // Spans from word 5 of verse 16 to word 0 of verse 17 -- touches the tail
    // of 16 and the head of 17, but not `a`, which sits before word 5.
    const spanning: HighlightRange = { verseIdStart: 43003016, textStart: 5, verseIdEnd: 43003017, textEnd: 0 };
    expect(highlightsOverlap(spanning, a)).toBe(false);
    expect(highlightsOverlap(spanning, { verseIdStart: 43003016, textStart: 5 })).toBe(true);
    expect(highlightsOverlap(spanning, b)).toBe(true);
  });
});

describe('mergeHighlightRanges', () => {
  it('spans the two ranges and drops textEnd when the merge is one word', () => {
    const a: HighlightRange = { verseIdStart: 43003016, textStart: 3 };
    const b: HighlightRange = { verseIdStart: 43003016, textStart: 3 };
    expect(mergeHighlightRanges(a, b)).toEqual({ verseIdStart: 43003016, textStart: 3 });
  });

  it('widens to the outer edges regardless of which range is "existing"', () => {
    const a: HighlightRange = { verseIdStart: 43003016, textStart: 4, textEnd: 6 };
    const b: HighlightRange = { verseIdStart: 43003016, textStart: 2, textEnd: 5 };
    expect(mergeHighlightRanges(a, b)).toEqual({ verseIdStart: 43003016, textStart: 2, textEnd: 6 });
  });

  it('prefers the newly-added range\'s style', () => {
    const a: HighlightRange = { verseIdStart: 43003016, textStart: 0, style: 'underline' };
    const b: HighlightRange = { verseIdStart: 43003016, textStart: 1, style: 'highlight' };
    expect(mergeHighlightRanges(a, b).style).toBe('highlight');
  });
});

describe('addHighlightToList / removeHighlightFromList', () => {
  it('adds to an empty list', () => {
    const range: HighlightRange = { verseIdStart: 43003016, textStart: 0 };
    expect(addHighlightToList([], range)).toEqual([range]);
  });

  it('merges into every overlapping entry, even non-adjacent ones', () => {
    const list: HighlightRange[] = [
      { verseIdStart: 43003016, textStart: 0, textEnd: 1 },
      { verseIdStart: 43003016, textStart: 8, textEnd: 9 },
    ];
    // Overlaps neither directly, but spans across both once it is added.
    const added: HighlightRange = { verseIdStart: 43003016, textStart: 1, textEnd: 8 };
    expect(addHighlightToList(list, added)).toEqual([{ verseIdStart: 43003016, textStart: 0, textEnd: 9 }]);
  });

  it('drops the oldest entry once the cap would be exceeded', () => {
    const list = Array.from({ length: MAX_HIGHLIGHTS }, (_, i) => (
      { verseIdStart: 43003016, textStart: i * 2, textEnd: i * 2 } as HighlightRange
    ));
    const next = addHighlightToList(list, { verseIdStart: 43003017, textStart: 0 });
    expect(next.length).toBe(MAX_HIGHLIGHTS);
    expect(next[0]).toEqual(list[1]);
  });

  it('removes only the entries that overlap', () => {
    const list: HighlightRange[] = [
      { verseIdStart: 43003016, textStart: 0, textEnd: 1 },
      { verseIdStart: 43003016, textStart: 5, textEnd: 6 },
    ];
    expect(removeHighlightFromList(list, { verseIdStart: 43003016, textStart: 5 }))
      .toEqual([{ verseIdStart: 43003016, textStart: 0, textEnd: 1 }]);
    expect(removeHighlightFromList(list, { verseIdStart: 43003016, textStart: 3 })).toEqual(list);
  });
});

// ---------------------------------------------------------------------------
// Intent validation
// ---------------------------------------------------------------------------

describe('validateIntent', () => {
  it('accepts every intent in the protocol', () => {
    expect(validateIntent({ type: 'next' })).toEqual({ type: 'next' });
    expect(validateIntent({ type: 'previous' })).toEqual({ type: 'previous' });
    expect(validateIntent({ type: 'blank' })).toEqual({ type: 'blank' });
    expect(validateIntent({ type: 'unblank' })).toEqual({ type: 'unblank' });
    expect(validateIntent({ type: 'clearHighlights' })).toEqual({ type: 'clearHighlights' });
    expect(validateIntent({
      type: 'addHighlight', highlight: { verseIdStart: 43003016, textStart: 0 },
    })).toEqual({ type: 'addHighlight', highlight: { verseIdStart: 43003016, textStart: 0 } });
    expect(validateIntent({
      type: 'removeHighlight', highlight: { verseIdStart: 43003016, textStart: 0 },
    })).toEqual({ type: 'removeHighlight', highlight: { verseIdStart: 43003016, textStart: 0 } });
    expect(validateIntent({ type: 'end' })).toEqual({ type: 'end' });
    expect(validateIntent({ type: 'goTo', index: 16 })).toEqual({ type: 'goTo', index: 16 });
    expect(validateIntent({ type: 'setTheme', theme: 'light' })).toEqual({ type: 'setTheme', theme: 'light' });
    expect(validateIntent({ type: 'setTheme', theme: 'max' })).toEqual({ type: 'setTheme', theme: 'max' });
    expect(validateIntent({ type: 'lockJoins', locked: true })).toEqual({ type: 'lockJoins', locked: true });
    expect(validateIntent({ type: 'setFontStep', fontStep: 7 })).toEqual({ type: 'setFontStep', fontStep: 7 });
    expect(validateIntent({ type: 'show', item: JOHN_3 })).toEqual({ type: 'show', item: JOHN_3 });
  });

  it('rejects a font step outside the scale', () => {
    expect(validateIntent({ type: 'setFontStep', fontStep: MIN_FONT_STEP - 1 })).toBeNull();
    expect(validateIntent({ type: 'setFontStep', fontStep: MAX_FONT_STEP + 1 })).toBeNull();
    expect(validateIntent({ type: 'setFontStep', fontStep: '8' })).toBeNull();
  });

  it('rejects a show whose item is invalid', () => {
    expect(validateIntent({ type: 'show', item: { kind: 'passage' } })).toBeNull();
  });

  it('rejects an addHighlight/removeHighlight whose range is invalid', () => {
    expect(validateIntent({ type: 'addHighlight', highlight: { verseIdStart: 0, textStart: 0 } })).toBeNull();
    expect(validateIntent({ type: 'addHighlight' })).toBeNull();
    expect(validateIntent({ type: 'removeHighlight', highlight: { verseIdStart: 0, textStart: 0 } })).toBeNull();
  });

  it('rejects unknown and malformed intents', () => {
    expect(validateIntent({ type: 'shutdown' })).toBeNull();
    expect(validateIntent({})).toBeNull();
    expect(validateIntent(null)).toBeNull();
    expect(validateIntent('next')).toBeNull();
    expect(validateIntent({ type: 'lockJoins', locked: 'yes' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

describe('validatePlan', () => {
  let n = 0;
  const makeId = (): string => `id-${n++}`;

  const UUID_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const UUID_B = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

  it('names a new entry itself', () => {
    n = 0;
    const plan = validatePlan([{ item: JOHN_3 }], makeId);
    expect(plan).toEqual([{ id: 'id-0', item: JOHN_3 }]);
  });

  it('lets an existing entry keep its id', () => {
    // The plan is replaced wholesale on every edit, so renaming every entry on
    // every save would re-key the controller's list mid-drag.
    n = 0;
    const plan = validatePlan([{ id: UUID_A, item: JOHN_3 }], makeId);
    expect(plan).toEqual([{ id: UUID_A, item: JOHN_3 }]);
  });

  it('preserves ids through a reorder', () => {
    n = 0;
    const plan = validatePlan([{ id: UUID_B, item: JOHN_3 }, { id: UUID_A, item: JOHN_3 }], makeId);
    expect(plan?.map(entry => entry.id)).toEqual([UUID_B, UUID_A]);
  });

  it('refuses to let a client collide two entries onto one id', () => {
    n = 0;
    const plan = validatePlan([{ id: UUID_A, item: JOHN_3 }, { id: UUID_A, item: JOHN_3 }], makeId);
    expect(plan?.[0].id).toBe(UUID_A);
    expect(plan?.[1].id).toBe('id-0');
  });

  it('replaces an id that is not a well-formed one', () => {
    n = 0;
    const plan = validatePlan([{ id: 'client-chosen', item: JOHN_3 }], makeId);
    expect(plan).toEqual([{ id: 'id-0', item: JOHN_3 }]);
  });

  it('keeps presenter notes', () => {
    n = 0;
    const plan = validatePlan([{ item: JOHN_3, note: 'read slowly' }], makeId);
    expect(plan?.[0].note).toBe('read slowly');
  });

  it('rejects a plan longer than the cap', () => {
    n = 0;
    const tooMany = Array.from({ length: LIMITS.planEntries + 1 }, () => ({ item: JOHN_3 }));
    expect(validatePlan(tooMany, makeId)).toBeNull();
  });

  it('rejects the whole plan if any entry is bad', () => {
    n = 0;
    expect(validatePlan([{ item: JOHN_3 }, { item: { kind: 'nope' } }], makeId)).toBeNull();
  });

  it('rejects a plan that is not an array', () => {
    expect(validatePlan({ 0: { item: JOHN_3 } }, makeId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

describe('applyIntent', () => {
  it('starts with nothing on the wall', () => {
    const state = initialState('SESSION000000000', 'ABCD2345');
    expect(state.live).toBeNull();
    expect(state.display.blanked).toBe(false);
    expect(state.session.joinsLocked).toBe(false);
  });

  it('shows a passage at verse 1 by default', () => {
    const next = applyIntent(seeded(), { type: 'show', item: JOHN_3 }, ctx);
    expect(next?.live).toEqual(JOHN_3);
    expect(next?.position.index).toBe(1);
  });

  it('clamps the opening index into the passage', () => {
    const next = applyIntent(seeded(), { type: 'show', item: JOHN_3, index: 99 }, ctx);
    expect(next?.position.index).toBe(36);
  });

  it('clears every highlight when a new item is shown', () => {
    // Word indices computed against one passage mean nothing against the next
    // one; carrying them over would paint an arbitrary run of words.
    const withHighlight = seeded({
      live: JOHN_3,
      position: { index: 16, highlights: [{ verseIdStart: 43003016, textStart: 0 }] },
    });
    const next = applyIntent(withHighlight, { type: 'show', item: JOHN_3 }, ctx);
    expect(next?.position.highlights).toEqual([]);
  });

  it('drops every highlight when the position moves to another verse', () => {
    // A highlight is a run of words in one verse; it must neither follow the
    // presenter onto the next verse nor light up again on a later return.
    const lit = seeded({
      live: JOHN_3,
      position: { index: 16, highlights: [{ verseIdStart: 43003016, textStart: 1, textEnd: 3 }] },
    });
    expect(applyIntent(lit, { type: 'next' }, ctx)?.position).toEqual({ index: 17, highlights: [] });
    expect(applyIntent(lit, { type: 'previous' }, ctx)?.position).toEqual({ index: 15, highlights: [] });
    expect(applyIntent(lit, { type: 'goTo', index: 30 }, ctx)?.position).toEqual({ index: 30, highlights: [] });
  });

  it('keeps the highlight when a move changes nothing', () => {
    const lit = seeded({
      live: JOHN_3,
      position: { index: 36, highlights: [{ verseIdStart: 43003036, textStart: 0 }] },
    });
    expect(applyIntent(lit, { type: 'next' }, ctx)).toBeNull();
  });

  it('adds a highlight, merging it into an overlapping one already there', () => {
    const lit = seeded({
      live: JOHN_3,
      position: { index: 16, highlights: [{ verseIdStart: 43003016, textStart: 0, textEnd: 2 }] },
    });
    const next = applyIntent(
      lit, { type: 'addHighlight', highlight: { verseIdStart: 43003016, textStart: 2, textEnd: 4 } }, ctx,
    );
    expect(next?.position.highlights).toEqual([{ verseIdStart: 43003016, textStart: 0, textEnd: 4 }]);
  });

  it('adds a non-overlapping highlight alongside the others', () => {
    const lit = seeded({
      live: JOHN_3,
      position: { index: 16, highlights: [{ verseIdStart: 43003016, textStart: 0, textEnd: 1 }] },
    });
    const next = applyIntent(
      lit, { type: 'addHighlight', highlight: { verseIdStart: 43003016, textStart: 5, textEnd: 6 } }, ctx,
    );
    expect(next?.position.highlights).toEqual([
      { verseIdStart: 43003016, textStart: 0, textEnd: 1 },
      { verseIdStart: 43003016, textStart: 5, textEnd: 6 },
    ]);
  });

  it('drops the oldest highlight once a new one would exceed the cap', () => {
    const many = Array.from({ length: MAX_HIGHLIGHTS }, (_, i) => (
      { verseIdStart: 43003016, textStart: i * 2, textEnd: i * 2 }
    ));
    const lit = seeded({ live: JOHN_3, position: { index: 16, highlights: many } });
    const next = applyIntent(
      lit, { type: 'addHighlight', highlight: { verseIdStart: 43003017, textStart: 0 } }, ctx,
    );
    expect(next?.position.highlights.length).toBe(MAX_HIGHLIGHTS);
    expect(next?.position.highlights[0]).toEqual(many[1]);
    expect(next?.position.highlights.at(-1)).toEqual({ verseIdStart: 43003017, textStart: 0 });
  });

  it('removes any highlight overlapping the given range', () => {
    const lit = seeded({
      live: JOHN_3,
      position: {
        index: 16,
        highlights: [
          { verseIdStart: 43003016, textStart: 0, textEnd: 1 },
          { verseIdStart: 43003016, textStart: 5, textEnd: 6 },
        ],
      },
    });
    const next = applyIntent(
      lit, { type: 'removeHighlight', highlight: { verseIdStart: 43003016, textStart: 5 } }, ctx,
    );
    expect(next?.position.highlights).toEqual([{ verseIdStart: 43003016, textStart: 0, textEnd: 1 }]);
  });

  it('reports no change when removeHighlight touches nothing', () => {
    const lit = seeded({
      live: JOHN_3,
      position: { index: 16, highlights: [{ verseIdStart: 43003016, textStart: 0, textEnd: 1 }] },
    });
    const next = applyIntent(
      lit, { type: 'removeHighlight', highlight: { verseIdStart: 43003016, textStart: 5 } }, ctx,
    );
    expect(next).toBeNull();
  });

  it('clears every highlight at once', () => {
    const lit = seeded({
      live: JOHN_3,
      position: {
        index: 16,
        highlights: [
          { verseIdStart: 43003016, textStart: 0 },
          { verseIdStart: 43003016, textStart: 5 },
        ],
      },
    });
    expect(applyIntent(lit, { type: 'clearHighlights' }, ctx)?.position.highlights).toEqual([]);
  });

  it('advances and retreats within the chapter', () => {
    expect(applyIntent(showing(16), { type: 'next' }, ctx)?.position.index).toBe(17);
    expect(applyIntent(showing(16), { type: 'previous' }, ctx)?.position.index).toBe(15);
  });

  it('reports no change at either end rather than broadcasting', () => {
    // A held-down arrow key at the end of a chapter must not bump the version
    // and fan out to every viewer several times a second.
    expect(applyIntent(showing(36), { type: 'next' }, ctx)).toBeNull();
    expect(applyIntent(showing(1), { type: 'previous' }, ctx)).toBeNull();
  });

  it('respects an explicit verse range as the bounds', () => {
    const ranged = showing(17, { ...JOHN_3, verseStart: 16, verseEnd: 17 });
    expect(applyIntent(ranged, { type: 'next' }, ctx)).toBeNull();
    expect(applyIntent(ranged, { type: 'previous' }, ctx)?.position.index).toBe(16);
  });

  it('still advances when the chapter length is unknown', () => {
    // A module that is not installed should not freeze the wall.
    expect(applyIntent(showing(16), { type: 'next' }, noModules)?.position.index).toBe(17);
  });

  it('does nothing on next when nothing is showing', () => {
    expect(applyIntent(seeded(), { type: 'next' }, ctx)).toBeNull();
  });

  it('toggles blanking without losing what is on the wall', () => {
    const blanked = applyIntent(showing(16), { type: 'blank' }, ctx);
    expect(blanked?.display.blanked).toBe(true);
    expect(blanked?.live).toEqual(JOHN_3);
    expect(blanked?.position.index).toBe(16);
    expect(applyIntent(blanked!, { type: 'blank' }, ctx)).toBeNull();
    expect(applyIntent(blanked!, { type: 'unblank' }, ctx)?.display.blanked).toBe(false);
  });

  it('treats a no-op setting as no change', () => {
    const state = seeded();
    expect(applyIntent(state, { type: 'setFontStep', fontStep: state.display.fontStep }, ctx)).toBeNull();
    expect(applyIntent(state, { type: 'setTheme', theme: state.display.theme }, ctx)).toBeNull();
    expect(applyIntent(state, { type: 'clearHighlights' }, ctx)).toBeNull();
    expect(applyIntent(state, { type: 'lockJoins', locked: false }, ctx)).toBeNull();
  });

  it('leaves ending a session to the caller', () => {
    // Ending is a lifecycle change, not a state change.
    expect(applyIntent(showing(16), { type: 'end' }, ctx)).toBeNull();
  });

  it('never mutates the state it was given', () => {
    const before = showing(16);
    const snapshot = JSON.stringify(before);
    applyIntent(before, { type: 'next' }, ctx);
    applyIntent(before, { type: 'blank' }, ctx);
    applyIntent(before, { type: 'setFontStep', fontStep: 9 }, ctx);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
