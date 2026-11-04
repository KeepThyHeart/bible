/** The three verse-menu actions (lazy): Highlight (opens the colour popover), Note (opens the editor), Bookmark (toggles). */
import type { VerseActionContext, VerseActionHandler } from '@bible/core/browser';
import i18n from '../../i18n';
import { moduleStore } from '../../stores/moduleStore';
import { formatVerseRange } from '../../utils/verseId';
import { annotationUi } from './annotationUi';
import { annotationStore } from './instance';

const t = (key: string, options?: Record<string, unknown>): string => i18n.t(`annotations.${key}`, options) as string;

interface Target { moduleId: number; start: number; end: number }

function targetOf(ctx: VerseActionContext): Target | null {
  const moduleId = moduleStore.availableModules.find((m) => m.abbreviation === ctx.module)?.module_id;
  const ids = ctx.verseIds.length > 0 ? ctx.verseIds : [ctx.verseId];
  if (moduleId === undefined) return null;
  return { moduleId, start: Math.min(...ids), end: Math.max(...ids) };
}

const overlaps = (a: { start: number; end: number }, start: number, end: number) => a.start <= end && a.end >= start;

async function guarded(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn('[annotations] action failed', err);
    annotationUi.showToast(t('error'));
  }
}

export const highlightHandler: VerseActionHandler = {
  run: (ctx) => guarded(async () => {
    const target = targetOf(ctx);
    if (!target) return;
    const { moduleId, start, end } = target;
    const { highlights } = await annotationStore.fetch(moduleId, start, end);
    const mine = highlights.filter((h) => overlaps(h, start, end));
    const first = mine.filter((h) => overlaps(h, start, start)).sort((a, b) => b.id - a.id)[0];
    annotationUi.openHighlight({ moduleId, start, end, color: first?.color ?? null, hasHighlight: mine.length > 0 });
  }),
};

export const noteHandler: VerseActionHandler = {
  run: (ctx) => guarded(async () => {
    const target = targetOf(ctx);
    if (!target) return;
    const { moduleId, start, end } = target;
    const { notes } = await annotationStore.fetch(moduleId, start, end);
    const existing = notes.filter((n) => overlaps(n, start, end)).sort((a, b) => b.modified.localeCompare(a.modified))[0] ?? null;
    const range = existing ?? { start, end };
    annotationUi.openNote({ start: range.start, end: range.end, reference: formatVerseRange(range.start, range.end), note: existing });
  }),
};

export const bookmarkHandler: VerseActionHandler = {
  run: (ctx) => guarded(async () => {
    const target = targetOf(ctx);
    if (!target) return;
    const { moduleId, start, end } = target;
    const { bookmarks } = await annotationStore.fetch(moduleId, start, end);
    const exists = bookmarks.some((b) => b.start === start && b.end === end);
    const reference = formatVerseRange(start, end);
    // Idempotent set (not a toggle): a request retried after a leader handoff cannot undo itself.
    await annotationStore.setBookmark({ start, end, on: !exists, moduleId, title: reference });
    annotationUi.showToast(t(exists ? 'bookmarkRemoved' : 'bookmarkAdded', { reference }));
  }),
};
