import { VerseId, ReadingPlanType, Metadata } from '../../Core/Types';

/**
 * Reading plan entity from the user database
 */
export class ReadingPlan {
  planId?: number;
  name: string;
  description?: string;
  planType?: ReadingPlanType;
  durationDays?: number;
  isBuiltin: boolean;
  createdDate?: string;
  metadata?: Metadata;

  // Days in this reading plan
  private days: ReadingPlanDay[] = [];

  constructor(data: {
    planId?: number;
    name: string;
    description?: string;
    planType?: ReadingPlanType;
    durationDays?: number;
    isBuiltin?: boolean;
    createdDate?: string;
    metadata?: Metadata;
  }) {
    this.planId = data.planId;
    this.name = data.name;
    this.description = data.description;
    this.planType = data.planType;
    this.durationDays = data.durationDays;
    this.isBuiltin = data.isBuiltin ?? false;
    this.createdDate = data.createdDate;
    this.metadata = data.metadata;
  }

  /**
   * Get all days in the plan
   */
  getDays(): ReadingPlanDay[] {
    return this.days;
  }

  /**
   * Add a day to the plan
   */
  addDay(day: ReadingPlanDay): void {
    day.planId = this.planId!;
    this.days.push(day);
  }

  /**
   * Set all days (from repository query)
   */
  setDays(days: ReadingPlanDay[]): void {
    this.days = days;
  }

  /**
   * Get a specific day by number
   */
  getDay(dayNumber: number): ReadingPlanDay | undefined {
    return this.days.find(d => d.dayNumber === dayNumber);
  }

  /**
   * Get total number of days
   */
  getTotalDays(): number {
    return this.days.length;
  }

  /**
   * Check if this is a built-in plan
   */
  isBuiltInPlan(): boolean {
    return this.isBuiltin;
  }
}

/**
 * Reading plan day entity
 */
export class ReadingPlanDay {
  dayId?: number;
  planId?: number;
  dayNumber: number;
  metadata?: Metadata;

  // Passages to read on this day
  private passages: ReadingPlanPassage[] = [];

  constructor(data: {
    dayId?: number;
    planId?: number;
    dayNumber: number;
    metadata?: Metadata;
  }) {
    this.dayId = data.dayId;
    this.planId = data.planId;
    this.dayNumber = data.dayNumber;
    this.metadata = data.metadata;
  }

  /**
   * Get all passages for this day
   */
  getPassages(): ReadingPlanPassage[] {
    return this.passages;
  }

  /**
   * Add a passage to this day
   */
  addPassage(passage: ReadingPlanPassage): void {
    passage.dayId = this.dayId!;
    this.passages.push(passage);
  }

  /**
   * Set all passages (from repository query)
   */
  setPassages(passages: ReadingPlanPassage[]): void {
    this.passages = passages;
  }

  /**
   * Get passages grouped by session
   */
  getPassagesBySession(): Map<string | null, ReadingPlanPassage[]> {
    const grouped = new Map<string | null, ReadingPlanPassage[]>();

    for (const passage of this.passages) {
      const session = passage.sessionName ?? null;
      if (!grouped.has(session)) {
        grouped.set(session, []);
      }
      grouped.get(session)!.push(passage);
    }

    return grouped;
  }
}

/**
 * Reading plan passage entity
 */
export class ReadingPlanPassage {
  passageId?: number;
  dayId?: number;
  sessionName?: string;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  sortOrder: number;
  metadata?: Metadata;

  constructor(data: {
    passageId?: number;
    dayId?: number;
    sessionName?: string;
    verseIdStart: VerseId;
    verseIdEnd?: VerseId;
    sortOrder?: number;
    metadata?: Metadata;
  }) {
    this.passageId = data.passageId;
    this.dayId = data.dayId;
    this.sessionName = data.sessionName;
    this.verseIdStart = data.verseIdStart;
    this.verseIdEnd = data.verseIdEnd;
    this.sortOrder = data.sortOrder ?? 0;
    this.metadata = data.metadata;
  }

  /**
   * Check if this is a single verse
   */
  isSingleVerse(): boolean {
    return this.verseIdEnd === undefined || this.verseIdEnd === this.verseIdStart;
  }

  /**
   * Get the verse range
   */
  getVerseRange(): { start: VerseId; end?: VerseId } {
    return {
      start: this.verseIdStart,
      end: this.verseIdEnd
    };
  }
}
