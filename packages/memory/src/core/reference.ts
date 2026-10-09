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
    throw new ReferenceError('Type a reference, for example "John 3:16-18".');
  }

  const parsed = await api.bible.parseReference(trimmed);
  if (!parsed) {
    throw new ReferenceError(
      `"${trimmed}" is not a reference I recognise. Try something like "John 3:16-18".`,
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
        `That book does not have a chapter ${parsed.chapter} in this translation.`,
      );
    }

    if (startVerseId === undefined) {
      const startVerse = parsed.startVerse ?? 1;
      if (startVerse > chapter.verseCount) {
        throw new ReferenceError(
          `That chapter only has ${chapter.verseCount} verses.`,
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

  if (endVerseId < startVerseId) {
    throw new ReferenceError('That range ends before it starts.');
  }

  const verseCount = endVerseId - startVerseId + 1;
  if (verseCount > MAX_PASSAGE_VERSES) {
    throw new ReferenceError(
      `That is ${verseCount} verses. Passages are limited to ${MAX_PASSAGE_VERSES}; ` +
        `add it in smaller pieces so each one stays practisable.`,
    );
  }

  return {
    startVerseId,
    endVerseId,
    verseCount,
    reference: formatRange(parsed, verseCount),
  };
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
