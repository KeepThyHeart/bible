/**
 * Host slots (task 0123): places in the shell and the reader where an ACTIVE
 * feature module puts UI without the host importing it. A module registers in
 * its `activate()` and pushes the returned Disposable to `ctx.subscriptions`,
 * so deactivating (or switching the module off) removes it again.
 *
 * - `shellOverlays`: rendered once by `AppShell`, whichever app is shown.
 * - `studyBanners`: rendered above the reader layout by `StudyView`.
 * - `readerOverlays`: rendered inside the reader (`BibleContent`), after the verses.
 * - `verseDecorators`: per-verse extras for `VerseRenderer` (classes, a rail
 *   control, replacement text). Decorators are plain functions read during
 *   render; a module calls `verseDecorators.invalidate()` when what they return changes.
 *
 * Entry-chunk code: imports nothing but Preact.
 */
import { h } from 'preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { useSyncExternalStore } from 'preact/compat';

export interface Slot<T> {
  /** Add an item; dispose the handle to remove it. */
  register(item: T): { dispose(): void };
  list(): readonly T[];
  /** A number that changes whenever the items change or `invalidate()` is called. */
  getSnapshot(): number;
  subscribe(listener: () => void): () => void;
  /** Ask readers to re-render (an item's output changed, the item list did not). */
  invalidate(): void;
}

export function createSlot<T>(): Slot<T> {
  let items: readonly T[] = [];
  let version = 0;
  const listeners = new Set<() => void>();
  const bump = () => {
    version++;
    for (const fn of [...listeners]) fn();
  };
  return {
    register(item) {
      items = [...items, item];
      bump();
      let done = false;
      return {
        dispose() {
          if (done) return;
          done = true;
          items = items.filter((i) => i !== item);
          bump();
        },
      };
    },
    list: () => items,
    getSnapshot: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invalidate: bump,
  };
}

/** Re-render when a slot changes; returns its items. */
export function useSlot<T>(slot: Slot<T>): readonly T[] {
  useSyncExternalStore(slot.subscribe, slot.getSnapshot);
  return slot.list();
}

/** Renders every component registered in a slot of components. */
export function SlotOutlet({ slot }: { slot: Slot<ComponentType> }) {
  const items = useSlot(slot);
  if (items.length === 0) return null;
  return <>{items.map((C, i) => h(C, { key: i }))}</>;
}

// --- reader verses ------------------------------------------------------------

/** What the reader tells a decorator about one verse. */
export interface ReaderVerseContext {
  readonly tabId: string;
  /** The Bible module abbreviation the tab shows (`KJV`). */
  readonly moduleAbbr: string;
  readonly book: number;
  readonly chapter: number;
  readonly verseId: number;
  /** Verse number within the chapter. */
  readonly verse: number;
  /** The verse's raw `text_html`. */
  readonly html: string;
  /** The reader's focus (study) verse. */
  readonly isActive: boolean;
}

/** What a decorator adds to one verse. Absent fields change nothing. */
export interface VerseDecoration {
  /** Extra classes on the verse element. */
  readonly classes?: readonly string[];
  /** A control in the verse's left rail (block layouts). */
  readonly rail?: ComponentChildren;
  /** Replaces the verse's text body. */
  readonly text?: ComponentChildren;
}

export type VerseDecorator = (ctx: ReaderVerseContext) => VerseDecoration | null | undefined;

export const shellOverlays = createSlot<ComponentType>();
export const studyBanners = createSlot<ComponentType>();
export const readerOverlays = createSlot<ComponentType>();
export const verseDecorators = createSlot<VerseDecorator>();

/**
 * Merge every decorator's output for one verse: classes add up, the first
 * decorator that supplies a rail or a text wins it. Undefined when nothing
 * applies (the common case: no module decorates).
 */
export function decorateVerse(
  decorators: readonly VerseDecorator[],
  ctx: ReaderVerseContext,
): VerseDecoration | undefined {
  if (decorators.length === 0) return undefined;
  let classes: string[] | undefined;
  let rail: ComponentChildren | undefined;
  let text: ComponentChildren | undefined;
  for (const d of decorators) {
    let out: VerseDecoration | null | undefined;
    try {
      out = d(ctx);
    } catch (err) {
      console.warn('[slots] verse decorator failed', err);
      continue;
    }
    if (!out) continue;
    if (out.classes?.length) (classes ??= []).push(...out.classes);
    if (rail === undefined && out.rail !== undefined) rail = out.rail;
    if (text === undefined && out.text !== undefined) text = out.text;
  }
  if (!classes && rail === undefined && text === undefined) return undefined;
  return { classes, rail, text };
}

// --- Study pane (task 0124) ----------------------------------------------------

/** What the host gives a Study mode's view. */
export interface StudyModeViewProps {
  /** Read a verse in the reader (the Study pane's "open verse"). */
  onOpenVerse: (verseId: number) => void;
  /** What the open request carried (for example a person to centre on), with a token that changes on every request. */
  focus: { token: number } | null;
  /** Phone layout. */
  compact?: boolean;
}

/** An extra mode of the Study pane, next to its ordinary sections (shown as a tab). */
export interface StudyMode {
  readonly id: string;
  /** Lower first. */
  readonly order: number;
  /** i18n key of the tab. */
  readonly labelKey: string;
  /** i18n key of the tab strip's accessible name. */
  readonly stripLabelKey: string;
  /** Lazy view: `import()` of a module whose default export is the component. */
  readonly load: () => Promise<{ default: ComponentType<StudyModeViewProps> }>;
}
export const studyModes = createSlot<StudyMode>();

/**
 * A section on the phone Study page: `Section` is its card in the list (ordered by
 * `order`), `Sheet` an optional full-screen sheet rendered after the page. `onNavigateBible`
 * leaves the Study page for the reader (a sheet that opens a verse calls it).
 */
export interface MobileStudySection {
  readonly id: string;
  readonly order: number;
  readonly Section?: ComponentType;
  readonly Sheet?: ComponentType<{ onNavigateBible?: () => void }>;
}
export const mobileStudySections = createSlot<MobileStudySection>();

/** An action on a Topics entity (for example a person); `id` also names its button class (`topics-browser__<id>`). */
export interface TopicEntityAction {
  readonly id: string;
  /** Entity category it applies to (`people`). */
  readonly category: string;
  readonly iconClass: string;
  /** i18n key of the label. */
  readonly labelKey: string;
  /** `mobile`: the Topics browser is the phone overlay. */
  readonly run: (entityId: string, name: string, ctx: { mobile: boolean }) => void;
}
export const topicEntityActions = createSlot<TopicEntityAction>();
