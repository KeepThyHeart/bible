/**
 * Verse formatting for the offline (OPFS/wa-sqlite) read path.
 *
 * A hand-maintained duplicate of `@bible/core` `Services/VerseFormatter.ts`.
 * The server renders verses through core's copy; this one renders them when the
 * reader is offline, so the two have to agree — the same verse must not look
 * different depending on whether the network is up. `verseFormatting.test.ts`
 * pins the behaviour that matters so a change to one side fails loudly instead
 * of showing up as "the italics disappeared when I went offline".
 *
 * It lives here, split out of `bibleWorker.ts`, for two reasons: the worker
 * module imports `wa-sqlite` at load and so cannot be imported by a unit test,
 * and the formatting is pure string work with no worker or SQLite dependency.
 * The worker imports it back — a local ESM sibling, which the Vite worker build
 * resolves fine. (Core itself still cannot be imported here: the reachable
 * `@bible/core` entry point is CommonJS and pulls in `better-sqlite3`.)
 */

// ── Patterns ──────────────────────────────────────────────────────────────
const OSIS_TAG_PATTERN = /<\/?(divineName|transChange|catchWord|rdg|seg|hi|foreign|inscription|mentioned|name|note|title|q|w)(\s[^>]*)?>/g;

// <divineName>...</divineName> (Tetragrammaton, "LORD"/"GOD") is rendered with
// small-caps styling (see .divine-name in the theme stylesheets) instead of being
// stripped to bare text. Converted to placeholder markers first — not real <span>
// tags — because the Words of Christ block below does a blanket `<[^>]*>` strip
// while splitting text into words; an actual <span> inserted before that point
// would be silently discarded. The markers aren't tag-shaped, so they survive that
// step attached to their word, and get swapped for real tags at the very end.
const DIVINE_NAME_PATTERN = /<divineName(?:\s[^>]*)?>([\s\S]*?)<\/divineName>/g;
const DIVINE_NAME_OPEN_MARKER = String.fromCharCode(1);
const DIVINE_NAME_CLOSE_MARKER = String.fromCharCode(2);

/**
 * Normalize a divine-name word to initial-capital form ("LORD"/"lord" -> "Lord").
 *
 * The casing convention lives here rather than in CSS because `::first-letter`
 * only matches block containers and is silently ignored on an inline <span>,
 * so the stylesheet is a bare `font-variant-caps: small-caps` and relies on the
 * content already being initial-capitalized.
 */
function toDivineNameCase(word: string): string {
  const lower = word.toLowerCase();
  const firstLetter = lower.search(/[a-z]/);
  if (firstLetter === -1) return lower;
  return lower.slice(0, firstLetter) + lower[firstLetter].toUpperCase() + lower.slice(firstLetter + 1);
}

export interface FormattingData {
  paragraphStart?: boolean;
  paragraph_start?: boolean;
  wordsOfChrist?: Array<{ start: number; end: number }>;
  words_of_christ?: Array<{ start: number; end: number }>;
  // The Tetragrammaton, carried as a v2 `divine_name` span rather than a
  // <divineName> tag. `formatVerseText` below reads both spellings; they were
  // missing from this interface, so those reads were type errors.
  divineName?: Array<{ start: number; end: number }>;
  divine_name?: Array<{ start: number; end: number }>;
  sectionHeading?: string;
  section_heading?: string;
  footnotes?: Array<{ position: number; marker: string; text: string }>;
}

