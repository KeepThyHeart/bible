import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { PresentItem, PresentPlanEntry } from '../../lib/protocol';
import { LIMITS } from '../../lib/reducer';
import { docFromJSON, notesSchema as s, type ProseMirrorJSON } from './editor/schema';
import type { DetectResult, NoteHighlight, NotesItem } from './types';

/**
 * Pure plan logic: the plan is not stored anywhere, it is the notes' detected
 * items in document order. Reordering moves a whole *section* of the document
 * (the top-level block holding the item, plus the prose after it up to the
 * next item); removing unlinks the text so it stops being an item.
 */

export interface PlanItem {
  /** The NotesItem id (stable across edits elsewhere); also the server entry's `notesItemId`. */
  id: string;
  /** What Play shows. Null for an amber item with nothing showable yet (an ambiguous hymn). */
  item: PresentItem | null;
  label: string;
  status: 'ok' | 'choose';
  reason?: { key: string; params?: Record<string, unknown> };
  /** Bold highlights attached to this item. */
  highlights: NoteHighlight[];
}

/** The plan as the detector sees the notes: every item, in document order. */
export function derivePlanItems(result: DetectResult | null): PlanItem[] {
  if (!result) return [];
  const byItem = new Map<string, NoteHighlight[]>();
  for (const h of result.highlights) {
    if (!h.itemId) continue;
    const list = byItem.get(h.itemId) ?? [];
    list.push(h);
    byItem.set(h.itemId, list);
  }
  return result.items.map((it) => ({
    id: it.id,
    item: it.item,
    label: it.label,
    status: it.status,
    ...(it.reason ? { reason: it.reason } : {}),
    highlights: byItem.get(it.id) ?? [],
  }));
}

/** `value` clipped to `max` characters; undefined when nothing is left (the server rejects empty strings). */
function clip(value: string | undefined, max: number): string | undefined {
  const out = value?.trim().slice(0, max).trim();
  return out ? out : undefined;
}

/**
 * `item` with its text fields cut to the protocol's LIMITS, so one long
 * `Quote:` line cannot make the whole `PUT /plan` fail with 400. Null when the
 * item has nothing left to show (its main text clipped to empty).
 */
function fitItem(item: PresentItem): PresentItem | null {
  switch (item.kind) {
    case 'text': {
      const body = clip(item.body, LIMITS.textBody);
      if (!body) return null;
      const { title: t, attribution: a, ...rest } = item;
      const title = clip(t, LIMITS.textTitle), attribution = clip(a, LIMITS.textAttribution);
      return { ...rest, body, ...(title ? { title } : {}), ...(attribution ? { attribution } : {}) };
    }
    case 'quote': {
      const text = clip(item.text, LIMITS.quoteText);
      if (!text) return null;
      const { attribution: a, ...rest } = item;
      const attribution = clip(a, LIMITS.quoteAttribution);
      return { ...rest, text, ...(attribution ? { attribution } : {}) };
    }
    default:
      return item;
  }
}

/**
 * The server-side running order for `planItems`: showable items only, each
 * tagged with `notesItemId`. Entries the server already knows (same
 * `notesItemId`) keep their id, so old id-based calls stay valid; new ones get
 * an empty id, which the server fills in. The result respects the protocol
 * LIMITS: over-long text is clipped and at most `LIMITS.planEntries` entries
 * are kept.
 */
export function deriveServerPlan(planItems: readonly PlanItem[], current: readonly PresentPlanEntry[]): PresentPlanEntry[] {
  const known = new Map<string, PresentPlanEntry>();
  for (const e of current) if (e.notesItemId) known.set(e.notesItemId, e);
  const out: PresentPlanEntry[] = [];
  for (const p of planItems) {
    if (out.length >= LIMITS.planEntries) break;
    const item = p.item && fitItem(p.item);
    if (!item) continue;
    const prev = known.get(p.id);
    const note = clip(prev?.note, LIMITS.planNote);
    const notesItemId = p.id.slice(0, LIMITS.notesItemId);
    out.push({ id: prev?.id ?? '', item, ...(note ? { note } : {}), notesItemId });
  }
  return out;
}

/** True when two plans would be the same on the server (ignores server-minted ids). */
export function samePlan(a: readonly PresentPlanEntry[], b: readonly PresentPlanEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => e.notesItemId === b[i].notesItemId && e.note === b[i].note && JSON.stringify(e.item) === JSON.stringify(b[i].item));
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface Segment {
  /** Top-level child indices [start, end). */
  start: number;
  end: number;
  itemIds: string[];
}

/** Top-level child index of the block at document position `pos`. */
function childIndexAt(doc: PMNode, pos: number): number {
  let found = -1;
  doc.forEach((child, offset, index) => {
    if (pos >= offset && pos < offset + child.nodeSize) found = index;
  });
  return found;
}

/**
 * Split the document's top-level nodes into a leading run (before any item)
 * and one segment per top-level node that holds items, extended over the
 * nodes after it. Items sharing a node (say, two lines of one list) share a
 * segment and move together.
 */
export function planSegments(doc: PMNode, items: readonly NotesItem[]): { leading: number; segments: Segment[] } {
  const starts = new Map<number, string[]>();
  for (const it of items) {
    const idx = childIndexAt(doc, it.blockPos);
    if (idx < 0) continue;
    const ids = starts.get(idx) ?? [];
    ids.push(it.id);
    starts.set(idx, ids);
  }
  const keys = [...starts.keys()].sort((a, b) => a - b);
  const segments = keys.map((start, i) => ({
    start,
    end: i + 1 < keys.length ? keys[i + 1] : doc.childCount,
    itemIds: starts.get(start)!,
  }));
  return { leading: keys.length ? keys[0] : doc.childCount, segments };
}

