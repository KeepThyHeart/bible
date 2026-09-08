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

interface ExtensionUiState {
  notifications: ExtensionNotification[];
  modal: ExtensionModal | null;
  pushNotification(extensionId: string, message: LocalizedString, opts: NotificationOpts | null): void;
  dismissNotification(id: number): void;
  setModal(modal: ExtensionModal | null): void;
}

let nextNotificationId = 1;

export const useExtensionUiStore = create<ExtensionUiState>((set) => ({
  notifications: [],
  modal: null,

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
}));
