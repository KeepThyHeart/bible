/** Labels (English defaults) and small formatting helpers shared by the timeline components. */
import { formatVerseIdRange, getBookName } from '@bible/core/browser';

export const DEFAULT_TIMELINE_KIND_LABELS: Record<string, string> = {
  reign: 'Kings and reigns',
  life: 'People and lives',
  period: 'Periods',
  event: 'Events',
  ministry: 'Ministry',
};

/** A kind's display name: the label if given, else the kind with a capital letter. */
export function kindLabel(kinds: Record<string, string> | undefined, kind: string): string {
  return kinds?.[kind] ?? DEFAULT_TIMELINE_KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** "Genesis 1:1" / "Genesis 1:1-2:3" / "Genesis 5" (verse 999 = chapter end) from verse ids (English book names). */
export function defaultFormatReference(verseId: number, endVerseId?: number): string {
  return formatVerseIdRange(verseId, endVerseId, getBookName);
}

export interface TimelineViewLabels {
  /** Accessible name of the timeline graphic. */
  group: string;
  /** Instructions for keyboard users (set as the description). */
  help: string;
}

export const DEFAULT_TIMELINE_VIEW_LABELS: TimelineViewLabels = {
  group: 'Timeline',
  help: 'Arrow keys pan, plus and minus zoom, Home shows everything, Enter on an item opens it.',
};

export interface TimelineItemCardLabels {
  close: string;
  read: string;
  passages: string;
  dates: string;
  basis: string;
  circa: string;
  /** {min} and {max} are replaced. */
  startRange: string;
  endRange: string;
  /** {chronology} is replaced. */
  viaFallback: string;
  reviewed: string;
  unreviewed: string;
  kinds?: Record<string, string>;
}

export const DEFAULT_TIMELINE_ITEM_CARD_LABELS: TimelineItemCardLabels = {
  close: 'Close',
  read: 'Read',
  passages: 'Passages',
  dates: 'Dates by chronology',
  basis: 'Basis',
  circa: 'Approximate date',
  startRange: 'Start between {min} and {max}',
  endRange: 'End between {min} and {max}',
  viaFallback: 'Date taken from {chronology}',
  reviewed: 'Reviewed',
  unreviewed: 'Unreviewed',
};

export interface TimelinePanelLabels {
  chronology: string;
  kinds: string;
  search: string;
  lanes: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  settings: string;
  fullscreen: string;
  exitFullscreen: string;
  zoom: string;
  position: string;
  searchResults: string;
  noResults: string;
  /** Kind display names (falls back to the built-in English ones). */
  kindNames?: Record<string, string>;
  view?: Partial<TimelineViewLabels>;
  card?: Partial<TimelineItemCardLabels>;
}

export const DEFAULT_TIMELINE_PANEL_LABELS: TimelinePanelLabels = {
  chronology: 'Chronology',
  kinds: 'Show',
  search: 'Search the timeline',
  lanes: 'Lanes',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Fit',
  settings: 'Timeline settings',
  fullscreen: 'Full screen',
  exitFullscreen: 'Exit full screen',
  zoom: 'Zoom',
  position: 'Position',
  searchResults: 'Search results',
  noResults: 'No matching events',
};
