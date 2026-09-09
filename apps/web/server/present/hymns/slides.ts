/**
 * Turning a hymn into screenfuls.
 *
 * The algorithm is ported from the old LiveScreen manifest builder, and it is
 * worth being explicit about why it is ported rather than reinvented: the
 * orphan rule at the end is not something anyone derives from first principles.
 * It exists because somebody watched a hymn put one lonely line on its own
 * slide in a real service and decided that looked wrong. That is the kind of
 * rule that is cheap to keep and expensive to rediscover.
 *
 * Two faults in the original are not carried over. It measured the candidate
 * line with PHP's `count()` on a string, which is always 1, so the
 * "comfortably below the maximum" step compared a character total against a
 * budget using a line length of one -- the step effectively always fired. And
 * its orphan check could reduce a slide to a single line while avoiding a
 * single line on the next one. Both are fixed below.
 *
 * Sizing is in characters, not pixels, and the numbers are fixed rather than
 * measured from a viewport. That is deliberate: the server has to know how many
 * slides a hymn has, because the server owns what `next` means, and it cannot
 * know how large anyone's television is. The viewer shrinks a slide that does
 * not fit -- it already has to, for Esther 8:9 -- so the packing only has to be
 * close, and being the same for everyone matters more than being exact for one.
 */

import { sectionLabel, type Hymn, type HymnSection, type HymnSlide } from '../../../src/present/hymns.js';

export interface PackingOptions {
  /** Keep filling a slide until it holds at least this many characters. */
  minChars?: number;
  /** Never exceed this. */
  maxChars?: number;
  /**
   * Seconds to bring each slide's audio cue forward, so the words are on the
   * screen slightly before they are sung rather than slightly after.
   */
  lead?: number;
}

/**
 * Defaults tuned for four short hymn lines at a readable size on a television.
 *
 * A common metre stanza (8.6.8.6) runs to roughly 120 characters, so a whole
 * stanza lands on one slide -- which is what a congregation expects, because it
 * is how the words sit on a hymnal page.
 */
export const DEFAULT_MIN_CHARS = 90;
export const DEFAULT_MAX_CHARS = 190;
const DEFAULT_LEAD_SECONDS = 2;

/** How close to the maximum the optional extra line is allowed to take us. */
const COMFORT = 0.2;

interface FlatLine {
  text: string;
  at?: number;
  section: HymnSection;
  startsSection: boolean;
}

/**
 * Lay the hymn out in the order it will actually be sung.
 *
 * `verseOrder` is expanded here rather than at render time, which is what makes
 * a refrain between every verse cost one line in the file instead of three
 * copies of the same text.
 */
function flatten(hymn: Hymn, verseOrder: string[]): FlatLine[] {
  const byToken = new Map(hymn.sections.map(section => [section.token, section]));
  const out: FlatLine[] = [];

  for (const token of verseOrder) {
    const section = byToken.get(token);
    if (!section) continue;
    section.lines.forEach((line, index) => {
      out.push({
        text: line.text,
        ...(line.at === undefined ? {} : { at: line.at }),
        section,
        startsSection: index === 0,
      });
    });
  }
  return out;
}

export function packSlides(
  hymn: Hymn,
  verseOrder: string[] = hymn.verseOrder,
  options: PackingOptions = {},
): HymnSlide[] {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const lead = options.lead ?? DEFAULT_LEAD_SECONDS;
  // The maximum, backed off by a fifth of the min-to-max range: room to take
  // one more line without landing right on the ceiling.
  const comfortable = maxChars - (maxChars - minChars) * COMFORT;

  const lines = flatten(hymn, verseOrder);
  const slides: HymnSlide[] = [];
  let at = 0;

  while (at < lines.length) {
    // Always at least one line, however long it is.
    let take = 1;
    let chars = lines[at].text.length;

    // Keep filling while short, but never across a section boundary: a refrain
    // sharing a slide with the end of a verse is wrong however well it fits.
    while (
      at + take < lines.length
      && chars < minChars
      && !lines[at + take].startsSection
    ) {
      chars += lines[at + take].text.length;
      take++;
    }

    // One more, if it fits comfortably. (The original measured this line's
    // length as 1; measuring it properly is what stops an over-full slide.)
    if (
      at + take < lines.length
      && !lines[at + take].startsSection
      && chars + lines[at + take].text.length <= comfortable
    ) {
      chars += lines[at + take].text.length;
      take++;
    }

    // Would this leave exactly one line stranded on the next slide? Give one
    // back -- but never below two lines here, or the orphan has simply moved.
    const nextIsLast = at + take + 1 === lines.length;
    const nextStartsSection = at + take + 1 < lines.length && lines[at + take + 1].startsSection;
    if ((nextIsLast || nextStartsSection) && at + take < lines.length && take > 2) {
      take--;
    }

    const group = lines.slice(at, at + take);
    const first = group[0];
    const cue = first.at;
    slides.push({
      token: first.section.token,
      kind: first.section.kind,
      label: sectionLabel(first.section.kind, first.section.number),
      lines: group.map(line => line.text),
      startsSection: first.startsSection,
      ...(cue === undefined ? {} : { at: Math.max(0, cue - lead) }),
    });
    at += take;
  }

  return slides;
}
