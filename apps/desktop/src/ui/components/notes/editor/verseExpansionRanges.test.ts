/**
 * Pure tests for locating expansions and for the block context that decides
 * how Tab inserts.
 */
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import VerseExpansionMark from './VerseExpansionMark';
import { findExpansionRange, getBlockContext } from './verseExpansionRanges';
import { expansionContentHash } from '../../../services/verseExpansionService';
import { findVerseReferenceRanges } from './verseReferenceRanges';

const schema = getSchema([StarterKit, VerseExpansionMark]);

const OPTIONS = { displayVersionNumber: true, wordsOfChristInRed: false };

function expansionMark(id: string, reference = 'John 3:16', formatId = 'standard') {
  return schema.marks.verseExpansion.create({
    expansionId: id,
    reference,
    formatId,
    options: OPTIONS,
  });
}

/** doc(paragraph...) where each entry is either a plain string or marked runs. */
function doc(...paragraphs: Array<string | Array<{ text: string; id?: string }>>): ProseMirrorNode {
  return schema.node(
    'doc',
    null,
    paragraphs.map(p => {
      if (typeof p === 'string') {
        return schema.node('paragraph', null, p.length > 0 ? [schema.text(p)] : []);
      }
      return schema.node(
        'paragraph',
        null,
        p.map(run => schema.text(run.text, run.id ? [expansionMark(run.id)] : [])),
      );
    }),
  );
}

describe('findExpansionRange', () => {
  it('finds a single-paragraph expansion that fills its block', () => {
    const d = doc([{ text: 'For God so loved the world', id: 'e1' }]);
    const range = findExpansionRange(d, 'e1');

    expect(range).not.toBeNull();
    expect(range!.reference).toBe('John 3:16');
    expect(range!.formatId).toBe('standard');
    expect(range!.options).toEqual(OPTIONS);
    expect(range!.fillsBlocks).toBe(true);
    // Replacing must span the block itself, or the new paragraphs get nested
    // inside the old one.
    expect(range!.replaceFrom).toBe(0);
    expect(range!.replaceTo).toBe(d.nodeSize - 2);
  });

  it('stitches a multi-paragraph expansion back together by id', () => {
    const d = doc(
      [{ text: 'John 3:16 (KJV)', id: 'e1' }],
      [{ text: '16 For God so loved the world', id: 'e1' }],
    );
    const range = findExpansionRange(d, 'e1');

    expect(range).not.toBeNull();
    expect(range!.fillsBlocks).toBe(true);
    expect(range!.replaceFrom).toBe(0);
    expect(range!.replaceTo).toBe(d.nodeSize - 2);
  });

  it('does not span blocks when the expansion sits inside a sentence', () => {
    const d = doc([
      { text: 'As it says, ' },
      { text: 'For God so loved the world', id: 'e1' },
      { text: ', which is the point.' },
    ]);
    const range = findExpansionRange(d, 'e1');

    expect(range).not.toBeNull();
    expect(range!.fillsBlocks).toBe(false);
    // Only the marked run is replaced - the surrounding prose survives.
    expect(range!.replaceFrom).toBe(range!.from);
    expect(range!.replaceTo).toBe(range!.to);
    expect(d.textBetween(range!.from, range!.to)).toBe('For God so loved the world');
  });

  it('ignores other expansions in the same document', () => {
    const d = doc(
      [{ text: 'first passage', id: 'e1' }],
      [{ text: 'second passage', id: 'e2' }],
    );
    const first = findExpansionRange(d, 'e1')!;
    const second = findExpansionRange(d, 'e2')!;

    expect(d.textBetween(first.from, first.to)).toBe('first passage');
    expect(d.textBetween(second.from, second.to)).toBe('second passage');
  });

  it('returns null for an unknown id', () => {
    expect(findExpansionRange(doc([{ text: 'x', id: 'e1' }]), 'nope')).toBeNull();
    expect(findExpansionRange(doc('plain text'), 'e1')).toBeNull();
  });

  describe('edit detection', () => {
    const PRISTINE = 'For God so loved the world';

    function markedWithHash(text: string, hash: string) {
      return schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text(text, [
            schema.marks.verseExpansion.create({
              expansionId: 'e1',
              reference: 'John 3:16',
              formatId: 'standard',
              options: OPTIONS,
              contentHash: hash,
            }),
          ]),
        ]),
      ]);
    }

    it('reports a pristine passage as unedited', () => {
      const d = markedWithHash(PRISTINE, expansionContentHash(PRISTINE));
      expect(findExpansionRange(d, 'e1')!.isEdited).toBe(false);
    });

    it('reports a passage the user has typed into as edited', () => {
      // The case that matters: re-formatting replaces the passage wholesale,
      // so a parenthetical typed into the middle of it would be destroyed.
      const d = markedWithHash(`${PRISTINE} (emphasis mine)`, expansionContentHash(PRISTINE));
      expect(findExpansionRange(d, 'e1')!.isEdited).toBe(true);
    });

    it('reports a passage with words deleted as edited', () => {
      const d = markedWithHash('For God so loved', expansionContentHash(PRISTINE));
      expect(findExpansionRange(d, 'e1')!.isEdited).toBe(true);
    });

    it('treats a passage with no recorded fingerprint as pristine', () => {
      // Nothing to compare against; refusing to re-format would be worse than
      // allowing it.
      const d = markedWithHash(PRISTINE, null as unknown as string);
      expect(findExpansionRange(d, 'e1')!.isEdited).toBe(false);
    });

    it('ignores whitespace differences', () => {
      // The formatted string separates lines with \n while the document uses
      // paragraph boundaries, so whitespace cannot be compared across the two.
      const d = markedWithHash('For God  so loved   the world', expansionContentHash(PRISTINE));
      expect(findExpansionRange(d, 'e1')!.isEdited).toBe(false);
    });
  });
});

describe('getBlockContext', () => {
  it('reports a reference alone on its own line', () => {
    const d = doc('John 3:16');
    const range = findVerseReferenceRanges(d)[0];
    const ctx = getBlockContext(d, range)!;

    expect(ctx.referenceIsAlone).toBe(true);
    expect(ctx.blockStart).toBe(0);
  });

  it('ignores surrounding whitespace when deciding "alone"', () => {
    const d = doc('  John 3:16  ');
    const range = findVerseReferenceRanges(d)[0];
    expect(getBlockContext(d, range)!.referenceIsAlone).toBe(true);
  });

  it('reports a reference embedded in a sentence', () => {
    const d = doc('As Paul says in Romans 8:28, we know');
    const range = findVerseReferenceRanges(d)[0];
    const ctx = getBlockContext(d, range)!;

    expect(ctx.referenceIsAlone).toBe(false);
    // blockEnd is where the new paragraph goes.
    expect(ctx.blockEnd).toBe(d.nodeSize - 2);
  });

  it('reports the correct block for a reference in the second paragraph', () => {
    const d = doc('Some intro text', 'Romans 8:28');
    const ranges = findVerseReferenceRanges(d);
    const ctx = getBlockContext(d, ranges[0])!;

    expect(ctx.referenceIsAlone).toBe(true);
    expect(ctx.blockStart).toBeGreaterThan(0);
    expect(ctx.blockEnd).toBe(d.nodeSize - 2);
  });
});
