/**
 * The hymn content contract: what a `.hymn` file becomes once parsed, and what
 * travels between the server and the two clients.
 *
 * Separate from `protocol.ts` because it is a different kind of agreement.
 * `protocol.ts` is the *session* wire -- what is on the wall right now -- and a
 * hymn is *content*, fetched the same way a chapter of Scripture is. The
 * session state carries only `{ hymnId, verseOrder }`, exactly as it carries a
 * book and chapter rather than the verses themselves. That is what keeps the
 * state small enough to broadcast whole on every change.
 *
 * Like `protocol.ts`, this imports nothing and runs on either side.
 */

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * The kinds of stanza a hymn is made of.
 *
 * Naming sections is the one real departure from the old LiveScreen format,
 * which separated stanzas by blank lines only and so could not tell a refrain
 * from a verse. Without the distinction, the only way to sing a refrain between
 * every verse is to duplicate its text in the file -- which then has to be
 * corrected in four places when someone finds a typo.
 */
export type HymnSectionKind = 'verse' | 'refrain' | 'bridge' | 'coda' | 'interlude';

export interface HymnLine {
  text: string;
  /** Seconds into the accompanying audio. Absent unless the file times it. */
  at?: number;
}

export interface HymnSection {
  kind: HymnSectionKind;
  /** Stanza number, for verses only. */
  number?: number;
  /**
   * How `verse-order` refers to this section: '1', '2' ... for verses, 'R' for
   * the refrain, 'B' for a bridge, 'C' for a coda, 'I' for an interlude.
   */
  token: string;
  lines: HymnLine[];
}

// ---------------------------------------------------------------------------
// A hymn
// ---------------------------------------------------------------------------

/**
 * A parsed hymn.
 *
 * `fields` holds every metadata key exactly as written, including ones nothing
 * here knows about. That is deliberate and load-bearing: a library like this
 * accumulates fields over years from many contributors, and a parser that drops
 * what it does not recognise silently destroys other people's work. The named
 * properties below are a convenience over the same data, not a replacement for
 * it.
 */
export interface Hymn {
  id: string;
  title: string;
  firstLine: string;
  altTitles: string[];
  author?: string;
  textYear?: string;
  translator?: string;
  tune?: string;
  composer?: string;
  tuneYear?: string;
  arranger?: string;
  meter?: string;
  topics: string[];
  season: string[];
  tradition: string[];
  /** `Trinity Hymnal 1990: 460` -- how congregations actually ask for a hymn. */
  hymnals: HymnalReference[];
  scripture: string[];
  psalm?: string;
  language: string;
  sections: HymnSection[];
  /** Default order. The presenter may override it live; this does not bind. */
  verseOrder: string[];
  /** Every metadata key, verbatim, unknown ones included. */
  fields: Record<string, string>;
}

export interface HymnalReference {
  hymnal: string;
  number: string;
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

/** One screenful of a hymn. */
export interface HymnSlide {
  /** The `verse-order` token this slide came from. */
  token: string;
  kind: HymnSectionKind;
  /** A label for the presenter -- "Verse 2", "Refrain". Never on the wall. */
  label: string;
  lines: string[];
  /** True on the first slide of a section, which is where a title may go. */
  startsSection: boolean;
  /** Audio cue, already offset for transition and lookahead. */
  at?: number;
}

/** What a search result carries: enough to choose from, not enough to sing. */
export interface HymnSummary {
  id: string;
  title: string;
  firstLine: string;
  author?: string;
  tune?: string;
  meter?: string;
  hymnals: HymnalReference[];
  /** Sections available, so a controller can show "4 verses and a refrain". */
  verseCount: number;
  hasRefrain: boolean;
}

/** A hymn ready to put on a screen. */
export interface HymnDetail extends HymnSummary {
  slides: HymnSlide[];
  /**
   * The credit line, assembled from the metadata rather than typed by whoever
   * prepared the service.
   *
   * Automatic attribution is what keeps the licensing story clean without
   * asking a presenter to think about it at half past ten on a Sunday.
   */
  attribution: string;
  verseOrder: string[];
}

export interface HymnSearchResponse {
  hymns: HymnSummary[];
  /** Total matches, which may exceed what was returned. */
  total: number;
}

// ---------------------------------------------------------------------------
// Shared formatting
// ---------------------------------------------------------------------------

/** `Refrain`, `Verse 3` -- what a presenter sees beside a slide. */
export function sectionLabel(kind: HymnSectionKind, number?: number): string {
  if (kind === 'verse') return number ? `Verse ${number}` : 'Verse';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * The credit line for a hymn.
 *
 * Text and tune are kept apart because they are separate works with separate
 * authors, dates and copyright status -- the trap this whole library has to
 * avoid is a public-domain text carried into copyright by a modern translation
 * or arrangement. Naming both halves is how that stays visible.
 */
export function attributionFor(hymn: Hymn): string {
  const parts: string[] = [];

  const text = [hymn.author, hymn.textYear].filter(Boolean).join(', ');
  if (text) parts.push(text);
  if (hymn.translator) {
    parts.push(`tr. ${[hymn.translator, hymn.fields['translator-year']].filter(Boolean).join(', ')}`);
  }

  const tune = [hymn.tune, hymn.composer, hymn.tuneYear].filter(Boolean).join(', ');
  if (tune) parts.push(tune);
  if (hymn.arranger) {
    parts.push(`arr. ${[hymn.arranger, hymn.fields['arrangement-year']].filter(Boolean).join(', ')}`);
  }

  return parts.join(' · ');
}
