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
 *
 * Entry-chunk code: imports nothing but React.
 */
import React, { useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';

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
      {items.map((C, i) => (
        <C key={i} {...props} />
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
      {items.map((C, i) => (
        <C key={i} {...props} />
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
      {items.map((C, i) => (
        <C key={i} />
      ))}
    </>
  );
}
