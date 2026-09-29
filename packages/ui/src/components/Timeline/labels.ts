/** Labels (English defaults) and small formatting helpers shared by the timeline components. */
import { getBookName } from '@bible/core/browser';

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

/** "Genesis 1:1" / "Genesis 1:1-2:3" from verse ids (English book names). */
export function defaultFormatReference(verseId: number, endVerseId?: number): string {
  const part = (id: number) => ({ b: Math.floor(id / 1_000_000), c: Math.floor((id % 1_000_000) / 1000), v: id % 1000 });
  const a = part(verseId);
  const head = `${getBookName(a.b)} ${a.c}:${a.v}`;
  if (endVerseId === undefined || endVerseId === verseId) return head;
  const z = part(endVerseId);
  if (z.b !== a.b) return `${head} - ${getBookName(z.b)} ${z.c}:${z.v}`;
  return z.c === a.c ? `${head}-${z.v}` : `${head}-${z.c}:${z.v}`;
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
};
