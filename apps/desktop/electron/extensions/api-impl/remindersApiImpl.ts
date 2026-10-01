/**
 * Host-side implementation of `IRemindersApi` for one extension worker.
 *
 * Every method needs `notifications:schedule`. The api-impl is a thin gate
 * between the RPC wire and `IRemindersBridge` (the main-process scheduler):
 *
 *   - `replaceAll(items)` checks only that `items` is an array and hands it
 *     over with the extension's display name as the label. Item-level
 *     validation, sorting and the 64-item cap live in the scheduler's
 *     `sanitizeReminderItems`, which is the single source of truth.
 *   - `takeActivations()` drains the per-extension queue the host fills in
 *     `deliverReminderActivation` (clicks that arrived before the extension
 *     had an `onActivated` handler). The queue lives on the host, not here,
 *     so it survives this impl being rebuilt on a re-activation.
 *   - `onActivated` / `onMissed` are worker-side sugar over the
 *     `reminder.activated` / `reminder.missed` channels (see `apiProxy.ts`),
 *     so there is nothing to register for them.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IRemindersBridge } from './IExtensionDataBridges';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

/** The scheduler caps what it keeps at 64; anything over this is a bug or abuse. */
const MAX_REPLACE_ITEMS = 1000;

const PERM = Extensions.PERM_NOTIFICATIONS_SCHEDULE;

export interface RemindersApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IRemindersBridge;
  grant: ExtensionPermissionGrant;
  /** Plain-text name shown as the notification group label. */
  label: string;
  /** Drain and return this extension's queued activations. */
  takeActivations: () => Extensions.ReminderActivationEvent[];
}

export class RemindersApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IRemindersBridge;
  private readonly grant: ExtensionPermissionGrant;
  private readonly label: string;
  private readonly drain: () => Extensions.ReminderActivationEvent[];
  private disposed = false;

  constructor(opts: RemindersApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
    this.label = opts.label;
    this.drain = opts.takeActivations;
  }

  attach(): void {
    this.router.registerNamespace('reminders', {
      replaceAll: (args) => this.handleReplaceAll(args),
      list: () => this.handleList(),
      capabilities: () => this.handleCapabilities(),
      requestPermission: () => this.handleRequestPermission(),
      takeActivations: () => this.handleTakeActivations(),
    });
  }

  dispose(): void {
    this.disposed = true;
  }

  private guard(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`remindersApiImpl for ${this.extensionId} is disposed`);
    }
    requirePermission(this.grant, PERM);
  }

  private async handleReplaceAll(args: unknown[]): Promise<{ accepted: number }> {
    this.guard();
    const items = args[0];
    if (!Array.isArray(items)) {
      throw new RpcProtocolError('reminders.replaceAll: items must be an array');
    }
    // Refuse absurd payloads before the scheduler spends time sanitizing them.
    if (items.length > MAX_REPLACE_ITEMS) {
      throw new RpcProtocolError(`reminders.replaceAll: at most ${MAX_REPLACE_ITEMS} items per call`);
    }
    return this.bridge.replaceAll(this.extensionId, this.label, items);
  }

  private async handleList(): Promise<Extensions.ReminderItem[]> {
    this.guard();
    return this.bridge.list(this.extensionId);
  }

  private async handleCapabilities(): Promise<Extensions.ReminderCapabilities> {
    this.guard();
    return this.bridge.capabilities();
  }

  private async handleRequestPermission(): Promise<Extensions.ReminderPermission> {
    this.guard();
    return this.bridge.requestPermission();
  }

  private async handleTakeActivations(): Promise<Extensions.ReminderActivationEvent[]> {
    this.guard();
    return this.drain();
  }
}
