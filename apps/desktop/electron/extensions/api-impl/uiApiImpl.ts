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
import type { ContributionRegistry } from '../ContributionRegistry';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;
const { THEME_COLOR_KEYS, HOST_ICON_KEYS } = Extensions;

type ExtensionPanelTypeDef = Extensions.ExtensionPanelTypeDef;
type VerseDecoratorDescriptor = Extensions.VerseDecoratorDescriptor;
type VerseHoverProviderDescriptor = Extensions.VerseHoverProviderDescriptor;
type DecorationDto = Extensions.DecorationDto;
type DecorationTarget = Extensions.DecorationTarget;
type DecorationAppearance = Extensions.DecorationAppearance;

// Valid context menu targets - kept in sync with ExtensionApiDtos.ts.
const VALID_CONTEXT_MENU_TARGETS = new Set([
  'verse', 'verse.word', 'commentary.entry', 'dictionary.entry',
  'book.section', 'note', 'highlight', 'reference', 'search.result',
  'panel.tab',
]);

// Task 0036 (P0.1) - verse decorators/hovers. Design doc §9.
const DECORATION_FETCH_TIMEOUT_MS = 3_000;
const HOVER_FETCH_TIMEOUT_MS = 2_000;
const MAX_DECORATOR_LAYERS_PER_EXTENSION = 4;
const MAX_HOVER_PROVIDERS_PER_EXTENSION = 4;
const MAX_TARGETS_PER_DECORATION = 64;
const MAX_DECORATIONS_PER_PUSH = 2_000;
const DECORATOR_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const VALID_INVALIDATE_ON = new Set(['theme.changed', 'settings.changed', 'manual']);
const VALID_SURFACES = new Set(['standard', 'study', 'reading']);
const VALID_HOVER_SCOPES = new Set(['verse', 'word', 'both']);
const VALID_MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'meta']);
const THEME_COLOR_KEY_SET = new Set<string>(THEME_COLOR_KEYS as readonly string[]);
const HOST_ICON_KEY_SET = new Set<string>(HOST_ICON_KEYS as readonly string[]);

export interface UiApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  bridge: IExtensionUiBridge;
  grant: ExtensionPermissionGrant;
  contributionRegistry?: ContributionRegistry;
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
  private readonly contributionRegistry: ContributionRegistry | undefined;
  private decoratorCount = 0;
  private hoverProviderCount = 0;
  private readonly decoratorIds = new Set<string>();
  private readonly hoverIds = new Set<string>();

  constructor(opts: UiApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
    this.contributionRegistry = opts.contributionRegistry;
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
      invalidateVerseDecorations: (args) => this.handleInvalidateVerseDecorations(args),
      registerVerseHover: (args) => this.handleRegisterVerseHover(args),
      listThemeColorKeys: () => this.handleListThemeColorKeys(),
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
    if (this.decoratorIds.has(d.id)) {
      throw new RpcProtocolError(`ui.registerVerseDecorator: duplicate decorator id '${d.id}'`);
    }
    if (this.decoratorCount >= MAX_DECORATOR_LAYERS_PER_EXTENSION) {
      throw new RpcProtocolError(
        `ui.registerVerseDecorator: extension already has ${MAX_DECORATOR_LAYERS_PER_EXTENSION} decorators registered`,
      );
    }
    // Mirrors commandsApiImpl.ts:205-213 - build the reverse-RPC closure the
    // fetch service calls once per chapter fetch, and hand it (not the raw
    // endpoint string) to the bridge, since the endpoint string alone is not
    // callable from the renderer/main side.
    const fetch = (request: Extensions.DecorationRequestDto): Promise<unknown> =>
      this.router.request(d.decorateEndpoint, [request], {
        timeoutMs: DECORATION_FETCH_TIMEOUT_MS,
      });
    const bridgeDisposer = this.bridge.registerVerseDecorator(this.extensionId, d, fetch);
    const registryDispose = this.contributionRegistry
      ? this.contributionRegistry.register(this.extensionId, 'verseDecorator', d.id, d)
      : (): void => {};
    this.decoratorCount++;
    this.decoratorIds.add(d.id);
    const disposalId = `decorator-${this.nextDisposalId++}`;
    this.disposers.set(disposalId, () => {
      bridgeDisposer();
      registryDispose();
      this.decoratorCount--;
      this.decoratorIds.delete(d.id);
    });
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
    if (decorations.length > MAX_DECORATIONS_PER_PUSH) {
      throw new RpcProtocolError(
        `ui.updateVerseDecorations: at most ${MAX_DECORATIONS_PER_PUSH} decorations per call`,
      );
    }
    const validated = decorations
      .map((d) => validateDecorationDto(d))
      .filter((d): d is DecorationDto => d !== null);
    await this.bridge.updateVerseDecorations(this.extensionId, groupId, validated);
  }

  private async handleInvalidateVerseDecorations(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'ui:verse-decorator');
    const opts = args[0];
    if (opts !== undefined && opts !== null && typeof opts !== 'object') {
      throw new RpcProtocolError('ui.invalidateVerseDecorations: opts must be an object when provided');
    }
    await this.bridge.invalidateVerseDecorations(
      this.extensionId,
      (opts ?? undefined) as { decoratorId?: string; startVerseId?: number; endVerseId?: number } | undefined,
    );
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
    if (this.hoverIds.has(h.id)) {
      throw new RpcProtocolError(`ui.registerVerseHover: duplicate hover provider id '${h.id}'`);
    }
    if (this.hoverProviderCount >= MAX_HOVER_PROVIDERS_PER_EXTENSION) {
      throw new RpcProtocolError(
        `ui.registerVerseHover: extension already has ${MAX_HOVER_PROVIDERS_PER_EXTENSION} hover providers registered`,
      );
    }
    const fetch = (request: Extensions.VerseHoverRequestDto): Promise<unknown> =>
      this.router.request(h.hoverEndpoint, [request], {
        timeoutMs: HOVER_FETCH_TIMEOUT_MS,
      });
    const bridgeDisposer = this.bridge.registerVerseHover(this.extensionId, h, fetch);
    const registryDispose = this.contributionRegistry
      ? this.contributionRegistry.register(this.extensionId, 'verseHover', h.id, h)
      : (): void => {};
    this.hoverProviderCount++;
    this.hoverIds.add(h.id);
    const disposalId = `hover-${this.nextDisposalId++}`;
    this.disposers.set(disposalId, () => {
      bridgeDisposer();
      registryDispose();
      this.hoverProviderCount--;
      this.hoverIds.delete(h.id);
    });
    return { disposalId };
  }

  private async handleListThemeColorKeys(): Promise<string[]> {
    this.assertActive();
    return [...THEME_COLOR_KEYS];
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

function isValidDecoratorId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && DECORATOR_ID_RE.test(id);
}

