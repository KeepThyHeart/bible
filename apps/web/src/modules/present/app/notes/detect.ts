/**
 * Smart parsing of the presenter's notes: which bits of text are items (a
 * passage, a hymn, a quote), and which bold words are highlights in which
 * verse.
 *
 * Pure and editor-independent: blocks in (see `types.ts`), items and
 * highlights out, offsets relative to each block. The editor draws the result
 * as decorations; nothing is written back into the document.
 *
 * Detection runs in two phases:
 *
 *  1. **Per block** (`scanBlock`): references, `v. 18` continuations, hymn
 *     lines, `Quote:` lines and bold spans, with `pin`/`unlink` applied. It
 *     depends only on the block's own text, kind and marks (plus the options),
 *     so it is memoised by those: re-running on a document where one paragraph
 *     changed re-scans one paragraph.
 *  2. **In context** (`detect`): blockquote paragraphs grouped into quotes,
 *     continuations and bold words attached to the nearest passage above, ids
 *     assigned and sections built. That is a linear walk over cached results.
 *
 * **Sections.** A section is the block containing an item plus the blocks
 * after it, up to the next block containing an item. A continuation or a bold
 * word looks back only through the current and the previous section, so a
 * stray "v. 4" at the end of a long sermon does not attach to Genesis.
 */

import { scanReferences } from '../../lib/referenceScan';
import type { HighlightRange, PresentItem, PresentPassageItem } from '../../lib/protocol';
import { parseHymnLine, resolveHymn, type HymnResolution } from './hymnMatch';
import { matchPhrase } from './highlightMatch';
import type {
  ChapterRef, DetectOptions, DetectResult, NoteHighlight, NotesBlock, NotesItem, NotesItemKind,
  NotesMark, NotesReason, NotesSection, VerseText,
} from './types';

// ---------------------------------------------------------------------------
// Per-block scan
// ---------------------------------------------------------------------------

interface Span { from: number; to: number }

/** A reference found in the text, before a module or id is decided. */
interface RefCandidate extends Span {
  kind: 'passage';
  book: number;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  /** The book as written ("Rom"), for labelling continuations. */
  bookText: string;
  module?: string;
  label: string;
}

interface ContinuationCandidate extends Span {
  kind: 'continuation';
  verseStart: number;
  verseEnd?: number;
  module?: string;
  label: string;
}

interface HymnCandidate extends Span {
  kind: 'hymn';
  label: string;
  resolution: HymnResolution;
}

interface QuoteCandidate extends Span {
  kind: 'quote';
  label: string;
  text: string;
  attribution?: string;
}

interface PinnedCandidate extends Span {
  kind: 'pinned';
  label: string;
  item: PresentItem;
}

type Candidate = RefCandidate | ContinuationCandidate | HymnCandidate | QuoteCandidate | PinnedCandidate;

interface BoldSpan extends Span {
  text: string;
  /** From a `pin` mark over the bold: an explicit range, or null for "not a highlight". */
  pinned?: HighlightRange | null;
}

interface ScannedBlock {
  candidates: Candidate[];
  bolds: BoldSpan[];
  unlinks: Span[];
}

const overlaps = (a: Span, b: Span): boolean => a.from < b.to && b.from < a.to;

/** Merge touching or overlapping spans of one mark type. */
function mergeSpans(marks: NotesMark[]): NotesMark[] {
  const sorted = [...marks].sort((a, b) => a.from - b.from);
  const out: NotesMark[] = [];
  for (const mark of sorted) {
    const last = out[out.length - 1];
    if (last && mark.from <= last.to) last.to = Math.max(last.to, mark.to);
    else out.push({ ...mark });
  }
  return out;
}

/** Lines of a block (hard breaks are `\n`), with their offsets. */
function lines(text: string): Array<{ text: string; from: number }> {
  const out: Array<{ text: string; from: number }> = [];
  let from = 0;
  for (const line of text.split('\n')) {
    out.push({ text: line, from });
    from += line.length + 1;
  }
  return out;
}

