/**
 * Host slots (task 0123): places in the shell and the reader where an ACTIVE
 * feature module puts UI without the host importing it. A module registers in
 * its `activate()` and pushes the returned Disposable to `ctx.subscriptions`,
 * so deactivating (or switching the module off) removes it again.
 *
 * - `shellOverlays`: rendered once by `AppShell`, whichever app is shown.
 * - `studyBanners`: rendered above the reader layout by `StudyView`.
 * - `studyPaneSections`: sections in the phone Study pane (`MobileStudyPane`).
 * - `readerOverlays`: rendered inside the reader (`BibleContent`), after the verses.
 * - `readerToolbarItems`: components at the start of the Bible toolbar's right group.
 * - `readerPaintControllers`: components the reader mounts with the chapter in view; they
 *   publish paint layers (`host/readerLayers.ts`) and may render extras (a popup).
 * - `studySections`: sections in the Study pane's verse area (desktop layout).
 * - `readerToolbarActions`, `readerTabBadges`, `readerTransport`, `readerPaneEffects`: reader chrome (toolbar, tab bar,
 *   strip under the toolbar, effect-only components); `studyLayoutItems`: per-layout items of the Study app;
 *   `phoneBackHandlers`, `helpShortcutRows`: the phone Back button and the Help dialog's shortcuts (task 0128).
 * - `verseDecorators`: per-verse extras for `VerseRenderer` (classes, a rail
 *   control, replacement text). Decorators are plain functions read during
 *   render; a module calls `verseDecorators.invalidate()` when what they return changes.
 *
 * Entry-chunk code: imports nothing but Preact.
 */
import { h } from 'preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { useSyncExternalStore } from 'preact/compat';
import type { IInterlinearDataProvider } from '../providers/interfaces';
import type { InterlinearWordData, VerseData } from '../types';

const componentIds = new WeakMap<object, number>();
let nextComponentId = 0;
/** A stable React key for a slot component, so removing another item does not remount it. */
export function componentKey(C: object): number {
  let id = componentIds.get(C);
  if (id === undefined) componentIds.set(C, (id = ++nextComponentId));
  return id;
}
import type { BibleTab } from '../stores/bibleStore';

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
  return <>{items.map((C) => h(C, { key: componentKey(C) }))}</>;
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
/** Extra sections in the phone Study pane, after the built-in ones (the pane fires `onView:studyPane.sections` on mount). */
export const studyPaneSections = createSlot<ComponentType>();

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
  readonly Section?: ComponentType<StudySectionProps>;
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

// --- Reader paint and verse-scoped Study sections (task 0127) ---------------------

/** What the Study pane gives a section about the verse in focus. */
export interface StudySectionProps {
  /** The focus verse, or null. */
  verseId: number | null;
  /** Opens the Settings panel on a section. */
  onOpenSettings?: (section?: string) => void;
}

/** A section of the Study pane (desktop layout) that follows the focus verse, between Topics and Synthesis. */
export interface StudySectionItem {
  readonly id: string;
  /** Lower first. */
  readonly order: number;
  readonly Section: ComponentType<StudySectionProps>;
}
export const studySections = createSlot<StudySectionItem>();

/** What the reader tells a paint controller about the chapter in view. */
export interface ReaderPaintProps {
  readonly tabId: string;
  readonly moduleAbbr: string;
  readonly moduleId: number | undefined;
  /** Language of the Bible module text. */
  readonly language: string | undefined;
  readonly book: number | null;
  readonly chapter: number | null;
  readonly verses: readonly VerseData[];
  readonly surface: 'standard' | 'reading' | 'study';
  /** Interlinear rows Study already holds for this chapter. */
  readonly studyRows?: readonly InterlinearWordData[];
  /** Server interlinear source for surfaces other than Study. */
  readonly interlinearProvider?: IInterlinearDataProvider;
  readonly uiLocale: string;
  /** The element that wraps the rendered verses (null while the verses are not shown). */
  readonly container: HTMLElement | null;
  readonly onOpenSettings?: (section?: string) => void;
}