function isValidSurfaces(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((s) => typeof s === 'string' && VALID_SURFACES.has(s));
}

function isVerseDecoratorDescriptor(value: unknown): value is VerseDecoratorDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isValidDecoratorId(v.id)) return false;
  if (typeof v.decorateEndpoint !== 'string' || v.decorateEndpoint.length === 0 || v.decorateEndpoint.length > 128) {
    return false;
  }
  if (v.invalidateOn !== undefined) {
    if (!Array.isArray(v.invalidateOn)) return false;
    if (!v.invalidateOn.every((i) => typeof i === 'string' && VALID_INVALIDATE_ON.has(i))) return false;
  }
  if (!isValidSurfaces(v.surfaces)) return false;
  if (v.title !== undefined && !isLocalizedString(v.title)) return false;
  return true;
}

function isVerseHoverProviderDescriptor(value: unknown): value is VerseHoverProviderDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isValidDecoratorId(v.id)) return false;
  if (typeof v.hoverEndpoint !== 'string' || v.hoverEndpoint.length === 0 || v.hoverEndpoint.length > 128) {
    return false;
  }
  if (v.scope !== undefined && (typeof v.scope !== 'string' || !VALID_HOVER_SCOPES.has(v.scope))) return false;
  if (v.modifiers !== undefined) {
    if (!Array.isArray(v.modifiers)) return false;
    if (!v.modifiers.every((m) => typeof m === 'string' && VALID_MODIFIERS.has(m))) return false;
  }
  if (v.order !== undefined && typeof v.order !== 'number') return false;
  if (!isValidSurfaces(v.surfaces)) return false;
  if (v.title !== undefined && !isLocalizedString(v.title)) return false;
  return true;
}

// --- Decoration DTO validation (design doc §3.8) --------------------------
//
// Shared by both the pull response path (`VerseDecorationService`, applied
// per fetched layer) and the push path (`handleUpdateVerseDecorations`
// above). A malformed decoration is dropped, not fatal - the rest of the
// array still renders.

function isValidVerseId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isDecorationTarget(value: unknown): value is DecorationTarget {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case 'verse':
      return isValidVerseId(v.verseId);
    case 'passage':
      return (
        isValidVerseId(v.startVerseId) &&
        isValidVerseId(v.endVerseId) &&
        (v.endVerseId as number) >= (v.startVerseId as number)
      );
    case 'tokens':
      return (
        isValidVerseId(v.verseId) &&
        typeof v.startTokenIndex === 'number' &&
        v.startTokenIndex >= 0 &&
        (v.endTokenIndex === undefined || (typeof v.endTokenIndex === 'number' && v.endTokenIndex >= v.startTokenIndex))
      );
    case 'word': {
      if (typeof v.text !== 'string' || v.text.length === 0) return false;
      const scope = v.scope as Record<string, unknown> | undefined;
      if (typeof scope !== 'object' || scope === null) return false;
      const scopeOk =
        isValidVerseId(scope.verseId) ||
        (isValidVerseId(scope.startVerseId) && isValidVerseId(scope.endVerseId));
      if (!scopeOk) return false;
      if (v.occurrence !== undefined && (typeof v.occurrence !== 'number' || v.occurrence < 1)) return false;
      if (v.matchCase !== undefined && typeof v.matchCase !== 'boolean') return false;
      return true;
    }
    default:
      return false;
  }
}

