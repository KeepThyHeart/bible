/**
 * The `.hymn` format parser.
 *
 * Plain text is the source format rather than a database, and the reason is not
 * nostalgia: text files diff, blame, review and accept pull requests. A
 * public-domain hymn library is exactly the kind of asset that accumulates
 * corrections from many people over many years, and a database can do none of
 * those things. Anything faster is a build artifact, not a source.
 *
 * Two rules here are stricter than they look, and both come from watching the
 * old system fail quietly:
 *
 *  1. **An unrecognised bracketed directive is a hard error.** The old parser
 *     matched timestamps as `[T:10.3]` while its own sample data used a bare
 *     `[10.3]`, and its text-stripping regex removed both -- so every timestamp
 *     in that file silently parsed as "no timestamp" and nobody found out. A
 *     format that strips what it does not understand cannot be debugged.
 *  2. **An unrecognised metadata key is preserved, not dropped.** The opposite
 *     stance, for the opposite reason: the field set is deliberately open, and
 *     a parser that discards what it does not know silently destroys somebody's
 *     contribution. Unknown keys go through verbatim; the validator warns.
 *
 * Licensing is enforced here rather than trusted: anything not declared
 * `copyright: public-domain` is refused outright.
 */

import {
  type Hymn,
  type HymnLine,
  type HymnSection,
  type HymnSectionKind,
  type HymnalReference,
} from '../../../src/present/hymns.js';

export interface HymnParseIssue {
  line: number;
  message: string;
}

export type HymnParseResult =
  | { ok: true; hymn: Hymn; warnings: HymnParseIssue[] }
  | { ok: false; errors: HymnParseIssue[]; warnings: HymnParseIssue[] };

/** Metadata keys the tooling understands. Anything else is kept and warned about. */
const KNOWN_FIELDS = new Set([
  'id', 'title', 'first-line', 'alt-titles',
  'author', 'text-year', 'text-source', 'text-source-url',
  'translator', 'translator-year',
  'tune', 'composer', 'tune-year', 'arranger', 'arrangement-year', 'meter',
  'topics', 'season', 'tradition', 'scripture', 'hymnal', 'psalm', 'paraphrase-of',
  'popularity', 'tags', 'language', 'copyright', 'verse-order', 'audio',
]);

const SECTION_HEADINGS: Record<string, HymnSectionKind> = {
  verse: 'verse',
  refrain: 'refrain',
  // The same thing under the name half the world uses for it.
  chorus: 'refrain',
  bridge: 'bridge',
  coda: 'coda',
  interlude: 'interlude',
};

const TOKEN_FOR_KIND: Record<Exclude<HymnSectionKind, 'verse'>, string> = {
  refrain: 'R',
  bridge: 'B',
  coda: 'C',
  interlude: 'I',
};

const FENCE = '===';

/**
 * Parse a timestamp: seconds (`10.3`) or minutes and seconds (`1:01.4`).
 *
 * One syntax, always prefixed `T:`. Returning null here is what makes a
 * malformed timestamp an error at the call site rather than a line that quietly
 * loses its timing.
 */
export function parseTimestamp(value: string): number | null {
  const clock = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(value);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  return /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}

/** `Trinity Hymnal 1990: 460; Baptist Hymnal 1991: 330` */
function parseHymnals(value: string): HymnalReference[] {
  const out: HymnalReference[] = [];
  for (const entry of value.split(';')) {
    const at = entry.lastIndexOf(':');
    if (at < 0) continue;
    const hymnal = entry.slice(0, at).trim();
    const number = entry.slice(at + 1).trim();
    if (hymnal && number) out.push({ hymnal, number });
  }
  return out;
}

/**
 * Split a comma-separated field.
 *
 * Applied only to the fields catalogued as lists. Everything else keeps the
 * text exactly as the contributor wrote it, because a parser cannot know
 * whether a comma in an unknown field is a separator or a comma.
 */
