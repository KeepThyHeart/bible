/**
 * Locating things in the document that the expansion features act on:
 * an existing expansion (to re-format it) and the block a reference sits in
 * (to decide how Tab should insert).
 *
 * Pure - no editor view, no DOM, no layout.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { PassageInsertOptions } from '../../../services/copyFormats';
import { expansionContentHash } from '../../../services/verseExpansionService';
import type { VerseRefRange } from './verseReferenceRanges';

export interface ExpansionRange {
  /** Start of the expansion's content. */
  from: number;
  /** End of the expansion's content. */
  to: number;
  expansionId: string;
  reference: string;
  formatId: string;
  options: PassageInsertOptions | null;
  /** Concatenated text of every marked run, in document order. */
  text: string;
  /** Fingerprint recorded when the passage was inserted, if any. */
  contentHash: string | null;
  /**
   * True when the passage's text no longer matches the fingerprint taken at
   * insertion - i.e. the user has typed into it.
   *
   * Re-formatting replaces the passage wholesale, so an edited passage must
   * not be silently re-rendered: doing so would delete the user's own words.
   * An expansion with no recorded fingerprint is treated as pristine, since
   * there is nothing to compare against.
   */
  isEdited: boolean;
  /**
   * True when the marked runs fill their parent blocks completely, i.e. the
   * expansion owns whole paragraphs rather than sitting inside a sentence.
   * Replacing it should then span the block boundaries too, or the new content
   * gets stuffed inside the old paragraph.
   */
  fillsBlocks: boolean;
  /** Replacement range: block-outer when `fillsBlocks`, otherwise `from`/`to`. */
  replaceFrom: number;
  replaceTo: number;
}

/**
 * Find the full extent of the expansion identified by `expansionId`.
 *
 * A multi-line expansion is several marked runs - one per paragraph - sharing
 * an id. They are stitched back together here by taking the outermost bounds,
 * which is why the id has to be unique per expansion rather than per run.
 */
export function findExpansionRange(
  doc: ProseMirrorNode,
  expansionId: string,
): ExpansionRange | null {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  interface FoundAttrs {
    reference: string;
    formatId: string;
    options: PassageInsertOptions | null;
    contentHash: string | null;
  }
  const textRuns: string[] = [];
  // Collected into an array rather than a `let ... = null`: the only
  // assignment happens inside a nested callback, which TypeScript's
  // control-flow analysis cannot see, so it would narrow the variable to
  // `null` at every read below.
  const foundAttrs: FoundAttrs[] = [];
  // Block start/end positions of every block that contains part of the mark,
  // paired with how much of that block the mark covers.
  const blocks: Array<{ start: number; end: number; covered: number }> = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const blockContentStart = pos + 1;
    let covered = 0;
    let touched = false;

    node.descendants((child, childPos) => {
      if (!child.isText) return;
      const mark = child.marks.find(
        m => m.type.name === 'verseExpansion' && m.attrs.expansionId === expansionId,
      );
      if (!mark) return;
      touched = true;
      const childFrom = blockContentStart + childPos;
      const childTo = childFrom + child.nodeSize;
      from = Math.min(from, childFrom);
      to = Math.max(to, childTo);
      covered += child.nodeSize;
      textRuns.push(child.text ?? '');
      if (foundAttrs.length === 0) {
        foundAttrs.push({
          reference: (mark.attrs.reference as string | null) ?? '',
          formatId: (mark.attrs.formatId as string | null) ?? '',
          options: (mark.attrs.options as PassageInsertOptions | null) ?? null,
          contentHash: (mark.attrs.contentHash as string | null) ?? null,
        });
      }
    });

    if (touched) {
      blocks.push({ start: pos, end: pos + node.nodeSize, covered: covered === node.content.size ? 1 : 0 });
    }
    return true;
  });

  const found = foundAttrs[0];
  if (!found || blocks.length === 0) return null;

  const fillsBlocks = blocks.every(b => b.covered === 1);
  const text = textRuns.join('');
  return {
    from,
    to,
    expansionId,
    reference: found.reference,
    formatId: found.formatId,
    options: found.options,
    text,
    contentHash: found.contentHash,
    isEdited: found.contentHash !== null && expansionContentHash(text) !== found.contentHash,
    fillsBlocks,
    replaceFrom: fillsBlocks ? blocks[0].start : from,
    replaceTo: fillsBlocks ? blocks[blocks.length - 1].end : to,
  };
}

export interface BlockContext {
  /** Position of the block node itself. */
  blockStart: number;
  /** Position just after the block node. */
  blockEnd: number;
  /** True when the block's entire text is the reference (ignoring whitespace). */
  referenceIsAlone: boolean;
}

/**
 * Where a reference sits in its paragraph.
 *
 * This is what decides Tab's behaviour: a reference alone on its own line is
 * a citation the user wants replaced by the passage, while a reference inside
 * a sentence ("as Paul says in Rom 8:28, we know...") must survive - expanding
 * over it would destroy the sentence, so the passage goes in a new paragraph
 * underneath instead.
 */
export function getBlockContext(doc: ProseMirrorNode, range: VerseRefRange): BlockContext | null {
  const $pos = doc.resolve(range.from);
  const depth = $pos.depth;
  if (depth === 0) return null;

  const block = $pos.node(depth);
  if (!block.isTextblock) return null;

  const blockStart = $pos.before(depth);
  const blockEnd = $pos.after(depth);
  const blockText = block.textContent.trim();
  const referenceIsAlone = blockText === range.text.trim();

  return { blockStart, blockEnd, referenceIsAlone };
}