/** Mounted by `BibleContent` while the module is active; publishes layers via `publishReaderLayer`. */
export const readerPaintControllers = createSlot<ComponentType<ReaderPaintProps>>();

/** Components at the start of the Bible toolbar's right group. */
export const readerToolbarItems = createSlot<ComponentType>();
// --- Reader chrome, layout items, back handlers (task 0128) -----------------------

/** What the reader toolbar gives an action registered in `readerToolbarActions` (rendered at the right, before the text-size button). */
export interface ReaderToolbarActionProps {
  readonly tab: BibleTab;
}
export const readerToolbarActions = createSlot<ComponentType<ReaderToolbarActionProps>>();

/** What the tab bar gives a badge registered in `readerTabBadges` (rendered before a tab's title). */
export interface ReaderTabBadgeProps {
  readonly tabId: string;
}
export const readerTabBadges = createSlot<ComponentType<ReaderTabBadgeProps>>();

/** What the Bible pane gives a strip registered in `readerTransport` (rendered under the toolbar). */
export interface ReaderTransportProps {
  readonly onOpenSettings?: (section?: string) => void;
}
export const readerTransport = createSlot<ComponentType<ReaderTransportProps>>();

/** What the Bible pane gives an effect-only component in `readerPaneEffects` (mounted once per pane; it renders nothing). */
export interface ReaderPaneEffectProps {
  readonly activeTabId: string;
  /** The element that actually scrolls (on phones, the outer wrapper, not the pane). */
  readonly getScrollElement: () => HTMLElement | null;
  /** The element holding the verses (`[data-verse-id]`). */
  readonly getContainer: () => HTMLElement | null;
}
export const readerPaneEffects = createSlot<ComponentType<ReaderPaneEffectProps>>();

/** Which layout of the Study app an item belongs to, and where it sits in it. */
export interface StudyLayoutItem {
  readonly layout: 'desktop' | 'phone' | 'both';
  /** `dock`: in the phone column above the bottom bar; `overlay`: over the layout, before the shared dialogs (phone) or after them (desktop); `dialogs`: right after the shared dialogs. */
  readonly placement: 'dock' | 'overlay' | 'dialogs';
  readonly Component: ComponentType<StudyLayoutProps>;
}
export interface StudyLayoutProps {
  readonly onOpenSettings: (section?: string) => void;
}
export const studyLayoutItems = createSlot<StudyLayoutItem>();

/** Renders the Study layout items for one layout and placement (`DesktopApp` / `MobileApp`). */
export function StudyLayoutOutlet({ layout, placement, onOpenSettings }: { layout: 'desktop' | 'phone'; placement: StudyLayoutItem['placement']; onOpenSettings: (section?: string) => void }) {
  const items = useSlot(studyLayoutItems);
  const mine = items.filter((i) => i.placement === placement && (i.layout === 'both' || i.layout === layout));
  if (mine.length === 0) return null;
  return <>{mine.map((i) => h(i.Component, { key: componentKey(i.Component), onOpenSettings }))}</>;
}

/** Renders every component of a slot of components that take props. */
export function PropsSlotOutlet<P extends object>({ slot, props }: { slot: Slot<ComponentType<P>>; props: P }) {
  const items = useSlot(slot);
  if (items.length === 0) return null;
  return <>{items.map((C) => h(C as ComponentType<Record<string, unknown>>, { ...(props as Record<string, unknown>), key: componentKey(C as object) }))}</>;
}

/**
 * The phone's Back button: each handler returns true when it consumed the press (closed something of its own).
 * Asked first, before the host's own steps, while any module registered one.
 */
export const phoneBackHandlers = createSlot<() => boolean>();

/** Rows (`<tr>` elements) added to the Help dialog's keyboard shortcuts table. */
export const helpShortcutRows = createSlot<ComponentType>();