function splitList(value: string): string[] {
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

export function parseHymn(source: string): HymnParseResult {
  const errors: HymnParseIssue[] = [];
  const warnings: HymnParseIssue[] = [];
  const fail = (line: number, message: string): void => { errors.push({ line, message }); };

  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  // -------------------------------------------------------------------------
  // The metadata block
  // -------------------------------------------------------------------------

  let at = 0;
  while (at < lines.length && lines[at].trim() === '') at++;
  if (lines[at]?.trim() !== FENCE) {
    return { ok: false, errors: [{ line: at + 1, message: `Expected a '${FENCE}' metadata fence` }], warnings };
  }
  at++;

  const fields: Record<string, string> = {};
  let closed = false;
  for (; at < lines.length; at++) {
    const raw = lines[at];
    const text = raw.trim();
    if (text === FENCE) { closed = true; at++; break; }
    // Blank lines inside the block are cosmetic grouping and mean nothing.
    if (text === '') continue;

    const split = text.indexOf(':');
    if (split <= 0) {
      fail(at + 1, `Expected 'key: value', got ${JSON.stringify(text)}`);
      continue;
    }
    const key = text.slice(0, split).trim().toLowerCase();
    const value = text.slice(split + 1).trim();
    if (key in fields) fail(at + 1, `Duplicate field '${key}'`);
    fields[key] = value;
    if (!KNOWN_FIELDS.has(key)) {
      // A warning, not an error: the field set is open on purpose, and a typo
      // should be visible without being fatal.
      warnings.push({ line: at + 1, message: `Unrecognised field '${key}' (kept as written)` });
    }
  }
  if (!closed) fail(lines.length, `Metadata block was never closed with '${FENCE}'`);

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  const sections: HymnSection[] = [];
  let current: HymnSection | null = null;
  let lastTimestamp = -Infinity;

  for (; at < lines.length; at++) {
    const text = lines[at].trim();
    if (text === '') continue;

    const heading = /^\[([a-zA-Z]+)(?:\s+(\d+))?\]$/.exec(text);
    if (heading) {
      const kind = SECTION_HEADINGS[heading[1].toLowerCase()];
      if (!kind) {
        fail(at + 1, `Unknown section '[${heading[1]}]'`);
        continue;
      }
      const number = heading[2] ? Number(heading[2]) : undefined;
      if (kind === 'verse' && number === undefined) {
        fail(at + 1, 'A verse needs a number, as in [verse 1]');
      }
      current = {
        kind,
        ...(number === undefined ? {} : { number }),
        token: kind === 'verse' ? String(number) : TOKEN_FOR_KIND[kind],
        lines: [],
      };
      sections.push(current);
      // Timestamps only have to increase within the file as a whole, which is
      // the property that makes audio sync coherent; a new section does not
      // reset the clock.
      continue;
    }

    if (!current) {
      fail(at + 1, 'Text before the first section heading');
      continue;
    }

    // A line may open with exactly one directive, and only a timestamp is one.
    let body = text;
    let stamp: number | undefined;
    const directive = /^\[([^\]]*)\]\s*/.exec(body);
    if (directive) {
      const inner = directive[1];
      if (!inner.startsWith('T:')) {
        // The rule the old format got wrong. Anything bracketed that is not
        // understood stops the parse rather than being stripped.
        fail(at + 1, `Unrecognised directive '[${inner}]'`);
        continue;
      }
      const seconds = parseTimestamp(inner.slice(2).trim());
      if (seconds === null) {
        fail(at + 1, `Bad timestamp '[${inner}]' -- expected [T:10.3] or [T:1:01.4]`);
        continue;
      }
      if (seconds < lastTimestamp) {
        fail(at + 1, `Timestamp ${seconds}s goes backwards from ${lastTimestamp}s`);
      }
      lastTimestamp = seconds;
      stamp = seconds;
      body = body.slice(directive[0].length);
    }

    const line: HymnLine = { text: body, ...(stamp === undefined ? {} : { at: stamp }) };
    current.lines.push(line);
  }

  // -------------------------------------------------------------------------
  // Required fields and coherence
  // -------------------------------------------------------------------------

  for (const required of ['id', 'title', 'first-line', 'copyright']) {
    if (!fields[required]) fail(1, `Missing required field '${required}'`);
  }
  if (fields.copyright && fields.copyright !== 'public-domain') {
    // The field exists so this can be refused rather than assumed.
    fail(1, `Only 'copyright: public-domain' may be admitted, not '${fields.copyright}'`);
  }
  if (fields.translator && !fields['translator-year']) {
    // A 1650 German text with a 1963 English translation is not public domain
    // in that translation. The same trap as `arranger`.
    fail(1, "'translator' requires 'translator-year'");
  }
  if (fields.arranger && !fields['arrangement-year']) {
    fail(1, "'arranger' requires 'arrangement-year'");
  }
  if (fields.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fields.id)) {
    fail(1, `Id ${JSON.stringify(fields.id)} must be a lower-case slug`);
  }
  if (sections.length === 0) fail(lines.length, 'No sections');
  for (const section of sections) {
    if (section.lines.length === 0) {
      fail(1, `Section '${section.token}' has no lines`);
    }
  }

  const byToken = new Set(sections.map(section => section.token));
  if (byToken.size !== sections.length) {
    fail(1, 'Two sections share the same order token');
  }

  const verseOrder = fields['verse-order']
    ? fields['verse-order'].trim().split(/\s+/)
    // Every section once, in file order -- which is what an unadorned hymn
    // means, and keeps the common case free of boilerplate.
    : sections.map(section => section.token);
  for (const token of verseOrder) {
    if (!byToken.has(token)) {
      fail(1, `verse-order names '${token}', which is not a section in this file`);
    }
  }

  const textYear = Number(fields['text-year']);
  if (Number.isFinite(textYear) && textYear > 1928 && !fields['text-source']) {
    // Not fatal: a later text may still be public domain by dedication or by
    // the author's death date. It does need somebody to have said why.
    warnings.push({ line: 1, message: `text-year ${textYear} is recent; record a 'text-source'` });
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  const hymn: Hymn = {
    id: fields.id,
    title: fields.title,
    firstLine: fields['first-line'],
    altTitles: fields['alt-titles'] ? splitList(fields['alt-titles']) : [],
    ...(fields.author ? { author: fields.author } : {}),
    ...(fields['text-year'] ? { textYear: fields['text-year'] } : {}),
    ...(fields.translator ? { translator: fields.translator } : {}),
    ...(fields.tune ? { tune: fields.tune } : {}),
    ...(fields.composer ? { composer: fields.composer } : {}),
    ...(fields['tune-year'] ? { tuneYear: fields['tune-year'] } : {}),
    ...(fields.arranger ? { arranger: fields.arranger } : {}),
    ...(fields.meter ? { meter: fields.meter } : {}),
    topics: fields.topics ? splitList(fields.topics) : [],
    season: fields.season ? splitList(fields.season) : [],
    tradition: fields.tradition ? splitList(fields.tradition) : [],
    hymnals: fields.hymnal ? parseHymnals(fields.hymnal) : [],
    scripture: fields.scripture ? splitList(fields.scripture) : [],
    ...(fields.psalm ? { psalm: fields.psalm } : {}),
    language: fields.language || 'en',
    sections,
    verseOrder,
    fields,
  };

  return { ok: true, hymn, warnings };
}