/** `3:16–4:2`: blank the second half so `scanReferences` reads `3:16`, and remember it. */
const CROSS_CHAPTER_RE = /(\d{1,3}:\d{1,3})(\s*[-–—]\s*(\d{1,3}):(\d{1,3}))/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every reference in `text` with its position.
 *
 * `scanReferences` returns what it matched but not where, and drops exact
 * repeats. So each result is located by searching for its matched text (with
 * whitespace loosened, since the scanner collapses it), and the text is then
 * scanned again with the found spans blanked out, which surfaces the repeats.
 * Blanking keeps the length, so offsets never shift.
 */
function scanPositions(text: string): Array<{ from: number; to: number; ref: ReturnType<typeof scanReferences>[number] }> {
  const out: Array<{ from: number; to: number; ref: ReturnType<typeof scanReferences>[number] }> = [];
  let working = text;
  for (let pass = 0; pass < 20; pass++) {
    const found = scanReferences(working);
    if (!found.length) break;
    let cursor = 0;
    let blanked = working;
    let progressed = false;
    for (const ref of found) {
      const pattern = new RegExp(escapeRegExp(ref.matchedText).replace(/ /g, '\\s+'), 'gi');
      pattern.lastIndex = cursor;
      const match = pattern.exec(working);
      if (!match) continue;
      const from = match.index;
      const to = from + match[0].length;
      out.push({ from, to, ref });
      blanked = blanked.slice(0, from) + ' '.repeat(to - from) + blanked.slice(to);
      cursor = to;
      progressed = true;
    }
    if (!progressed) break;
    working = blanked;
  }
  return out.sort((a, b) => a.from - b.from);
}

/** A trailing `(ESV)` or ` ESV` right after a reference. */
function trailingModule(text: string, at: number, modules: readonly string[] | undefined): { module: string; to: number } | null {
  const rest = text.slice(at);
  const paren = /^\s*\(\s*([A-Za-z][A-Za-z0-9]{1,9})\s*\)/.exec(rest);
  const bare = paren ? null : /^\s+([A-Z][A-Z0-9]{1,9})\b/.exec(rest);
  const match = paren ?? bare;
  if (!match) return null;
  const code = match[1];
  if (modules) {
    const known = modules.find(id => id.toLowerCase() === code.toLowerCase());
    return known ? { module: known, to: at + match[0].length } : null;
  }
  return { module: code.toUpperCase(), to: at + match[0].length };
}

/** `v. 18`, `vv. 18–20`, `v18`, `verse 18`, `verses 18-20`. */
const CONTINUATION_RE = /\b(?:vv?\.?|vs\.?|verses?)\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\b/gi;

const QUOTE_LINE_RE = /^(\s*)quote\s*[:\-–—]\s*/i;
const ATTRIBUTION_RE = /^\s*(?:—|―|--|–)\s*(.+?)\s*$/;

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  const match = /^["“‘'](.*)["”’']$/s.exec(trimmed);
  return (match ? match[1] : trimmed).trim();
}

