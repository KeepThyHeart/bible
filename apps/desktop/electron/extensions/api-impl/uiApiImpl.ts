/**
 * Host-side implementation of `IUiApi` for one extension worker.
 *
 * Covers both the T1 and T2 UI surfaces.
 *
 * T1 surface:
 *   - `registerPanelType` - contributes a new panel type, mounted in the
 *     renderer as an iframe loading from `ext-ui://<extId>/<uiEntry>`.
 *   - `showNotification` / `showQuickPick` / `showInputBox` / `showConfirm`
 * - host-driven dialogs.
 *
 * T2 surface:
 *   - `registerVerseDecorator` / `updateVerseDecorations` - verse decorations
 *   - `registerVerseHover` - hover content providers
 *   - `registerContextMenu` - context menu item contributions
 *   - `registerStatusBarItem` - status bar contributions
 *   - `pickFile` / `saveFile` - file picker round-trips
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionUiBridge } from './IExtensionDataBridges';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

type ExtensionPanelTypeDef = Extensions.ExtensionPanelTypeDef;

// Valid context menu targets - kept in sync with ExtensionApiDtos.ts.
const VALID_CONTEXT_MENU_TARGETS = new Set([
  'verse', 'verse.word', 'commentary.entry', 'dictionary.entry',
  'book.section', 'note', 'highlight', 'reference', 'search.result',
  'panel.tab',
]);

export interface UiApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionUiBridge;
  grant: ExtensionPermissionGrant;
}

export class UiApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionUiBridge;
  private readonly grant: ExtensionPermissionGrant;
  private readonly disposers = new Map<string, () => void>();
  /**
   * Status bar bookkeeping, keyed by the extension-facing item `id` (not the
   * `${extensionId}::${id}` bridge key - this instance is already scoped to
   * one extension). Lets `updateStatusBarItem` patch-and-reregister without
   * requiring the caller to resend the whole descriptor, and lets
   * re-registering the same id replace its disposer instead of stacking a
   * new one on top - see `registerOrReplaceStatusBarItem`.
   */
  private readonly statusBarDescriptors = new Map<string, Extensions.StatusBarItemDescriptor>();
  private readonly statusBarDisposalIdByItemId = new Map<string, string>();
  private nextDisposalId = 1;
  private disposed = false;

  constructor(opts: UiApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
  }

  attach(): void {
    this.router.registerNamespace('ui', {
      // T1
      registerPanelType: (args) => this.handleRegisterPanelType(args),
      showNotification: (args) => this.handleShowNotification(args),
      showQuickPick: (args) => this.handleShowQuickPick(args),
      showInputBox: (args) => this.handleShowInputBox(args),
      showConfirm: (args) => this.handleShowConfirm(args),
      dispose: (args) => this.handleDispose(args),
      // T2
      registerVerseDecorator: (args) => this.handleRegisterVerseDecorator(args),
      updateVerseDecorations: (args) => this.handleUpdateVerseDecorations(args),
      registerVerseHover: (args) => this.handleRegisterVerseHover(args),
      registerContextMenu: (args) => this.handleRegisterContextMenu(args),
      registerStatusBarItem: (args) => this.handleRegisterStatusBarItem(args),
      updateStatusBarItem: (args) => this.handleUpdateStatusBarItem(args),
      pickFile: (args) => this.handlePickFile(args),
      saveFile: (args) => this.handleSaveFile(args),
      openSettings: (args) => this.handleOpenSettings(args),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Bulk-drop every panel-type registration this worker owns. Defense in
    // depth - we also call disposers individually below in case the bridge
    // tracks more than panel types.
    this.bridge.disposePanelTypesByOwner(this.extensionId);
    this.bridge.disposeUiContributionsByOwner(this.extensionId);
    for (const d of this.disposers.values()) {
      try {
        d();
      } catch {
        /* best-effort */
      }
    }
    this.disposers.clear();
    this.statusBarDescriptors.clear();
    this.statusBarDisposalIdByItemId.clear();
  }

  // --- T1 RPC handlers ---------------------------------------------------

  private async handleRegisterPanelType(args: unknown[]): Promise<{ disposalId: string }> {
    this.assertActive();
    requirePermission(this.grant, 'ui:contribute-pane');
    const def = args[0];
    if (!isExtensionPanelTypeDef(def)) {
      throw new RpcProtocolError(
        'ui.registerPanelType: expected ExtensionPanelTypeDef as first arg',
      );
    }
    const disposer = this.bridge.registerPanelType(this.extensionId, def);
    const disposalId = `panel-${this.nextDisposalId++}`;
    this.disposers.set(disposalId, disposer);
    return { disposalId };
  }

  private async handleShowNotification(args: unknown[]): Promise<string | undefined> {
    this.assertActive();
    requirePermission(this.grant, 'ui:notification');
    const message = args[0];
    if (!isLocalizedString(message)) {
      throw new RpcProtocolError('ui.showNotification: message must be a LocalizedString');
    }
    const opts = args[1];
    if (opts !== undefined && opts !== null && typeof opts !== 'object') {
      throw new RpcProtocolError('ui.showNotification: opts must be an object when provided');
    }
    return this.bridge.showNotification(
      this.extensionId,
      message,
      (opts ?? undefined) as Extensions.NotificationOpts | undefined,
    );
  }

  private async handleShowQuickPick(args: unknown[]): Promise<unknown> {
    this.assertActive();
    const items = args[0];
    if (!Array.isArray(items)) {
      throw new RpcProtocolError('ui.showQuickPick: items must be an array');
    }
    const opts = args[1];
    if (opts !== undefined && opts !== null && typeof opts !== 'object') {
      throw new RpcProtocolError('ui.showQuickPick: opts must be an object when provided');
    }
    return this.bridge.showQuickPick(
      this.extensionId,
      items as Extensions.QuickPickItemDescriptor<unknown>[],
      (opts ?? undefined) as Extensions.QuickPickOpts | undefined,
    );
  }

  private async handleShowInputBox(args: unknown[]): Promise<string | undefined> {
    this.assertActive();
    const opts = args[0];
    if (typeof opts !== 'object' || opts === null) {
      throw new RpcProtocolError('ui.showInputBox: opts must be an object');
    }
    const o = opts as Record<string, unknown>;
    if (!isLocalizedString(o.prompt)) {
      throw new RpcProtocolError('ui.showInputBox: opts.prompt must be a LocalizedString');
    }
    return this.bridge.showInputBox(this.extensionId, opts as Extensions.InputBoxOpts);
  }

  private async handleShowConfirm(args: unknown[]): Promise<boolean> {
    this.assertActive();
    const opts = args[0];
    if (typeof opts !== 'object' || opts === null) {
      throw new RpcProtocolError('ui.showConfirm: opts must be an object');
    }
    const o = opts as Record<string, unknown>;
    if (!isLocalizedString(o.title) || !isLocalizedString(o.message)) {
      throw new RpcProtocolError('ui.showConfirm: opts.title and opts.message are required');
    }
    return this.bridge.showConfirm(this.extensionId, opts as Extensions.ConfirmOpts);
  }

  private async handleDispose(args: unknown[]): Promise<void> {
    const disposalId = args[0];
    if (typeof disposalId !== 'string') return;
    const disposer = this.disposers.get(disposalId);
    if (!disposer) return;
    this.disposers.delete(disposalId);
    try {
      disposer();
    } catch {
      /* best-effort */
    }
    // If this handle was the current registration of a tracked status bar
    // item, drop the tracking too - otherwise a later `updateStatusBarItem`
    // for the same id would silently revive an item the extension just
    // disposed instead of rejecting.
    for (const [itemId, id] of this.statusBarDisposalIdByItemId) {
      if (id === disposalId) {
        this.statusBarDisposalIdByItemId.delete(itemId);
        this.statusBarDescriptors.delete(itemId);
        break;
      }
    }
  }

  // --- T2 RPC handlers ---------------------------------------------------

  private async handleRegisterVerseDecorator(args: unknown[]): Promise<{ disposalId: string }> {
    this.assertActive();
    requirePermission(this.grant, 'ui:verse-decorator');
    const d = args[0];
    if (!isVerseDecoratorDescriptor(d)) {
      throw new RpcProtocolError(
        'ui.registerVerseDecorator: expected VerseDecoratorDescriptor as first arg',
      );
    }
    const disposer = this.bridge.registerVerseDecorator(this.extensionId, d);
    const disposalId = `decorator-${this.nextDisposalId++}`;
    this.disposers.set(disposalId, disposer);
    return { disposalId };
  }

  private async handleUpdateVerseDecorations(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'ui:verse-decorator');
    const groupId = args[0];
    if (typeof groupId !== 'string' || groupId.length === 0) {
      throw new RpcProtocolError('ui.updateVerseDecorations: groupId must be a non-empty string');
    }
    const decorations = args[1];
    if (!Array.isArray(decorations)) {
      throw new RpcProtocolError('ui.updateVerseDecorations: decorations must be an array');
    }
    await this.bridge.updateVerseDecorations(this.extensionId, groupId, decorations);
  }

  private async handleRegisterVerseHover(args: unknown[]): Promise<{ disposalId: string }> {
    this.assertActive();
    requirePermission(this.grant, 'ui:verse-hover');
    const h = args[0];
    if (!isVerseHoverProviderDescriptor(h)) {
      throw new RpcProtocolError(
        'ui.registerVerseHover: expected VerseHoverProviderDescriptor as first arg',
      );
    }
    const disposer = this.bridge.registerVerseHover(this.extensionId, h);
    const disposalId = `hover-${this.nextDisposalId++}`;
    this.disposers.set(disposalId, disposer);
    return { disposalId };
  }

  private async handleRegisterContextMenu(args: unknown[]): Promise<{ disposalId: string }> {
    this.assertActive();
    requirePermission(this.grant, 'ui:context-menu');
    const target = args[0];
    if (typeof target !== 'string' || !VALID_CONTEXT_MENU_TARGETS.has(target)) {
      throw new RpcProtocolError(
        `ui.registerContextMenu: target must be one of ${[...VALID_CONTEXT_MENU_TARGETS].join(', ')}`,
      );
    }
    const item = args[1];
    if (!isContextMenuItemDescriptor(item)) {
      throw new RpcProtocolError(
        'ui.registerContextMenu: expected ContextMenuItemDescriptor as second arg',
      );
    }
    const disposer = this.bridge.registerContextMenu(
      this.extensionId,
      target as Extensions.ContextMenuTarget,
      item,
    );
    const disposalId = `ctxmenu-${this.nextDisposalId++}`;
    this.disposers.set(disposalId, disposer);
    return { disposalId };
  }

  private async handleRegisterStatusBarItem(args: unknown[]): Promise<{ disposalId: string }> {
    this.assertActive();
    requirePermission(this.grant, 'ui:status-bar');
    const item = args[0];
    if (!isStatusBarItemDescriptor(item)) {
      throw new RpcProtocolError(
        'ui.registerStatusBarItem: expected StatusBarItemDescriptor as first arg',
      );
    }
    return this.registerOrReplaceStatusBarItem(item);
  }

  private async handleUpdateStatusBarItem(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'ui:status-bar');
    const itemId = args[0];
    if (typeof itemId !== 'string' || itemId.length === 0) {
      throw new RpcProtocolError('ui.updateStatusBarItem: itemId must be a non-empty string');
    }
    const patch = args[1];
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new RpcProtocolError('ui.updateStatusBarItem: patch must be an object');
    }
    const current = this.statusBarDescriptors.get(itemId);
    if (!current) {
      throw new RpcProtocolError(
        `ui.updateStatusBarItem: '${itemId}' is not a currently-registered status bar item for this extension`,
      );
    }
    const merged: Extensions.StatusBarItemDescriptor = {
      ...current,
      ...(patch as Partial<Extensions.StatusBarItemDescriptor>),
      id: itemId, // `id` is never patchable - strip anything the caller sent for it.
    };
    if (!isStatusBarItemDescriptor(merged)) {
      throw new RpcProtocolError('ui.updateStatusBarItem: patch produced an invalid descriptor');
    }
    this.registerOrReplaceStatusBarItem(merged);
  }

  /**
   * Register `item` with the bridge, replacing any earlier registration of
   * the same `item.id` from this extension.
   *
   * Before this existed, re-registering an id minted a brand-new
   * `disposalId` and added it to `this.disposers` on every call without
   * ever dropping the previous one - `this.disposers` grew by one entry per
   * call for the extension's whole lifetime, and an author who later
   * invoked one of the earlier (stale) handles would delete the *current*
   * bridge entry out from under the latest registration, since the bridge
   * itself keys status bar items by `${extensionId}::${item.id}` and knows
   * nothing about which host-side handle is "current".
   *
   * The fix: track the current `disposalId` per `item.id` here, and when a
   * new registration for the same id lands, drop the old `disposalId` entry
   * from `this.disposers` *without invoking it* - invoking it would delete
   * the bridge entry this call is about to (re)write. The old handle
   * becomes a harmless no-op (`ui.dispose` on an unknown id is a no-op by
   * design), and only one live entry per status bar item ever exists.
   */
  private registerOrReplaceStatusBarItem(
    item: Extensions.StatusBarItemDescriptor,
  ): { disposalId: string } {
    const previousDisposalId = this.statusBarDisposalIdByItemId.get(item.id);
    if (previousDisposalId !== undefined) {
      this.disposers.delete(previousDisposalId);
    }
    const disposer = this.bridge.registerStatusBarItem(this.extensionId, item);
    const disposalId = `statusbar-${this.nextDisposalId++}`;
    this.disposers.set(disposalId, disposer);
    this.statusBarDisposalIdByItemId.set(item.id, disposalId);
    this.statusBarDescriptors.set(item.id, item);
    return { disposalId };
  }

  private async handlePickFile(args: unknown[]): Promise<Extensions.PickedFileDto | undefined> {
    this.assertActive();
    requirePermission(this.grant, 'fs:read-user');
    const opts = args[0];
    if (opts !== undefined && opts !== null && typeof opts !== 'object') {
      throw new RpcProtocolError('ui.pickFile: opts must be an object when provided');
    }
    return this.bridge.pickFile(
      this.extensionId,
      (opts ?? undefined) as Extensions.PickFileOpts | undefined,
    );
  }

  private async handleSaveFile(args: unknown[]): Promise<boolean> {
    this.assertActive();
    requirePermission(this.grant, 'fs:write-user');
    const content = args[0];
    if (typeof content !== 'string' && !(content instanceof ArrayBuffer) && !(content instanceof Uint8Array)) {
      throw new RpcProtocolError('ui.saveFile: content must be a string, ArrayBuffer, or Uint8Array');
    }
    const opts = args[1];
    if (opts !== undefined && opts !== null && typeof opts !== 'object') {
      throw new RpcProtocolError('ui.saveFile: opts must be an object when provided');
    }
    return this.bridge.saveFile(
      this.extensionId,
      content,
      (opts ?? undefined) as Extensions.SaveFileOpts | undefined,
    );
  }

  private async handleOpenSettings(args: unknown[]): Promise<void> {
    this.assertActive();
    const section = args[0];
    if (section !== undefined && section !== null && typeof section !== 'string') {
      throw new RpcProtocolError('ui.openSettings: section must be a string when provided');
    }
    this.bridge.openSettings(
      this.extensionId,
      typeof section === 'string' ? section : undefined,
    );
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`uiApiImpl for ${this.extensionId} is disposed`);
    }
  }
}

// --- Type guards ----------------------------------------------------------

function isLocalizedString(value: unknown): value is Extensions.LocalizedString {
  if (typeof value === 'string') return value.length > 0;
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>).key === 'string';
}

function isExtensionPanelTypeDef(value: unknown): value is ExtensionPanelTypeDef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.uiEntry !== 'string' || v.uiEntry.length === 0) return false;
  if (!isLocalizedString(v.title)) return false;
  return true;
}

function isVerseDecoratorDescriptor(value: unknown): value is Extensions.VerseDecoratorDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.decorateEndpoint !== 'string' || v.decorateEndpoint.length === 0) return false;
  return true;
}

function isVerseHoverProviderDescriptor(value: unknown): value is Extensions.VerseHoverProviderDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.hoverEndpoint !== 'string' || v.hoverEndpoint.length === 0) return false;
  return true;
}

function isContextMenuItemDescriptor(value: unknown): value is Extensions.ContextMenuItemDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (!isLocalizedString(v.label)) return false;
  if (typeof v.command !== 'string' || v.command.length === 0) return false;
  return true;
}

function isStatusBarItemDescriptor(value: unknown): value is Extensions.StatusBarItemDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (!isLocalizedString(v.text)) return false;
  return true;
}
