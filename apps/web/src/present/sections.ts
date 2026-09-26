/**
 * Where a long press on a passage lands: the "section" a clicker or key jumps
 * by, rather than a single verse.
 *
 * A section is what the Bible text itself already says it is -- a verse that
 * carries a section heading starts one. Translations that ship no headings fall
 * back to paragraph starts, and a chapter with neither falls back to a fixed
 * stride, so a long press always goes somewhere useful instead of doing
 * nothing on the modules that happen to lack the data.
 */

export interface SectionVerse {
  verse: number;
  section_heading?: string | null;
  is_paragraph_start?: boolean;
}

/** Verses a long press skips in a chapter with no headings and no paragraphs. */
export const FALLBACK_SECTION_STRIDE = 5;

/**
 * The verse number a long press should jump to from `from`.
 *
 * Forward: the first section start after `from`, or the chapter's last verse
 * if there is none. Backward: the nearest section start before `from` -- which
 * is the start of the current section when `from` is mid-section, and the
 * previous section's start when `from` is already on one -- or the first verse
 * if there is none. Never returns `from` unless the chapter has one verse.
 */
export function sectionTarget(
  verses: SectionVerse[],
  from: number,
  direction: 'next' | 'previous',
): number {
  const numbered = verses.filter(v => v.verse >= 1).map(v => v.verse).sort((a, b) => a - b);
  if (numbered.length === 0) return from;
  const first = numbered[0];
  const last = numbered[numbered.length - 1];

  const startsBy = (pick: (v: SectionVerse) => boolean): number[] =>
    verses.filter(v => v.verse >= 1 && pick(v)).map(v => v.verse).sort((a, b) => a - b);

  // The chapter's first verse always opens a section, whatever it carries.
  let starts = startsBy(v => Boolean(v.section_heading));
  if (starts.length === 0) starts = startsBy(v => Boolean(v.is_paragraph_start));
  if (starts.length === 0) {
    const target = direction === 'next' ? from + FALLBACK_SECTION_STRIDE : from - FALLBACK_SECTION_STRIDE;
    return Math.min(Math.max(target, first), last);
  }
  if (!starts.includes(first)) starts = [first, ...starts];

  if (direction === 'next') {
    const after = starts.find(s => s > from);
    return after ?? last;
  }
  const before = [...starts].reverse().find(s => s < from);
  return before ?? first;
}