/**
 * Move the section of item `id` to where plan item number `toIndex` is
 * (moving down puts it after that item's section, up puts it before).
 * Returns the new document, or null when nothing would change.
 */
export function moveSection(
  json: ProseMirrorJSON | null,
  items: readonly NotesItem[],
  id: string,
  toIndex: number,
): ProseMirrorJSON | null {
  const from = items.findIndex((i) => i.id === id);
  if (from < 0 || items.length === 0) return null;
  const target = items[Math.max(0, Math.min(items.length - 1, toIndex))];
  const doc = docFromJSON(json);
  const { segments } = planSegments(doc, items);
  const src = segments.findIndex((seg) => seg.itemIds.includes(id));
  const dst = segments.findIndex((seg) => seg.itemIds.includes(target.id));
  if (src < 0 || dst < 0 || src === dst) return null;

  const order = segments.map((_, i) => i);
  order.splice(src, 1);
  order.splice(dst, 0, src); // after removal, index `dst` is "after" target when moving down, "before" it when up
  const children: PMNode[] = [];
  const all: PMNode[] = [];
  doc.forEach((child) => all.push(child));
  const first = segments.length ? segments[0].start : all.length;
  children.push(...all.slice(0, first));
  for (const i of order) children.push(...all.slice(segments[i].start, segments[i].end));
  return s.topNodeType.create(null, children).toJSON() as ProseMirrorJSON;
}

// ---------------------------------------------------------------------------
// Unlink
// ---------------------------------------------------------------------------

/** The document with the item's text marked "not an item" (the text itself is untouched). */
export function unlinkItemInDoc(json: ProseMirrorJSON | null, item: NotesItem): ProseMirrorJSON {
  const doc = docFromJSON(json);
  const from = item.blockPos + 1 + item.from;
  const to = (item.endBlockPos ?? item.blockPos) + 1 + (item.endTo ?? item.to);
  const tr = EditorState.create({ doc }).tr
    .removeMark(from, to, s.marks.pin)
    .removeMark(from, to, s.marks.unlink)
    .addMark(from, to, s.marks.unlink.create());
  return tr.doc.toJSON() as ProseMirrorJSON;
}

/** A cheap fingerprint of a document, for "is this what I last sent". */
export function docKey(doc: ProseMirrorJSON | null): string {
  const str = JSON.stringify(doc ?? null);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${str.length}:${(h >>> 0).toString(36)}`;
}

/**
 * A new paragraph holding `phrase` in bold, right after the top-level block of
 * item `id` (so bold matching finds the passage above it). Null if the item
 * is not in the document.
 */
export function addBoldLine(json: ProseMirrorJSON | null, items: readonly NotesItem[], id: string, phrase: string): ProseMirrorJSON | null {
  const item = items.find((i) => i.id === id);
  const text = phrase.trim();
  if (!item || !text) return null;
  const doc = docFromJSON(json);
  const idx = childIndexAt(doc, item.endBlockPos ?? item.blockPos);
  if (idx < 0) return null;
  const para = s.nodes.paragraph.create(null, s.text(text, [s.marks.bold.create()]));
  const children: PMNode[] = [];
  doc.forEach((child, _o, i) => {
    children.push(child);
    if (i === idx) children.push(para);
  });
  return s.topNodeType.create(null, children).toJSON() as ProseMirrorJSON;
}

/** True when the document has no text at all. */
export function isBlankDoc(json: ProseMirrorJSON | null): boolean {
  return docFromJSON(json).textContent.trim() === '';
}

/** The document with a plain paragraph `text` at the end (reusing a trailing empty paragraph). */
export function appendTextParagraph(json: ProseMirrorJSON | null, text: string): ProseMirrorJSON {
  const doc = docFromJSON(json);
  const last = doc.lastChild!;
  const reuse = last.type === s.nodes.paragraph && last.content.size === 0;
  const children: PMNode[] = [];
  doc.forEach((child, _o, i) => {
    if (!(reuse && i === doc.childCount - 1)) children.push(child);
  });
  children.push(s.nodes.paragraph.create(null, text ? s.text(text) : undefined));
  return s.topNodeType.create(null, children).toJSON() as ProseMirrorJSON;
}

/**
 * The document without a highlight's bold text. A top-level paragraph that is
 * nothing but that phrase goes entirely (a "bold phrase line"); otherwise just
 * the phrase is deleted.
 */
export function removeHighlightInDoc(json: ProseMirrorJSON | null, h: Pick<NoteHighlight, 'blockPos' | 'from' | 'to'>): ProseMirrorJSON {
  const doc = docFromJSON(json);
  const block = doc.nodeAt(h.blockPos);
  if (!block || !block.isTextblock) return doc.toJSON() as ProseMirrorJSON;
  const tr = EditorState.create({ doc }).tr;
  const wholeLine = h.from <= 0 && h.to >= block.content.size && doc.resolve(h.blockPos).depth === 0 && doc.childCount > 1;
  if (wholeLine) tr.delete(h.blockPos, h.blockPos + block.nodeSize);
  else tr.delete(h.blockPos + 1 + h.from, h.blockPos + 1 + h.to);
  return tr.doc.toJSON() as ProseMirrorJSON;
}
