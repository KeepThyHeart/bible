/**
 * Turning what the user typed into a verse-id range.
 *
 * The host already parses references (`api.bible.parseReference`), and this
 * module deliberately does not reimplement it. Reference parsing is a
 * deceptively deep problem - abbreviations, localised book names, "Ps" versus
 * "Psa" versus "Psalm", roman numerals for the epistles - and a second parser
 * in an extension would disagree with the app's own address bar in ways the
 * user would experience as the extension being broken.
 *
 * What this module does add is the piece the host parser leaves open: a
 * whole-chapter reference ("John 3") comes back with no end verse, because the
 * parser does not know how long the chapter is. `api.bible.listChapters` does,
 * and resolving the two together is the whole job here.
 */

import { tc } from './messages';
import type { MemoryBibleApi } from './ports';

export interface ResolvedReference {
  startVerseId: number;
  endVerseId: number;
  verseCount: number;
  /** Normalised for display, e.g. "John 3:16-18". */
  reference: string;
}

/**
 * A resolution failure the user is meant to read.
 *
 * These strings reach the panel and are shown verbatim, so they are phrased
 * for a person looking at a text box, not for a log.
 */
export class ReferenceError extends Error {}

/**
 * The most verses this extension will accept as one passage.
 *
 * A cap exists because the exercises degrade badly past it - a 40-step
 * ordering picker is a chore, not a memory aid - and because the whole passage
 * plus its context has to fit inside the 256 KB panel message cap. Whole
 * chapters are the common case that runs into this: Psalm 119 is 176 verses.
 * The message says so rather than just refusing.
 */
export const MAX_PASSAGE_VERSES = 25;

/**
 * Resolve a typed reference against the host.
 *
 * `moduleId` is the module the range will be memorised in. It is passed to the
 * parser so that a module with its own book naming resolves consistently, and
 * stored on the passage, because the same reference in two translations is two
 * different memorisation tasks.
 */
export async function resolveReference(
  api: { bible: MemoryBibleApi },
  input: string,
  moduleId?: string,
): Promise<ResolvedReference> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ReferenceError(tc('memory.core.refEmpty', 'Type a reference, for example "John 3:16-18".'));
  }

  let parsed = await api.bible.parseReference(trimmed);

  // A bare name only reads as a reference when the book has a single chapter
  // ("Jude"): the host parser needs a number, so ask it for "Jude 1" and keep
  // the answer only for such a book. "John" alone stays unrecognised.
  if (!parsed && /^[^\d:]+$/.test(trimmed)) {
    const probe = await api.bible.parseReference(`${trimmed} 1`);
    if (probe && (await api.bible.listChapters(probe.bookNumber, moduleId)).length === 1) {
      parsed = { bookNumber: probe.bookNumber, chapter: 1, input: trimmed };
    }
  }

  // "Philemon 1" in a single-chapter book reads as verse 1 to the host parser
  // (so that "Jude 5" is verse 5); a lone "1" is far more likely the chapter.
  if (parsed && parsed.startVerse === 1 && parsed.endVerse === undefined && /^[^\d:]+\s+1$/.test(trimmed)) {
    if ((await api.bible.listChapters(parsed.bookNumber, moduleId)).length === 1) {
      parsed = { bookNumber: parsed.bookNumber, chapter: 1, input: parsed.input };
    }
  }

  if (!parsed) {
    throw new ReferenceError(
      tc('memory.core.refUnrecognised', '"{input}" is not a reference I recognise. Try something like "John 3:16-18".', { input: trimmed }),
    );
  }

  // The parser fills these in when it can. When it cannot - which is exactly
  // the whole-chapter case - the chapter extents supply them.
  let startVerseId = parsed.startVerseId;
  let endVerseId = parsed.endVerseId;

  if (startVerseId === undefined || endVerseId === undefined) {
    const chapters = await api.bible.listChapters(parsed.bookNumber, moduleId);
    const chapter = chapters.find((c) => c.chapter === parsed.chapter);
    if (!chapter) {
      throw new ReferenceError(
        tc('memory.core.refNoChapter', 'That book does not have a chapter {chapter} in this translation.', { chapter: parsed.chapter }),
      );
    }

    if (startVerseId === undefined) {
      const startVerse = parsed.startVerse ?? 1;
      if (startVerse > chapter.verseCount) {
        throw new ReferenceError(
          tc('memory.core.refChapterVerses', 'That chapter only has {count} verses.', { count: chapter.verseCount }),
        );
      }
      startVerseId = chapter.firstVerseId + (startVerse - 1);
    }

    if (endVerseId === undefined) {
      // No end verse means one of two things, and they need opposite answers:
      // "John 3" is the whole chapter, "John 3:16" is a single verse. The
      // presence of `startVerse` is what separates them.
      endVerseId =
        parsed.startVerse === undefined
          ? chapter.lastVerseId
          : startVerseId;
    }
  }

  // The extents, order and size checks are shared with the verse selector
  // (`addPassageRange`, `previewVerses`) and the menu path.
  const range = await resolveRange(api, startVerseId, endVerseId, moduleId);
  return {
    startVerseId: range.startVerseId,
    endVerseId: range.endVerseId,
    verseCount: range.verseCount,
    reference: formatRange(parsed, range.verseCount),
  };
}

