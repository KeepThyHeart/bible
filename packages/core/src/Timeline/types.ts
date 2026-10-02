/**
 * Timeline DTOs. Plain JSON, no platform imports: the same shape crosses the
 * Electron IPC boundary, the web `/api/timeline` route and the offline cache.
 *
 * All instants are "day numbers": the Julian Day Number of the date in the
 * proleptic Julian calendar plus the fraction of the day. See `calendar.ts`.
 */

/** How much of an instant is meaningful. Never display more than this. */
export const TIME_PRECISIONS = ['millennium', 'century', 'decade', 'year', 'month', 'day', 'hour'] as const;
export type TimePrecision = (typeof TIME_PRECISIONS)[number];

export interface TimelineChronologyDto {
  id: string;
  name: string;
  description?: string;
  /** Consulted when an item has no date in this chronology. */
  fallbackId?: string;
  isDefault: boolean;
  sortOrder: number;
}

export interface TimelineLaneDto {
  id: string;
  name: string;
  group?: string;
  colorKey?: string;
  sortOrder: number;
}

export interface TimelinePassageDto {
  /** Inclusive verse-id range (book*1_000_000 + chapter*1_000 + verse). */
  start: number;
  end: number;
  primary: boolean;
}

/** One item's date in one chronology. `end` undefined = a point in time. */
export interface TimelineDateDto {
  start: number;
  end?: number;
  startMin?: number;
  startMax?: number;
  endMin?: number;
  endMax?: number;
  precision: TimePrecision;
  circa: boolean;
  basis?: string;
}

export interface TimelineItemDto {
  id: number;
  slug: string;
  /** 'reign' | 'life' | 'period' | 'event' | 'ministry' (open set). */
  kind: string;
  laneId: string;
  title: string;
  summary?: string;
  /** Soft link to a tag-graph entity. */
  entity?: { category: string; id: string };
  reviewed: boolean;
  passages: TimelinePassageDto[];
  /** chronology id -> date */
  dates: Record<string, TimelineDateDto>;
}

export interface TimelineModuleInfo {
  name: string;
  abbreviation?: string;
  version?: string;
  license?: string;
  description?: string;
}

/** The whole module, in one cacheable JSON document. */
export interface TimelineDataset {
  info: TimelineModuleInfo;
  chronologies: TimelineChronologyDto[];
  lanes: TimelineLaneDto[];
  items: TimelineItemDto[];
}

/** Implemented by each app (IPC on desktop, fetch on web). */
export interface ITimelineDataProvider {
  /** Null when no timeline module is installed. */
  getDataset(): Promise<TimelineDataset | null>;
}