export function formatVerseText(text: string, fd: FormattingData | undefined) {
  let html = text;
  let isParagraphStart = false;

  // Strip legacy HTML formatting tags
  html = html.replace(/<font[^>]*>/g, '');
  html = html.replace(/<\/font>/g, '');

  // Convert <divineName> into placeholder markers before the generic OSIS strip
  // below (see DIVINE_NAME_PATTERN comment above for why markers, not real tags).
  html = html.replace(DIVINE_NAME_PATTERN, `${DIVINE_NAME_OPEN_MARKER}$1${DIVINE_NAME_CLOSE_MARKER}`);

  // Strip OSIS/SWORD XML tags
  html = html.replace(OSIS_TAG_PATTERN, '');

  // Detect paragraph boundaries from pilcrow character
  if (html.includes('\u00B6')) {
    html = html.replace(/\u00B6/g, '');
    isParagraphStart = true;
  }

  // Detect paragraph boundaries from formatting metadata
  if (fd?.paragraphStart || fd?.paragraph_start) {
    isParagraphStart = true;
  }

  // Apply the word-indexed spans: Words of Christ and the divine name. Module
  // format v2 stores markup-free text and carries the Tetragrammaton as a
  // `divine_name` span rather than a <divineName> tag, so the tag handling above
  // never fires for current modules — this is the path that actually runs.
  // Both span types index into the same tag-free word sequence, so they must
  // share one rebuild pass; a second pass would see indices shifted by the
  // <span> markup the first pass inserted.
  const woc = fd?.wordsOfChrist || fd?.words_of_christ;
  const divine = fd?.divineName || fd?.divine_name;
  if ((woc && woc.length > 0) || (divine && divine.length > 0)) {
    const strippedText = html.replace(/<[^>]*>/g, ' ');
    const words = strippedText.split(/\s+/).filter(w => w.length > 0);

    const mark = (ranges: Array<{ start: number; end: number }> | undefined): boolean[] => {
      const flags: boolean[] = new Array(words.length).fill(false);
      for (const range of ranges ?? []) {
        for (let i = range.start; i <= range.end && i < words.length; i++) {
          if (i >= 0) flags[i] = true;
        }
      }
      return flags;
    };

    const isChristWord = mark(woc);
    const isDivineWord = mark(divine);

    // christ-words is the outer span, divine-name the inner one, so overlapping
    // ranges still nest legally. Order per iteration is close -> separator ->
    // open, keeping the space between words outside both spans.
    const parts: string[] = [];
    let inChrist = false;
    let inDivine = false;

    for (let i = 0; i < words.length; i++) {
      const wantChrist = isChristWord[i];
      const wantDivine = isDivineWord[i];

      if (inDivine && (!wantDivine || wantChrist !== inChrist)) {
        parts.push('</span>');
        inDivine = false;
      }
      if (inChrist && !wantChrist) {
        parts.push('</span>');
        inChrist = false;
      }
      if (i > 0) parts.push(' ');
      if (!inChrist && wantChrist) {
        parts.push('<span class="christ-words">');
        inChrist = true;
      }
      if (!inDivine && wantDivine) {
        parts.push('<span class="divine-name">');
        inDivine = true;
      }
      parts.push(wantDivine ? toDivineNameCase(words[i]) : words[i]);
    }
    if (inDivine) parts.push('</span>');
    if (inChrist) parts.push('</span>');
    html = parts.join('');
  }

  // Swap the divine-name placeholder markers for real <span> tags now that Words
  // of Christ processing (which strips actual <...> tags but leaves these
  // non-tag markers alone) has had a chance to run. Casing is normalized here
  // rather than at the DIVINE_NAME_PATTERN replace because the captured content
  // may still hold nested OSIS tags at that point.
  if (html.includes(DIVINE_NAME_OPEN_MARKER)) {
    const markedSpan = new RegExp(`${DIVINE_NAME_OPEN_MARKER}([^${DIVINE_NAME_CLOSE_MARKER}]*)${DIVINE_NAME_CLOSE_MARKER}`, 'g');
    html = html.replace(markedSpan, (_match, inner: string) => {
      const cased = inner.split(/(\s+)/).map(part => (/\s/.test(part) ? part : toDivineNameCase(part))).join('');
      return `<span class="divine-name">${cased}</span>`;
    });
  }

  // Extract section heading
  const rawHeading = fd?.sectionHeading ?? fd?.section_heading;
  const sectionHeading = rawHeading ? rawHeading.replace(/<[^>]*>/g, '').trim() || undefined : undefined;

  return { textHtml: html, isParagraphStart, sectionHeading };
}

export function hasWordsOfChrist(fd: FormattingData | undefined): boolean {
  const woc = fd?.wordsOfChrist || fd?.words_of_christ;
  return (woc?.length ?? 0) > 0;
}

export function getFootnotes(fd: FormattingData | undefined): Array<{ position: number; marker: string; text: string }> {
  return fd?.footnotes ?? [];
}