/**
 * Validate a verse-id range and describe it: both ends exist in the module's
 * chapter extents (the host parser hands back ids for "John 3:999" without
 * checking, B-038), the range does not end before it starts, stays in one
 * book, and holds at most `MAX_PASSAGE_VERSES` verses (counted across chapter
 * boundaries). The `reference` is built from the book name and ids, for
 * callers that have no typed spelling to keep.
 */
export async function resolveRange(
  api: { bible: MemoryBibleApi },
  startVerseId: number,
  endVerseId: number,
  moduleId?: string,
): Promise<{ startVerseId: number; endVerseId: number; verseCount: number; reference: string }> {
  const bookNumber = Math.floor(startVerseId / 1_000_000);
  const extents = await api.bible.listChapters(bookNumber, moduleId);
  for (const id of [startVerseId, endVerseId]) {
    const chapterNo = Math.floor(id / 1000) % 1000;
    const extent = Math.floor(id / 1_000_000) === bookNumber ? extents.find((c) => c.chapter === chapterNo) : undefined;
    if (!extent) {
      throw new ReferenceError(
        tc('memory.core.refNoChapter', 'That book does not have a chapter {chapter} in this translation.', { chapter: chapterNo }),
      );
    }
    if (id < extent.firstVerseId || id > extent.lastVerseId) {
      throw new ReferenceError(
        tc('memory.core.refChapterVerses', 'That chapter only has {count} verses.', { count: extent.verseCount }),
      );
    }
  }

  if (endVerseId < startVerseId) {
    throw new ReferenceError(tc('memory.core.refRangeBackwards', 'That range ends before it starts.'));
  }

  const verseCount = await countVerses(api, bookNumber, startVerseId, endVerseId, moduleId);
  if (verseCount > MAX_PASSAGE_VERSES) {
    throw new ReferenceError(
      tc('memory.core.refTooLong', 'That is {count} verses. Passages are limited to {max}; add it in smaller pieces.', { count: verseCount, max: MAX_PASSAGE_VERSES }),
    );
  }

  return { startVerseId, endVerseId, verseCount, reference: await describeRange(api, bookNumber, startVerseId, endVerseId) };
}

async function describeRange(
  api: { bible: MemoryBibleApi },
  bookNumber: number,
  startVerseId: number,
  endVerseId: number,
): Promise<string> {
  let book = '';
  try {
    const name = (await api.bible.listBooks()).find((b) => b.bookNumber === bookNumber)?.name;
    if (typeof name === 'string') book = name;
  } catch {
    /* names are cosmetic */
  }
  const ch = (id: number) => Math.floor(id / 1000) % 1000;
  const vs = (id: number) => id % 1000;
  const startLabel = `${ch(startVerseId)}:${vs(startVerseId)}`;
  let range = startLabel;
  if (endVerseId !== startVerseId) {
    range += ch(endVerseId) === ch(startVerseId) ? `-${vs(endVerseId)}` : `-${ch(endVerseId)}:${vs(endVerseId)}`;
  }
  return book ? `${book} ${range}` : range;
}

/**
 * Build the display string.
 *
 * Uses the input the parser consumed rather than reassembling from the book
 * number, so the user's own spelling survives - someone who typed "Phil 4:13"
 * sees "Phil 4:13" in their plan and can find it again. The one case that is
 * rewritten is a whole chapter, where the bare "John 3" is expanded so the row
 * shows how much material it actually is.
 */
function formatRange(
  parsed: { input: string; chapter: number; startVerse?: number; endVerse?: number },
  verseCount: number,
): string {
  if (parsed.startVerse === undefined && verseCount > 1) {
    return `${parsed.input.trim()} (${verseCount} verses)`;
  }
  return parsed.input.trim();
}

/**
 * Verses between two ids, inclusive. Ids are book*1e6 + chapter*1e3 + verse, so
 * their difference only counts verses inside one chapter; a range that crosses
 * chapters is summed from the chapter extents.
 */
async function countVerses(
  api: { bible: MemoryBibleApi },
  bookNumber: number,
  startVerseId: number,
  endVerseId: number,
  moduleId?: string,
): Promise<number> {
  const startChapter = Math.floor(startVerseId / 1000) % 1000;
  const endChapter = Math.floor(endVerseId / 1000) % 1000;
  if (startChapter === endChapter || Math.floor(startVerseId / 1_000_000) !== Math.floor(endVerseId / 1_000_000)) {
    return endVerseId - startVerseId + 1;
  }
  const chapters = await api.bible.listChapters(bookNumber, moduleId);
  let count = 0;
  for (const c of chapters) {
    if (c.chapter < startChapter || c.chapter > endChapter) continue;
    const first = Math.max(c.firstVerseId, startVerseId);
    const last = Math.min(c.lastVerseId, endVerseId);
    if (last >= first) count += last - first + 1;
  }
  return count;
}
