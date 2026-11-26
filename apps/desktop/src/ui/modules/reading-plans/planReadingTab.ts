/**
 * The reusable plan reading tab (task 0222 R3-7). With the `readingPlanOpenIn` pref on 'tab', opening a plan
 * reading navigates one dedicated Bible tab (panel id `bible_plan-reading`) instead of the tab the user is
 * reading in, creating it next to the last active Bible tab when it is gone (closed, or a layout preset
 * replaced the layout).
 *
 * Its title is "{reading} · plan", a layout title override that applies only while the tab shows a chapter
 * inside that reading's range (so a tab the user has walked elsewhere reads like any Bible tab again). The
 * scope lives in memory; after a restart or a layout restore it is re-derived from today's readings.
 */
import { ReadingPlans } from '@bible/core/browser';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { useBibleStore, encodeBibleContentKey } from '../../stores/useBibleStore';
import { openApp } from '../../apps/appHost';
import { useReadingPlanStore } from './useReadingPlanStore';
import { formatReadingText, rpText } from './rpText';

export const PLAN_READING_PANEL_ID = 'bible_plan-reading';

/** What the tab title applies to: a book and an inclusive chapter range (`chapterTo` 999: to the book's end). */
export interface ReadingTabScope {
  title: string;
  book: number;
  chapterFrom: number;
  chapterTo: number;
}

let scope: ReadingTabScope | null = null;

/** "Genesis 4-6 · plan". */
export function readingTabTitle(reading: ReadingPlans.Reading): string {
  return rpText('readingPlans.tab.title', '{reading} · plan', { reading: formatReadingText(reading) });
}

export function scopeOf(reading: ReadingPlans.Reading, title: string): ReadingTabScope {
  const span = ReadingPlans.chapterSpan(reading);
  return {
    title,
    book: span.first.book,
    chapterFrom: span.first.chapter,
    chapterTo: span.last.book === span.first.book ? span.last.chapter : 999,
  };
}

/** True when the chapter lies inside the scope. */
export function inScope(s: ReadingTabScope, book: number, chapter: number): boolean {
  return book === s.book && chapter >= s.chapterFrom && chapter <= s.chapterTo;
}

/** The dockview panel exists: both the layout store and dockview know it. */
export function readingTabExists(): boolean {
  const layout = useLayoutStore.getState(); // allow-getstate: imperative layout check
  return layout.panels.has(PLAN_READING_PANEL_ID) && !!layout.dockviewApi?.getPanel(PLAN_READING_PANEL_ID);
}

/** A reading tab can be made or reused (dockview is ready). */
export function canUseReadingTab(): boolean {
  return !!useLayoutStore.getState().dockviewApi; // allow-getstate: imperative layout check
}

function panelChapter(): { book: number; chapter: number } | null {
  const ps = useBibleStore.getState().getPanelState(PLAN_READING_PANEL_ID); // allow-getstate: imperative read
  return ps && ps.currentBook > 0 && ps.currentChapter > 0 ? { book: ps.currentBook, chapter: ps.currentChapter } : null;
}

/** Re-derive the scope from today's readings when this tab shows one of them (after a restart or a layout restore). */
function deriveScope(): ReadingTabScope | null {
  const at = panelChapter();
  if (!at) return null;
  const todays = useReadingPlanStore.getState().todays; // allow-getstate: imperative read
  for (const view of todays) {
    for (const r of ReadingPlans.todaysReadings(view)) {
      if (ReadingPlans.chapterOf(r.reading, at.book, at.chapter)) return scopeOf(r.reading, readingTabTitle(r.reading));
    }
  }
  return null;
}

/** Make the layout's title override match the tab: the scope's title while in range, else none. */
export function applyReadingTabTitle(): void {
  const layout = useLayoutStore.getState(); // allow-getstate: imperative layout write
  if (!readingTabExists()) { layout.setTitleOverride(PLAN_READING_PANEL_ID, null); return; }
  scope ??= deriveScope();
  const at = panelChapter();
  layout.setTitleOverride(PLAN_READING_PANEL_ID, scope && at && inScope(scope, at.book, at.chapter) ? scope.title : null);
}

/** Forget the scope and the title override (the active reading was cleared). */
export function clearReadingTabScope(): void {
  scope = null;
  useLayoutStore.getState().setTitleOverride(PLAN_READING_PANEL_ID, null); // allow-getstate: imperative layout write
}

/**
 * Show a reading in the reading tab, creating the tab when needed. Resolves false when nothing could be opened
 * (no dockview, no Bible installed, panel creation failed): the caller falls back to the current tab.
 */
export async function openInReadingTab(target: { reading: ReadingPlans.Reading }, title: string): Promise<boolean> {
  if (!canUseReadingTab()) return false;
  await openApp('study');
  const layout = useLayoutStore.getState(); // allow-getstate: event handler
  const api = layout.dockviewApi;
  if (!api) return false;
  const start = target.reading.start;
  scope = scopeOf(target.reading, title);
  const existing = readingTabExists() ? api.getPanel(PLAN_READING_PANEL_ID) : undefined;
  if (existing) {
    await useBibleStore.getState().navigateToVerse(PLAN_READING_PANEL_ID, start); // allow-getstate: event handler
    existing.api.setActive();
  } else {
    // A stale layout-store entry (the dockview panel is gone) must not stop addPanel from registering afresh.
    if (layout.panels.has(PLAN_READING_PANEL_ID)) layout.unregisterPanel(PLAN_READING_PANEL_ID);
    const bible = useBibleStore.getState(); // allow-getstate: event handler
    const lastId = layout.lastActiveBiblePanelId;
    const lastActive = lastId && api.getPanel(lastId) ? lastId : null;
    const abbreviation = (lastActive ? bible.getPanelState(lastActive)?.openTabs?.[0]?.abbreviation : undefined)
      ?? bible.getDefaultBible() ?? (await bible.resolveDefaultBible());
    if (!abbreviation) return false;
    const { book, chapter } = ReadingPlans.splitVid(start);
    const group = lastActive ? api.getPanel(lastActive)?.group : undefined;
    const id = layout.addPanel(
      'bible',
      encodeBibleContentKey({ abbreviation, book, chapter, selectedVerseId: start }),
      title,
      group ? { referenceGroup: group, direction: 'within' } : undefined,
      abbreviation,
      PLAN_READING_PANEL_ID,
    );
    if (!id) { scope = null; return false; }
  }
  // The title first (a new panel's passage state is seeded later); the subscriptions re-check it against the chapter.
  useLayoutStore.getState().setTitleOverride(PLAN_READING_PANEL_ID, title); // allow-getstate: event handler
  return true;
}

/**
 * Keep the tab title right as the user navigates the tab, as the layout is restored and as today's readings
 * load. Returns a disposer.
 */
export function activatePlanReadingTab(): { dispose(): void } {
  const stops = [
    useLayoutStore.subscribe(applyReadingTabTitle),
    useBibleStore.subscribe(applyReadingTabTitle),
    useReadingPlanStore.subscribe(applyReadingTabTitle),
  ];
  applyReadingTabTitle();
  return { dispose: () => { for (const s of stops) s(); } };
}

/** Tests only. */
export function resetPlanReadingTabForTests(): void {
  scope = null;
}
