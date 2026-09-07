import { VerseId, Metadata, resolveRangeEnd } from '../../Core/Types';

/**
 * User-created cross-reference between two Bible PASSAGES.
 * Stored in user database (user_*.db).
 *
 * Both ends are ranges, inclusive at both bounds - a reader linking the
 * Beatitudes to Psalm 1 is connecting passages, not single verses. A single
 * verse is expressed as `end === start`, never as an omitted end, so the `end`
 * arguments may be left out on construction and default to their start.
 */
export class UserCrossReference {
  userXrefId?: number;
  /** Source passage, inclusive both ends. */
  fromVerseIdStart: VerseId;
  fromVerseIdEnd: VerseId;
  /** Target passage, inclusive both ends. */
  toVerseIdStart: VerseId;
  toVerseIdEnd: VerseId;
  notes?: string;
  createdDate?: string;
  metadata?: Metadata;

  constructor(data: {
    userXrefId?: number;
    fromVerseIdStart: VerseId;
    /** Omit for a single-verse source; defaults to `fromVerseIdStart`. */
    fromVerseIdEnd?: VerseId;
    toVerseIdStart: VerseId;
    /** Omit for a single-verse target; defaults to `toVerseIdStart`. */
    toVerseIdEnd?: VerseId;
    notes?: string;
    createdDate?: string;
    metadata?: Metadata;
  }) {
    this.userXrefId = data.userXrefId;
    this.fromVerseIdStart = data.fromVerseIdStart;
    this.fromVerseIdEnd = resolveRangeEnd(data.fromVerseIdStart, data.fromVerseIdEnd);
    this.toVerseIdStart = data.toVerseIdStart;
    this.toVerseIdEnd = resolveRangeEnd(data.toVerseIdStart, data.toVerseIdEnd);
    this.notes = data.notes;
    this.createdDate = data.createdDate;
    this.metadata = data.metadata;
  }

  /**
   * Check if this cross-reference has notes
   */
  hasNotes(): boolean {
    return this.notes !== undefined && this.notes.trim().length > 0;
  }

  /**
   * Move the SOURCE end to a new passage.
   *
   * Prefer this over assigning `fromVerseIdStart` directly: setting a start
   * without its end leaves `end < start`, which the database rejects with a
   * CHECK violation at write time rather than at the point of the mistake.
   * Omit `end` for a single verse.
   */
  setFromRange(start: VerseId, end?: VerseId): void {
    this.fromVerseIdStart = start;
    this.fromVerseIdEnd = resolveRangeEnd(start, end);
  }

  /** Move the TARGET end to a new passage. See {@link setFromRange}. */
  setToRange(start: VerseId, end?: VerseId): void {
    this.toVerseIdStart = start;
    this.toVerseIdEnd = resolveRangeEnd(start, end);
  }

  /** True if the source end is a single verse rather than a range. */
  isSingleVerseSource(): boolean {
    return this.fromVerseIdEnd === this.fromVerseIdStart;
  }

  /** True if the target end is a single verse rather than a range. */
  isSingleVerseTarget(): boolean {
    return this.toVerseIdEnd === this.toVerseIdStart;
  }
}
