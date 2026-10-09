/**
 * Desktop host slots (task 0125): places in the reader where an ACTIVE feature
 * module puts UI without the host importing it. A module registers in its
 * `activate()` and pushes the returned Disposable to `ctx.subscriptions`, so
 * deactivating (or switching the module off) removes it again.
 *
 * - `readerBars`: rendered by the Bible pane between its toolbar and the verses,
 *   given the chapter on screen.
 * - `verseMenuItems`: rendered by the verse context menu among its study entries, given
 *   the word the reader had selected (when exactly one) and the menu's `onClose`. The menu
 *   fires `onView:verseContextMenu` on mount, so an owning module activates and registers.
 * - `shellOverlays`: rendered once by `App`, above everything (a module's dialog).
 * - `readerPaintControllers` (task 0127): invisible components the Bible pane renders with the
 *   chapter on screen, so a module can paint it (publish `chapterLayers`) and attach listeners to
 *   the text container.
 * - `readerToolbarItems`: buttons at the end of the Bible toolbar's left group.
 * - `studyPaneSections`: sections inside the Study pane, after Topics.
 * - `wordMenuItems`: items in the verse context menu for the right-clicked word.
 * - `strongsTooltipActions`: buttons at the foot of the Strong's preview tooltip.
 *
 * A host view that renders one of these outlets fires `onView:bible`, so a module that lists it in
 * its activation events loads when the reader first appears.
 *
 * - `preferencesSectionGlyphs`: sidebar glyph of a contributed preferences section, registered by the
 *   module host while the module is on.
 *
 * Entry-chunk code: imports React only (the module host injects the activation helper).
 */
import React, { useEffect, useSyncExternalStore } from 'react';

const componentIds = new WeakMap<object, number>();
let nextComponentId = 0;
/** A stable React key for a slot component, so removing another item does not remount it. */
export function componentKey(C: object): number {
  let id = componentIds.get(C);
  if (id === undefined) componentIds.set(C, (id = ++nextComponentId));
  return id;
}
import type { ComponentType, RefObject } from 'react';
import type { PaneVerse } from '../../extensions/chapterLayers';

export interface Slot<T> {
  /** Add an item; dispose the handle to remove it. */
  register(item: T): { dispose(): void };
  list(): readonly T[];
  getSnapshot(): number;
  subscribe(listener: () => void): () => void;
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

/** What the Bible pane tells a reader bar. */
export interface ReaderBarProps {
  currentBook: number;
  currentChapter: number;
}

export const readerBars = createSlot<ComponentType<ReaderBarProps>>();

/** Renders every bar registered in `readerBars`. */
export function ReaderBars(props: ReaderBarProps): React.ReactElement | null {
  const items = useSlot(readerBars);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((C) => (
        <C key={componentKey(C)} {...props} />
      ))}
    </>
  );
}

let viewActivator: (event: string) => void = () => {};

/** The module host gives the outlets its activation function (keeps this file free of host imports). */
export function setViewActivator(fn: (event: string) => void): void {
  viewActivator = fn;
}

/** Fire `onView:<name>` once when a host view with module slots mounts. */
function useActivateOnView(name: string): void {
  useEffect(() => {
    viewActivator(`onView:${name}`);
  }, [name]);
}

export interface PreferencesSectionGlyph {
  /** The preferences section id. */
  id: string;
  glyph: React.ReactNode;
}

export const preferencesSectionGlyphs = createSlot<PreferencesSectionGlyph>();

/** What the Bible pane tells a paint controller: the chapter on screen in one tab. */
export interface ReaderPaintProps {
  tabId: string | undefined;
  moduleId: number;
  abbreviation: string | undefined;
  language: string | undefined;
  bookNumber: number;
  chapter: number;
  verses: readonly PaneVerse[];
  surface: 'standard' | 'reading' | 'study';
  uiLocale: string;
  /** False in views that render no decorations (Parallel). */
  active: boolean;
  /** The element holding the rendered verses. */
  containerRef: RefObject<HTMLElement | null>;
}

export const readerPaintControllers = createSlot<ComponentType<ReaderPaintProps>>();

/** Renders every controller registered in `readerPaintControllers` (they draw nothing of their own, or a popup). */
export function ReaderPaintControllers(props: ReaderPaintProps): React.ReactElement | null {
  useActivateOnView('bible');
  const items = useSlot(readerPaintControllers);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((C) => (
        <C key={componentKey(C)} {...props} />
      ))}
    </>
  );
}

export interface ReaderToolbarItemProps {
  /** The Bible tab the toolbar belongs to. */
  tabId: string;
}

export const readerToolbarItems = createSlot<ComponentType<ReaderToolbarItemProps>>();

export function ReaderToolbarItems(props: ReaderToolbarItemProps): React.ReactElement | null {
  useActivateOnView('bible');
  const items = useSlot(readerToolbarItems);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((C) => (
        <C key={componentKey(C)} {...props} />
      ))}
    </>
  );
}

export interface StudyPaneSectionProps {
  /** The verse the Study pane is on. */
  verseId: number | null;
  sectionsCollapsed: Readonly<Record<string, boolean>>;
  toggleSection: (key: string) => void;
}

export const studyPaneSections = createSlot<ComponentType<StudyPaneSectionProps>>();

export function StudyPaneSections(props: StudyPaneSectionProps): React.ReactElement | null {
  useActivateOnView('bible');
  const items = useSlot(studyPaneSections);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((C) => (
        <C key={componentKey(C)} {...props} />
      ))}
    </>
  );
}

export interface WordMenuItemProps {
  /** The Bible tab the menu belongs to. */
  tabId: string;
  wordText: string;
  /** Strong's number of the word, when interlinear rows have one. */
  wordStrongs?: string;
  onClose: () => void;
}

export const wordMenuItems = createSlot<ComponentType<WordMenuItemProps>>();

export function WordMenuItems(props: WordMenuItemProps): React.ReactElement | null {
  const items = useSlot(wordMenuItems);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((C) => (
        <C key={componentKey(C)} {...props} />
      ))}
    </>
  );
}

export interface StrongsTooltipActionProps {
  /** The Bible tab the tooltip's verse belongs to. */
  tabId: string;
  strongsNumber: string;
  onClose: () => void;
}

export const strongsTooltipActions = createSlot<ComponentType<StrongsTooltipActionProps>>();

export function StrongsTooltipActions(props: StrongsTooltipActionProps): React.ReactElement | null {
  const items = useSlot(strongsTooltipActions);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((C) => (
        <C key={componentKey(C)} {...props} />
      ))}
    </>
  );
}

/** What the verse context menu tells a menu item. */
export interface VerseMenuItemProps {
  /** The one word the reader had selected when the menu opened, or null. */
  selectedWord: string | null;
  onClose: () => void;
}

export const verseMenuItems = createSlot<ComponentType<VerseMenuItemProps>>();

/** Renders every item registered in `verseMenuItems`. */
export function VerseMenuItems(props: VerseMenuItemProps): React.ReactElement | null {
  const items = useSlot(verseMenuItems);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((C) => (
        <C key={componentKey(C)} {...props} />
      ))}
    </>
  );
}

/** Overlays an active module shows above the whole app (dialogs); each renders itself only while open. */
export const shellOverlays = createSlot<ComponentType>();

/** Renders every overlay registered in `shellOverlays`. */
export function ShellOverlays(): React.ReactElement | null {
  const items = useSlot(shellOverlays);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((C) => (
        <C key={componentKey(C)} />
      ))}
    </>
  );
}