function resolveColorKeyOrDrop<T extends { color?: unknown }>(v: T): boolean {
  if (v.color === undefined) return true;
  return typeof v.color === 'string' && THEME_COLOR_KEY_SET.has(v.color);
}

function isDecorationAppearance(value: unknown): value is DecorationAppearance {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case 'tint':
      if (typeof v.color !== 'string' || !THEME_COLOR_KEY_SET.has(v.color)) return false;
      if (v.intensity !== undefined && !['subtle', 'normal', 'strong'].includes(v.intensity as string)) return false;
      return true;
    case 'underline':
      if (typeof v.color !== 'string' || !THEME_COLOR_KEY_SET.has(v.color)) return false;
      if (v.style !== undefined && !['solid', 'dashed', 'dotted'].includes(v.style as string)) return false;
      if (v.thickness !== undefined && !['thin', 'medium', 'thick'].includes(v.thickness as string)) return false;
      return true;
    case 'gutter':
      if (typeof v.icon !== 'string' || !HOST_ICON_KEY_SET.has(v.icon)) return false;
      if (!resolveColorKeyOrDrop(v)) return false;
      if (v.tooltip !== undefined && !isLocalizedString(v.tooltip)) return false;
      return true;
    case 'emphasis':
      return true;
    case 'strike':
      return resolveColorKeyOrDrop(v);
    case 'badge':
      if (typeof v.label !== 'string' || v.label.length === 0 || v.label.length > 12) return false;
      if (!/^[\p{L}\p{N} .:·+#/-]{1,12}$/u.test(v.label)) return false;
      return resolveColorKeyOrDrop(v);
    default:
      return false;
  }
}

/**
 * Validates one `DecorationDto`. Returns `null` (drop it) if malformed.
 * Exported for `VerseDecorationService`, which applies the same validator to
 * pull responses (design doc §3.8: one validator, both push and pull).
 */
export function validateDecorationDto(value: unknown): DecorationDto | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const targets = Array.isArray(v.target) ? v.target : [v.target];
  if (targets.length === 0 || targets.length > MAX_TARGETS_PER_DECORATION) return null;
  if (!targets.every((t) => isDecorationTarget(t))) return null;
  if (!isDecorationAppearance(v.appearance)) return null;
  if (v.order !== undefined && (typeof v.order !== 'number' || v.order < -1000 || v.order > 1000)) return null;
  if (v.groupId !== undefined && typeof v.groupId !== 'string') return null;
  if (v.hoverContent !== undefined && !isHoverContentDto(v.hoverContent)) return null;
  return v as unknown as DecorationDto;
}

// --- Hover content validation (task 0036, P0.1c; design doc §3.7, §11) ----
//
// Shared by `DecorationDto.hoverContent` (static, validated above) and
// `VerseDecorationService.fetchHover`'s callback-provider responses (one
// provider may return several sections - `validateHoverContentArray`).

const VALID_HOVER_KINDS = new Set(['text', 'markdown', 'iframe']);
/** Generous but bounded - a hover popup is not a document viewer. */
const MAX_HOVER_TEXT_LENGTH = 4_000;
/** Per provider, per fetch - mirrors the badge/gutter-style "cap, don't reject" caps elsewhere in this vocabulary. */
export const MAX_HOVER_SECTIONS_PER_PROVIDER = 8;

export function isHoverContentDto(value: unknown): value is Extensions.HoverContentDto {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== 'string' || !VALID_HOVER_KINDS.has(v.kind)) return false;
  switch (v.kind) {
    case 'text':
      return typeof v.text === 'string' && v.text.length > 0 && v.text.length <= MAX_HOVER_TEXT_LENGTH;
    case 'markdown':
      if (typeof v.markdown !== 'string' || v.markdown.length === 0 || v.markdown.length > MAX_HOVER_TEXT_LENGTH) {
        return false;
      }
      return v.allowImages === undefined || typeof v.allowImages === 'boolean';
    case 'iframe':
      if (typeof v.uiEntry !== 'string' || v.uiEntry.length === 0) return false;
      if (v.width !== undefined && typeof v.width !== 'number') return false;
      if (v.height !== undefined && typeof v.height !== 'number') return false;
      return true;
    default:
      return false;
  }
}

/** Validates a callback hover provider's raw response. Drops malformed items; caps the rest. */
export function validateHoverContentArray(raw: unknown): Extensions.HoverContentDto[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter((item): item is Extensions.HoverContentDto => isHoverContentDto(item));
  return valid.slice(0, MAX_HOVER_SECTIONS_PER_PROVIDER);
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