/** Split a quote body into text and attribution (a last line starting with a dash). */
function splitQuote(body: string): { text: string; attribution?: string } {
  const bodyLines = body.split('\n').map(line => line.trimEnd());
  while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
  let attribution: string | undefined;
  if (bodyLines.length > 1) {
    const last = ATTRIBUTION_RE.exec(bodyLines[bodyLines.length - 1]);
    if (last) { attribution = last[1]; bodyLines.pop(); }
  }
  let text = bodyLines.join('\n').trim();
  if (!attribution) {
    // Inline: `"…" — Spurgeon`, or `… -- Spurgeon`.
    const inline = /^(["“‘'].*["”’'])\s*(?:—|―|--|–|-)\s*(.+)$/s.exec(text) ?? /^(.*?)\s+(?:—|―|--)\s*(\S.*)$/s.exec(text);
    if (inline) { text = inline[1]; attribution = inline[2].trim(); }
  }
  return attribution ? { text: stripWrappingQuotes(text), attribution } : { text: stripWrappingQuotes(text) };
}

/** "Rom 8:28" -> "Rom", "Ps. 23" -> "Ps". */
function bookTextOf(reference: string): string {
  return reference.replace(/\.?\s*\d{1,3}(?:[:\s–—-].*)?$/, '').trim();
}

function labelFor(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function scanBlock(block: NotesBlock, options: DetectOptions): ScannedBlock {
  const { text } = block;
  const byType = (type: NotesMark['type']) => block.marks.filter(mark => mark.type === type && mark.to > mark.from);
  const unlinks: Span[] = mergeSpans(byType('unlink')).map(({ from, to }) => ({ from, to }));
  const pins = byType('pin');

  let candidates: Candidate[] = [];

  // Blockquotes are grouped into quotes in context; nothing else is detected inside them.
  if (block.kind !== 'blockquote') {
    const lineList = lines(text);
    const refs = scanPositions(text.replace(CROSS_CHAPTER_RE, (whole, first: string, second: string) =>
      first + ' '.repeat(second.length)));
    const cross = new Map<number, { to: number; text: string }>();
    for (const match of text.matchAll(CROSS_CHAPTER_RE)) {
      const end = match.index + match[1].length;
      cross.set(end, { to: end + match[2].length, text: match[2] });
    }

    // Hymn and quote lines own their whole line.
    const lineOwners: Span[] = [];
    for (const line of lineList) {
      const lineStart = line.from + (line.text.length - line.text.trimStart().length);
      const startsWithRef = refs.some(ref => ref.from === lineStart);
      if (!startsWithRef) {
        const parsed = parseHymnLine(line.text);
        if (parsed) {
          const span = { from: line.from + parsed.from, to: line.from + parsed.to };
          const label = parsed.title ?? parsed.number ?? '';
          candidates.push({ kind: 'hymn', ...span, label, resolution: resolveHymn(parsed, options.hymns, { hymnal: options.hymnal }) });
          lineOwners.push(span);
          continue;
        }
      }
      const quote = QUOTE_LINE_RE.exec(line.text);
      if (quote) {
        // A `Quote:` line takes the rest of the block: the lines after it are its body.
        const from = line.from + quote[1].length;
        const to = text.trimEnd().length;
        const body = text.slice(line.from + quote[0].length, to);
        const { text: quoteText, attribution } = splitQuote(body);
        if (quoteText) {
          candidates.push({ kind: 'quote', from, to, label: labelFor(quoteText), text: quoteText, attribution });
          lineOwners.push({ from, to });
        }
        break;
      }
    }

    for (const { from, to: end, ref } of refs) {
      let to = end;
      if (lineOwners.some(owner => overlaps(owner, { from, to }))) continue;

      let label = text.slice(from, to);
      const crossing = cross.get(to);
      if (crossing) { label += crossing.text; to = crossing.to; }
      const bookText = bookTextOf(ref.matchedText);

      const candidate: RefCandidate = {
        kind: 'passage', from, to, book: ref.book, chapter: ref.chapter, bookText, label: label.replace(/\s+/g, ' ').trim(),
      };
      if (ref.verseStart !== undefined) candidate.verseStart = ref.verseStart;
      // A cross-chapter range runs to the end of its first chapter: the protocol has one chapter per item.
      if (ref.verseEnd !== undefined && !crossing) candidate.verseEnd = ref.verseEnd;
      const module = trailingModule(text, to, options.modules);
      if (module) { candidate.module = module.module; candidate.to = module.to; }
      candidates.push(candidate);
    }

    for (const match of text.matchAll(CONTINUATION_RE)) {
      const span = { from: match.index, to: match.index + match[0].length };
      if (candidates.some(other => overlaps(other, span))) continue;
      const verseStart = Number(match[1]);
      const verseEnd = match[2] !== undefined ? Number(match[2]) : undefined;
      if (verseStart < 1 || (verseEnd !== undefined && verseEnd < verseStart)) continue;
      const candidate: ContinuationCandidate = { kind: 'continuation', ...span, verseStart, label: match[0] };
      if (verseEnd !== undefined && verseEnd !== verseStart) candidate.verseEnd = verseEnd;
      const module = trailingModule(text, span.to, options.modules);
      if (module) { candidate.module = module.module; candidate.to = module.to; }
      candidates.push(candidate);
    }
  }

  // An explicit choice replaces whatever was detected under it.
  for (const pin of pins.filter(p => p.attrs?.item)) {
    const span = { from: pin.from, to: pin.to };
    candidates = candidates.filter(candidate => !overlaps(candidate, span));
    candidates.push({ kind: 'pinned', ...span, label: labelFor(text.slice(span.from, span.to)), item: pin.attrs!.item! });
  }

  candidates = candidates
    .filter(candidate => !unlinks.some(unlink => overlaps(unlink, candidate)))
    .sort((a, b) => a.from - b.from);

  const bolds: BoldSpan[] = [];
  for (const bold of mergeSpans(byType('bold'))) {
    const raw = text.slice(bold.from, bold.to);
    const from = bold.from + (raw.length - raw.trimStart().length);
    const to = bold.from + raw.trimEnd().length;
    if (to <= from || !/[\p{L}\p{N}]/u.test(raw)) continue;
    const span = { from, to };
    if (unlinks.some(unlink => overlaps(unlink, span))) continue;
    if (candidates.some(candidate => overlaps(candidate, span))) continue;
    const boldSpan: BoldSpan = { ...span, text: text.slice(from, to) };
    const pin = pins.find(p => p.attrs && 'range' in p.attrs && overlaps(p, span));
    if (pin) boldSpan.pinned = pin.attrs!.range ?? null;
    bolds.push(boldSpan);
  }

  return { candidates, bolds, unlinks };
}

// ---------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------

export interface NotesDetector {
  /** Detect items and highlights. Reuses per-block work from the previous call. */
  detect(blocks: readonly NotesBlock[], options: DetectOptions): DetectResult;
}

function blockKey(block: NotesBlock): string {
  const marks = block.marks
    .map(mark => `${mark.type}:${mark.from}-${mark.to}:${mark.attrs ? JSON.stringify(mark.attrs) : ''}`)
    .sort()
    .join('|');
  return `${block.kind}\u0001${block.text}\u0001${marks}`;
}

function optionsKey(options: DetectOptions): string {
  return `${options.module}\u0001${options.modules?.join(',') ?? ''}\u0001${options.hymnal ?? ''}`;
}

function reason(key: string, params?: NotesReason['params']): NotesReason {
  return params ? { key: `present.notes.reason.${key}`, params } : { key: `present.notes.reason.${key}` };
}

function itemKind(item: PresentItem): NotesItemKind {
  return item.kind === 'passage' ? 'passage' : item.kind === 'hymn' ? 'hymn' : 'quote';
}

interface PassageEntry {
  id: string;
  blockIndex: number;
  item: PresentPassageItem;
  label: string;
  bookText: string;
}

/** The verses of a passage the bold matcher searches: one verse, a range, or the whole chapter. */
function passageVerses(passage: PresentPassageItem, verses: readonly VerseText[]): VerseText[] {
  if (passage.verseStart === undefined) return [...verses];
  const last = passage.verseEnd ?? passage.verseStart;
  return verses.filter(verse => verse.verse >= passage.verseStart! && verse.verse <= last);
}

function formatVerses(start: number, end?: number): string {
  return end !== undefined && end !== start ? `${start}-${end}` : String(start);
}

/**
 * A detector with its own memo. Keep one per editor; the memo holds only the
 * blocks seen in the latest call, so it does not grow with editing history.
 */
export function createNotesDetector(): NotesDetector {
  let memo = new Map<string, ScannedBlock>();
  let memoOptions = '';
  let memoHymns: DetectOptions['hymns'];

  return {
    detect(blocks, options) {
      const key = optionsKey(options);
      if (key !== memoOptions || options.hymns !== memoHymns) {
        memo = new Map();
        memoOptions = key;
        memoHymns = options.hymns;
      }
      const nextMemo = new Map<string, ScannedBlock>();
      const scanned = blocks.map(block => {
        const k = blockKey(block);
        const hit = nextMemo.get(k) ?? memo.get(k) ?? scanBlock(block, options);
        nextMemo.set(k, hit);
        return hit;
      });
      memo = nextMemo;
      return resolve(blocks, scanned, options);
    },
  };
}

/** One-shot detection with no memo, for tests and callers that run once. */
export function detectNotes(blocks: readonly NotesBlock[], options: DetectOptions): DetectResult {
  return createNotesDetector().detect(blocks, options);
}

function resolve(blocks: readonly NotesBlock[], scanned: ScannedBlock[], options: DetectOptions): DetectResult {
  const items: NotesItem[] = [];
  const highlights: NoteHighlight[] = [];
  const needs = new Map<string, ChapterRef>();

  /** Distinct block indices that hold at least one item so far, in order. */
  const itemBlocks: number[] = [];
  const passages: PassageEntry[] = [];
  const usedIds = new Set<string>();

  const makeId = (blockIndex: number, tag: string): string => {
    const base = `${blocks[blockIndex].id ?? blocks[blockIndex].pos}:${tag}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}#${n}`;
    usedIds.add(id);
    return id;
  };

  const noteItemBlock = (blockIndex: number): void => {
    if (itemBlocks[itemBlocks.length - 1] !== blockIndex) itemBlocks.push(blockIndex);
  };

  /**
   * The nearest passage above, within the current and previous sections --
   * that is, in one of the last two blocks that hold items. Passages are in
   * document order, so only the latest one can qualify.
   */
  const passageInReach = (): PassageEntry | null => {
    const latest = passages[passages.length - 1];
    return latest && itemBlocks.slice(-2).includes(latest.blockIndex) ? latest : null;
  };

  const push = (entry: NotesItem, blockIndex: number, bookText = bookTextOf(entry.label)): void => {
    items.push(entry);
    noteItemBlock(blockIndex);
    if (entry.item?.kind === 'passage') {
      passages.push({ id: entry.id, blockIndex, item: entry.item, label: entry.label, bookText });
    }
  };

  const addHighlight = (bold: BoldSpan, blockIndex: number): void => {
    const block = blocks[blockIndex];
    const id = makeId(blockIndex, `b:${bold.text.toLowerCase()}`);
    const base = { id, blockPos: block.pos, from: bold.from, to: bold.to, text: bold.text };
    const passage = passageInReach();

    if (bold.pinned !== undefined) {
      if (bold.pinned === null) return;
      highlights.push({ ...base, itemId: passage?.id ?? null, range: bold.pinned, status: 'ok', source: 'pinned' });
      return;
    }
    if (!passage) {
      highlights.push({ ...base, itemId: null, range: null, status: 'choose', reason: reason('noPassage'), source: 'detected' });
      return;
    }
    const { module, book, chapter } = passage.item;
    const verses = options.getChapter?.(module, book, chapter);
    if (!verses) {
      needs.set(`${module}/${book}/${chapter}`, { module, book, chapter });
      highlights.push({ ...base, itemId: passage.id, range: null, status: 'pending', source: 'detected' });
      return;
    }
    const range = matchPhrase(bold.text, passageVerses(passage.item, verses));
    highlights.push(range
      ? { ...base, itemId: passage.id, range, status: 'ok', source: 'detected' }
      : {
          ...base, itemId: passage.id, range: null, status: 'choose',
          reason: reason('notFoundInPassage', { ref: passage.label, text: bold.text }), source: 'detected',
        });
  };

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];

    if (block.kind === 'blockquote') {
      // Gather this quote's paragraphs: consecutive blockquote blocks sharing a group.
      let last = blockIndex;
      if (block.group !== undefined) {
        while (last + 1 < blocks.length && blocks[last + 1].kind === 'blockquote' && blocks[last + 1].group === block.group) last++;
      }
      const group = blocks.slice(blockIndex, last + 1);
      const groupScans = scanned.slice(blockIndex, last + 1);
      const pinned = groupScans.flatMap(scan => scan.candidates).find(c => c.kind === 'pinned') as PinnedCandidate | undefined;
      const unlinked = groupScans.some(scan => scan.unlinks.length > 0);
      const lastBlock = group[group.length - 1];
      const extent = {
        blockPos: block.pos, from: 0, to: block.text.length,
        ...(last > blockIndex ? { endBlockPos: lastBlock.pos, endTo: lastBlock.text.length } : {}),
      };
      if (pinned) {
        push({ id: makeId(blockIndex, 'pin'), ...extent, kind: itemKind(pinned.item), item: pinned.item, status: 'ok', source: 'pinned', label: pinned.label }, blockIndex);
      } else if (!unlinked) {
        const { text, attribution } = splitQuote(group.map(b => b.text).join('\n'));
        if (text) {
          const item: PresentItem = attribution ? { kind: 'quote', text, attribution } : { kind: 'quote', text };
          push({ id: makeId(blockIndex, `q:${labelFor(text, 24).toLowerCase()}`), ...extent, kind: 'quote', item, status: 'ok', source: 'detected', label: labelFor(text) }, blockIndex);
        }
      }
      // Bold inside a quote is part of the quote, not a highlight.
      blockIndex = last;
      continue;
    }

    const scan = scanned[blockIndex];
    // Walk items and bold spans together, in text order, so a bold word sees
    // only the passages before it.
    const events: Array<{ at: number; candidate?: Candidate; bold?: BoldSpan }> = [
      ...scan.candidates.map(candidate => ({ at: candidate.from, candidate })),
      ...scan.bolds.map(bold => ({ at: bold.from, bold })),
    ].sort((a, b) => a.at - b.at);

    for (const event of events) {
      if (event.bold) { addHighlight(event.bold, blockIndex); continue; }
      const c = event.candidate!;
      const at = { blockPos: block.pos, from: c.from, to: c.to };

      switch (c.kind) {
        case 'passage': {
          const item: PresentPassageItem = { kind: 'passage', module: c.module ?? options.module, book: c.book, chapter: c.chapter };
          if (c.verseStart !== undefined) item.verseStart = c.verseStart;
          if (c.verseEnd !== undefined) item.verseEnd = c.verseEnd;
          const tag = `p:${c.book}.${c.chapter}.${c.verseStart ?? ''}.${c.verseEnd ?? ''}`;
          push({ id: makeId(blockIndex, tag), ...at, kind: 'passage', item, status: 'ok', source: 'detected', label: c.label }, blockIndex, c.bookText);
          break;
        }
        case 'continuation': {
          const base = passageInReach();
          if (!base) break; // Nothing to continue: ignored, per the design.
          const item: PresentPassageItem = {
            kind: 'passage', module: c.module ?? base.item.module, book: base.item.book, chapter: base.item.chapter,
            verseStart: c.verseStart,
          };
          if (c.verseEnd !== undefined) item.verseEnd = c.verseEnd;
          const label = `${base.bookText} ${item.chapter}:${formatVerses(c.verseStart, c.verseEnd)}`;
          push({
            id: makeId(blockIndex, `v:${c.verseStart}.${c.verseEnd ?? ''}`), ...at, kind: 'passage', item,
            status: 'ok', source: 'detected', label, continuationOf: base.id,
          }, blockIndex, base.bookText);
          break;
        }
        case 'hymn': {
          const { resolution } = c;
          const entry: NotesItem = {
            id: makeId(blockIndex, `h:${c.label.toLowerCase()}`), ...at, kind: 'hymn', item: resolution.item,
            status: resolution.status, source: 'detected', label: c.label,
          };
          if (resolution.reason) entry.reason = resolution.reason;
          if (resolution.candidates) entry.candidates = resolution.candidates;
          push(entry, blockIndex);
          break;
        }
        case 'quote':
          push({
            id: makeId(blockIndex, `q:${labelFor(c.text, 24).toLowerCase()}`), ...at, kind: 'quote',
            item: c.attribution ? { kind: 'quote', text: c.text, attribution: c.attribution } : { kind: 'quote', text: c.text },
            status: 'ok', source: 'detected', label: c.label,
          }, blockIndex);
          break;
        case 'pinned':
          push({ id: makeId(blockIndex, 'pin'), ...at, kind: itemKind(c.item), item: c.item, status: 'ok', source: 'pinned', label: c.label }, blockIndex);
          break;
      }
    }
  }

  return { items, highlights, sections: buildSections(blocks, items), needsChapters: [...needs.values()] };
}

function buildSections(blocks: readonly NotesBlock[], items: NotesItem[]): NotesSection[] {
  const byBlock = new Map<number, string[]>();
  for (const item of items) {
    const list = byBlock.get(item.blockPos) ?? [];
    list.push(item.id);
    byBlock.set(item.blockPos, list);
  }
  const covered = new Set(items.filter(item => item.endBlockPos !== undefined).flatMap(item => {
    const start = blocks.findIndex(block => block.pos === item.blockPos);
    const end = blocks.findIndex(block => block.pos === item.endBlockPos);
    return blocks.slice(start + 1, end + 1).map(block => block.pos);
  }));

  const sections: NotesSection[] = [];
  for (const block of blocks) {
    const ids = covered.has(block.pos) ? undefined : byBlock.get(block.pos);
    if (ids) sections.push({ blocks: [block.pos], itemIds: ids });
    else if (!sections.length) sections.push({ blocks: [block.pos], itemIds: [] });
    else sections[sections.length - 1].blocks.push(block.pos);
  }
  return sections;
}
