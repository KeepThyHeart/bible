/**
 * Renderer-side store for extension UI surfaces (notifications, quick pick,
 * input box, confirm).
 *
 * This is the Zustand store the `RendererUiBridge` (main process) drives via
 * `ext-bridge:ui` IPC. The store keeps it intentionally tiny: a notification
 * stack with auto-dismiss, plus a single active modal (quick pick / input /
 * confirm). The visible React components live in `ExtensionUiHost.tsx`.
 */

import { create } from 'zustand';
import type { Extensions } from '@bible/core';

type LocalizedString = Extensions.LocalizedString;
type NotificationOpts = Extensions.NotificationOpts;
type QuickPickOpts = Extensions.QuickPickOpts;
type InputBoxOpts = Extensions.InputBoxOpts;
type ConfirmOpts = Extensions.ConfirmOpts;

export interface ExtensionNotification {
  id: number;
  extensionId: string;
  message: LocalizedString;
  level: 'info' | 'warning' | 'error';
  ttlMs: number;
}

export interface ExtensionQuickPickModal {
  kind: 'quickPick';
  extensionId: string;
  items: { id: number; label: LocalizedString; detail?: LocalizedString; description?: LocalizedString }[];
  opts: QuickPickOpts | null;
  resolve: (pickedId: number | null) => void;
}

export interface ExtensionInputBoxModal {
  kind: 'inputBox';
  extensionId: string;
  opts: InputBoxOpts;
  resolve: (value: string | null) => void;
}

export interface ExtensionConfirmModal {
  kind: 'confirm';
  extensionId: string;
  opts: ConfirmOpts;
  resolve: (value: boolean) => void;
}

export type ExtensionModal =
  | ExtensionQuickPickModal
  | ExtensionInputBoxModal
  | ExtensionConfirmModal;

type ContextMenuTarget = Extensions.ContextMenuTarget;
type ContextMenuItemDescriptor = Extensions.ContextMenuItemDescriptor;
type StatusBarItemDescriptor = Extensions.StatusBarItemDescriptor;
type ExtensionPanelTypeDef = Extensions.ExtensionPanelTypeDef;

/**
 * One extension-contributed context menu item, with the extension that owns it.
 *
 * `key` is `${extensionId}::${item.id}` - the same key the main-process
 * registry uses - so registration and disposal address the same row from both
 * sides.
 */
export interface ExtensionContextMenuItem {
  key: string;
  extensionId: string;
  target: ContextMenuTarget;
  item: ContextMenuItemDescriptor;
}

/** One extension-contributed status bar item. */
export interface ExtensionStatusBarItem {
  key: string;
  extensionId: string;
  item: StatusBarItemDescriptor;
}

/**
 * One extension-contributed panel type.
 *
 * `contentType` is the layout store's address for it - `ext:<extensionId>.<id>`
 * - precomputed here so every consumer (the new-tab page, the auto-registered
 * command, the pop-out mapping) spells it the same way.
 */
export interface ExtensionPanelType {
  key: string;
  extensionId: string;
  panelTypeId: string;
  contentType: `ext:${string}`;
  def: ExtensionPanelTypeDef;
}

interface ExtensionUiState {
  notifications: ExtensionNotification[];
  modal: ExtensionModal | null;
  /**
   * Contributed context menu items, in registration order. Sorting by `order`
   * happens where they are rendered, not here, so the store stays a plain
   * record of what was registered.
   */
  contextMenuItems: ExtensionContextMenuItem[];
  /** Contributed status bar items, in registration order. */
  statusBarItems: ExtensionStatusBarItem[];
  /**
   * Contributed panel types. Nothing in the app used to list these, so the
   * only way to reach an extension panel was for the extension itself to call
   * `workspace.openPanel` - which is fine for power users and invisible to
   * everyone else.
   */
  panelTypes: ExtensionPanelType[];
  pushNotification(extensionId: string, message: LocalizedString, opts: NotificationOpts | null): void;
  dismissNotification(id: number): void;
  setModal(modal: ExtensionModal | null): void;
  addContextMenuItem(
    extensionId: string,
    target: ContextMenuTarget,
    item: ContextMenuItemDescriptor,
  ): void;
  removeContextMenuItem(extensionId: string, itemId: string): void;
  addStatusBarItem(extensionId: string, item: StatusBarItemDescriptor): void;
  addPanelType(extensionId: string, def: ExtensionPanelTypeDef): void;
  removePanelType(extensionId: string, panelTypeId: string): void;
  removeStatusBarItem(extensionId: string, itemId: string): void;
  /** Drop every contribution owned by one extension. Used on deactivate. */
  removeContributionsByOwner(extensionId: string): void;
}

