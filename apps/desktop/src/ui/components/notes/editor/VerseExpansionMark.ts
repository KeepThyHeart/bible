/**
 * Marks text that was produced by expanding a Bible reference, so it can be
 * re-formatted later without the user having to undo and redo the expansion.
 *
 * Plain content alone - paste semantics, no schema changes, undo as the
 * revert path - is not enough: to offer "change this passage's format" on an
 * expansion that is already in the document, we have to be able to find it,
 * know which reference produced it, and know which format it is currently
 * rendered in. All three live in this mark's attributes.
 *
 * A mark rather than a node: a multi-line format spans several paragraphs, and
 * a block node wrapper would change the document's structure (and complicate
 * editing inside it). Marks are inline, so each paragraph of one expansion
 * carries its own marked run; they are stitched back together by matching
 * `expansionId`.
 *
 * Round-trip matters here - note content is serialised to HTML and written to
 * `.bn` files on disk. The mark renders as a `<span data-expansion-*>` and
 * parses back from one; DOMPurify preserves `data-*` attributes, so it also
 * survives `NoteViewer`'s read-only sanitising path.
 */
import { Mark, mergeAttributes } from '@tiptap/core';
import type {
  HeadingLevel,
  PassageInsertOptions,
  PassageReferencePosition,
  QuoteMarkStyle,
  VerseNumberStyle,
} from '../../../services/copyFormats';

export interface VerseExpansionAttributes {
  expansionId: string | null;
  reference: string | null;
  formatId: string | null;
  options: PassageInsertOptions | null;
  contentHash: string | null;
}

/** Fresh id for one expansion. Ids persist in saved notes, so they must not collide across sessions. */
export function newExpansionId(): string {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  // Older runtimes: still needs to be unique against ids already saved in a
  // note, so a bare counter (which restarts at 1 every launch) will not do.
  return `exp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

const REFERENCE_POSITIONS = ['before', 'after', 'none'];
const VERSE_NUMBER_STYLES = ['parenthetical', 'superscript', 'none'];
const QUOTE_MARK_STYLES = ['double', 'single', 'none'];

function readEnum<T extends string>(value: unknown, allowed: string[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value) ? (value as T) : undefined;
}

/**
 * Read the options a passage was inserted with.
 *
 * Field-by-field rather than a cast, because this attribute comes off disk:
 * `.bn` content can be hand-edited, truncated, or written by an older build.
 * Anything unrecognised is dropped rather than trusted, and a shape option
 * that is absent stays absent - `resolvePassageMarkupOptions` fills it from
 * the format's own defaults, which is the right answer for a passage inserted
 * before that option existed.
 */
function parseOptions(value: string | null): PassageInsertOptions | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const options: PassageInsertOptions = {
      displayVersionNumber: parsed.displayVersionNumber === true,
      wordsOfChristInRed: parsed.wordsOfChristInRed === true,
    };

    // The four note-insertion formats carry their shape here too, which is
    // what lets "change format" reopen an H2-per-verse passage as an H2 one.
    const referencePosition = readEnum<PassageReferencePosition>(parsed.referencePosition, REFERENCE_POSITIONS);
    if (referencePosition) options.referencePosition = referencePosition;
    const verseNumbers = readEnum<VerseNumberStyle>(parsed.verseNumbers, VERSE_NUMBER_STYLES);
    if (verseNumbers) options.verseNumbers = verseNumbers;
    const quoteMarks = readEnum<QuoteMarkStyle>(parsed.quoteMarks, QUOTE_MARK_STYLES);
    if (quoteMarks) options.quoteMarks = quoteMarks;
    if (
      typeof parsed.headingLevel === 'number' &&
      Number.isInteger(parsed.headingLevel) &&
      parsed.headingLevel >= 1 &&
      parsed.headingLevel <= 6
    ) {
      options.headingLevel = parsed.headingLevel as HeadingLevel;
    }

    return options;
  } catch {
    // Hand-edited or truncated note content must not break rendering.
    return null;
  }
}

export const VerseExpansionMark = Mark.create({
  name: 'verseExpansion',

  // Formatting the user applies inside an expansion (bold, colour) should
  // survive alongside it rather than replace it.
  inclusive: false,

  addAttributes() {
    return {
      expansionId: {
        default: null,
        parseHTML: el => el.getAttribute('data-expansion-id'),
        renderHTML: attrs => (attrs.expansionId ? { 'data-expansion-id': attrs.expansionId } : {}),
      },
      reference: {
        default: null,
        parseHTML: el => el.getAttribute('data-expansion-ref'),
        renderHTML: attrs => (attrs.reference ? { 'data-expansion-ref': attrs.reference } : {}),
      },
      formatId: {
        default: null,
        parseHTML: el => el.getAttribute('data-expansion-format'),
        renderHTML: attrs => (attrs.formatId ? { 'data-expansion-format': attrs.formatId } : {}),
      },
      options: {
        default: null,
        parseHTML: el => parseOptions(el.getAttribute('data-expansion-options')),
        renderHTML: attrs =>
          attrs.options ? { 'data-expansion-options': JSON.stringify(attrs.options) } : {},
      },
      /**
       * Fingerprint of the text as inserted. Comparing it against the
       * passage's current text is how an edited passage is recognised, so
       * re-formatting can be withdrawn rather than silently discarding the
       * user's own words.
       */
      contentHash: {
        default: null,
        parseHTML: el => el.getAttribute('data-expansion-hash'),
        renderHTML: attrs => (attrs.contentHash ? { 'data-expansion-hash': attrs.contentHash } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-expansion-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'verse-expansion' }), 0];
  },
});

export default VerseExpansionMark;
