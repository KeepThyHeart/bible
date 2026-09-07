import { VerseId, resolveRangeEnd } from '../../Core/Types';

/**
 * Association between a topic and a verse or verse range.
 *
 * **Canonical property names are `verseIdStart` / `verseIdEnd`**, matching the
 * canonical column spelling. An older topical converter emitted the
 * reversed `start_verse_id` / `end_verse_id` columns and this model mirrored
 * them; `startVerseId` / `endVerseId` survive as deprecated accessors so
 * existing consumers keep compiling. Range semantics: see the normative
 * statement in `Core/Types.ts`.
 *
 * These rows live in the unified `verse_link` table
 * (`source_type='topic'`, `source_id=topic_id`); this model remains the shape
 * the topical repository returns either way.
 */
export class TopicVerse {
  topicId: number;
  /** Inclusive start of the linked range. */
  verseIdStart: VerseId;
  /** Inclusive end of the linked range; equals the start for a single verse. */
  verseIdEnd: VerseId;
  context?: string;
  sortOrder?: number;

  constructor(data: {
    topicId: number;
    verseIdStart?: VerseId;
    verseIdEnd?: VerseId;
    /** @deprecated Use `verseIdStart`. */
    startVerseId?: VerseId;
    /** @deprecated Use `verseIdEnd`. */
    endVerseId?: VerseId;
    context?: string;
    sortOrder?: number;
  }) {
    const start = data.verseIdStart ?? data.startVerseId;
    if (start === undefined) {
      throw new Error('TopicVerse requires verseIdStart');
    }
    this.topicId = data.topicId;
    this.verseIdStart = start;
    this.verseIdEnd = resolveRangeEnd(start, data.verseIdEnd ?? data.endVerseId);
    this.context = data.context;
    this.sortOrder = data.sortOrder;
  }

  /** @deprecated Use {@link verseIdStart}. Kept for source compatibility. */
  get startVerseId(): VerseId {
    return this.verseIdStart;
  }

  set startVerseId(value: VerseId) {
    this.verseIdStart = value;
  }

  /** @deprecated Use {@link verseIdEnd}. Kept for source compatibility. */
  get endVerseId(): VerseId {
    return this.verseIdEnd;
  }

  set endVerseId(value: VerseId) {
    this.verseIdEnd = value;
  }

  isSingleVerse(): boolean {
    return this.verseIdStart === this.verseIdEnd;
  }

  containsVerse(verseId: VerseId): boolean {
    return verseId >= this.verseIdStart && verseId <= this.verseIdEnd;
  }

  /** Number of verse IDs spanned (1 for a single verse). */
  verseCount(): number {
    return this.verseIdEnd - this.verseIdStart + 1;
  }
}