/**
 * A worker-originated message on its way to one of that extension's panels.
 *
 * `extensionId` is stamped by the main process from the worker that sent it,
 * so a panel host can trust it when deciding whether the message is for one of
 * its iframes.
 */
export interface PanelMessageEnvelope {
  extensionId: string;
  /** Present when the worker addressed one panel; absent means broadcast. */
  panelId?: string;
  message: unknown;
}

type PanelMessageListener = (msg: PanelMessageEnvelope) => void;

/**
 * Panel messages are events, not state: they are delivered once, to whichever
 * panel hosts are mounted, and nothing re-renders because one arrived. Holding
 * them in Zustand state would mean either a growing queue nobody drains or a
 * value that changes twice per message, so this is a plain listener set beside
 * the store rather than inside it.
 */
const panelMessageListeners = new Set<PanelMessageListener>();

/** Subscribe a panel host. Returns its unsubscribe. */
export function subscribeToPanelMessages(listener: PanelMessageListener): () => void {
  panelMessageListeners.add(listener);
  return () => {
    panelMessageListeners.delete(listener);
  };
}

/**
 * Fan a worker message out to the mounted panel hosts. Each host decides
 * whether the message is addressed to it; a message for an extension with no
 * open panel is simply dropped, which is the documented behaviour of
 * `api.panels.postMessage`.
 *
 * A throwing listener must not stop the others - one panel with a broken
 * handler should not silently starve its siblings.
 */
export function deliverPanelMessage(msg: PanelMessageEnvelope): void {
  for (const listener of [...panelMessageListeners]) {
    try {
      listener(msg);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[extensionUiStore] panel message listener threw', err);
    }
  }
}

let nextNotificationId = 1;

export const useExtensionUiStore = create<ExtensionUiState>((set) => ({
  notifications: [],
  modal: null,
  contextMenuItems: [],
  statusBarItems: [],
  panelTypes: [],

  pushNotification(extensionId, message, opts) {
    const id = nextNotificationId++;
    // duration: 0 means sticky (don't auto-dismiss); default 4000ms
    const requested = opts?.durationMs ?? 4000;
    const ttlMs = requested === 0 ? 0 : Math.max(500, Math.min(requested, 60_000));
    const severity = opts?.severity ?? 'info';
    set((s) => ({
      notifications: [
        ...s.notifications,
        { id, extensionId, message, level: severity, ttlMs },
      ],
    }));
    if (ttlMs > 0) {
      setTimeout(() => {
        set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
      }, ttlMs);
    }
  },

  dismissNotification(id) {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },

  setModal(modal) {
    set({ modal });
  },

  addContextMenuItem(extensionId, target, item) {
    const key = `${extensionId}::${item.id}`;
    set((s) => ({
      // Replace rather than append on re-registration. An extension that
      // re-registers the same id (a label changing with locale, say) should
      // update its item, not grow a duplicate the user then sees twice.
      contextMenuItems: [
        ...s.contextMenuItems.filter((c) => c.key !== key),
        { key, extensionId, target, item },
      ],
    }));
  },

  removeContextMenuItem(extensionId, itemId) {
    const key = `${extensionId}::${itemId}`;
    set((s) => ({ contextMenuItems: s.contextMenuItems.filter((c) => c.key !== key) }));
  },

  addStatusBarItem(extensionId, item) {
    const key = `${extensionId}::${item.id}`;
    set((s) => ({
      statusBarItems: [
        ...s.statusBarItems.filter((c) => c.key !== key),
        { key, extensionId, item },
      ],
    }));
  },

  removeStatusBarItem(extensionId, itemId) {
    const key = `${extensionId}::${itemId}`;
    set((s) => ({ statusBarItems: s.statusBarItems.filter((c) => c.key !== key) }));
  },

  addPanelType(extensionId, def) {
    const key = `${extensionId}::${def.id}`;
    set((s) => ({
      panelTypes: [
        ...s.panelTypes.filter((p) => p.key !== key),
        {
          key,
          extensionId,
          panelTypeId: def.id,
          contentType: `ext:${extensionId}.${def.id}` as `ext:${string}`,
          def,
        },
      ],
    }));
  },

  removePanelType(extensionId, panelTypeId) {
    const key = `${extensionId}::${panelTypeId}`;
    set((s) => ({ panelTypes: s.panelTypes.filter((p) => p.key !== key) }));
  },

  removeContributionsByOwner(extensionId) {
    set((s) => ({
      contextMenuItems: s.contextMenuItems.filter((c) => c.extensionId !== extensionId),
      statusBarItems: s.statusBarItems.filter((c) => c.extensionId !== extensionId),
      panelTypes: s.panelTypes.filter((p) => p.extensionId !== extensionId),
    }));
  },
}));
