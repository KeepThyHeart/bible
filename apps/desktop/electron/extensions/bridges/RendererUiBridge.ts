/**
 * Production `IExtensionUiBridge`.
 *
 * `showNotification`, `showQuickPick`, `showInputBox`, `showConfirm` round-trip
 * into the renderer, which mounts the actual toaster + modal stack. The panel
 * type registry is intentionally main-process-only: `registerPanelType`
 * never leaves the host, so the panel registry lives here.
 *
 * Renderer side lives in `src/ui/extensions/extensionRendererBridge.ts` and
 * `src/ui/extensions/ExtensionUiHost.tsx`.
 */

import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Extensions } from '@bible/core';

import type { IExtensionUiBridge } from '../api-impl/IExtensionDataBridges';
import { BridgeRpc } from './RendererBridgeRpc';

type LocalizedString = Extensions.LocalizedString;
type NotificationOpts = Extensions.NotificationOpts;
type QuickPickItemDescriptor<T> = Extensions.QuickPickItemDescriptor<T>;
type QuickPickOpts = Extensions.QuickPickOpts;
type InputBoxOpts = Extensions.InputBoxOpts;
type ConfirmOpts = Extensions.ConfirmOpts;
type ExtensionPanelTypeDef = Extensions.ExtensionPanelTypeDef;
type VerseDecoratorDescriptor = Extensions.VerseDecoratorDescriptor;
type DecorationDto = Extensions.DecorationDto;
type VerseHoverProviderDescriptor = Extensions.VerseHoverProviderDescriptor;
type ContextMenuTarget = Extensions.ContextMenuTarget;
type ContextMenuItemDescriptor = Extensions.ContextMenuItemDescriptor;
type DisplayModeDescriptor = Extensions.DisplayModeDescriptor;
type StatusBarItemDescriptor = Extensions.StatusBarItemDescriptor;
type PickFileOpts = Extensions.PickFileOpts;
type PickedFileDto = Extensions.PickedFileDto;
type SaveFileOpts = Extensions.SaveFileOpts;

export class RendererUiBridge implements IExtensionUiBridge {
  private readonly rpc: BridgeRpc;
  private readonly getWindow: () => BrowserWindow | null;
  // Panel-type registry lives entirely in the host.
  private readonly panelTypes = new Map<string, ExtensionPanelTypeDef>();
  private readonly panelTypeOwners = new Map<string, string>();

  // T2 registries - keyed by `${extensionId}::${descriptor.id}`.
  private readonly decorators = new Map<string, VerseDecoratorDescriptor>();
  private readonly decoratorOwners = new Map<string, string>();
  private readonly hoverProviders = new Map<string, VerseHoverProviderDescriptor>();
  private readonly hoverOwners = new Map<string, string>();
  private readonly contextMenuItems = new Map<string, { target: ContextMenuTarget; item: ContextMenuItemDescriptor }>();
  private readonly contextMenuOwners = new Map<string, string>();
  private readonly displayModes = new Map<string, DisplayModeDescriptor>();
  private readonly displayModeOwners = new Map<string, string>();
  private readonly statusBarItems = new Map<string, StatusBarItemDescriptor>();
  private readonly statusBarOwners = new Map<string, string>();

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
    this.rpc = new BridgeRpc({
      outboundChannel: 'ext-bridge:ui',
      responseChannel: 'ext-bridge:ui:response',
      getWindow,
    });
  }

  // --- Dialog / notification surface (renderer-backed) -------------------

  async showNotification(
    extensionId: string,
    message: LocalizedString,
    opts?: NotificationOpts,
  ): Promise<void> {
    await this.rpc.request<void>('showNotification', [extensionId, message, opts ?? null]);
  }

  async showQuickPick<T>(
    extensionId: string,
    items: QuickPickItemDescriptor<T>[],
    opts?: QuickPickOpts,
  ): Promise<T | undefined> {
    // We can only ferry primitive values across IPC. Strip the (potentially
    // non-serializable) `value` slot, send descriptors with positional ids,
    // then map back on response.
    const idMap = new Map<number, T>();
    const descriptors = items.map((item, idx) => {
      idMap.set(idx, item.value as T);
      return {
        id: idx,
        label: item.label,
        ...(item.detail !== undefined ? { detail: item.detail } : {}),
        ...(item.description !== undefined ? { description: item.description } : {}),
      };
    });
    const picked = await this.rpc.request<number | null>('showQuickPick', [
      extensionId,
      descriptors,
      opts ?? null,
    ]);
    if (picked === null || picked === undefined) return undefined;
    return idMap.get(picked);
  }

  async showInputBox(extensionId: string, opts: InputBoxOpts): Promise<string | undefined> {
    const value = await this.rpc.request<string | null>('showInputBox', [extensionId, opts]);
    return value === null || value === undefined ? undefined : value;
  }

  async showConfirm(extensionId: string, opts: ConfirmOpts): Promise<boolean> {
    return Boolean(await this.rpc.request<boolean>('showConfirm', [extensionId, opts]));
  }

  // --- Panel-type registry (local to host) -------------------------------

  registerPanelType(extensionId: string, def: ExtensionPanelTypeDef): () => void {
    const key = `${extensionId}.${def.id}`;
    this.panelTypes.set(key, def);
    this.panelTypeOwners.set(key, extensionId);
    // Notify the renderer so it can update its "Open extension panel" menu.
    this.rpc.notify('panelTypeRegistered', [{ extensionId, def }]);
    return () => {
      if (this.panelTypes.delete(key)) {
        this.panelTypeOwners.delete(key);
        this.rpc.notify('panelTypeUnregistered', [{ extensionId, panelTypeId: def.id }]);
      }
    };
  }

  disposePanelTypesByOwner(extensionId: string): number {
    let removed = 0;
    for (const [key, owner] of this.panelTypeOwners) {
      if (owner === extensionId) {
        const def = this.panelTypes.get(key);
        this.panelTypes.delete(key);
        this.panelTypeOwners.delete(key);
        removed++;
        if (def) {
          this.rpc.notify('panelTypeUnregistered', [{ extensionId, panelTypeId: def.id }]);
        }
      }
    }
    return removed;
  }

  getPanelType(extensionId: string, panelTypeId: string): ExtensionPanelTypeDef | undefined {
    return this.panelTypes.get(`${extensionId}.${panelTypeId}`);
  }

  listPanelTypes(): { extensionId: string; def: ExtensionPanelTypeDef }[] {
    const out: { extensionId: string; def: ExtensionPanelTypeDef }[] = [];
    for (const [key, def] of this.panelTypes) {
      const owner = this.panelTypeOwners.get(key);
      if (owner) out.push({ extensionId: owner, def });
    }
    return out;
  }

  /**
   * Worker -> panel push. The renderer routes it to the mounted iframes owned
   * by `extensionId`, optionally narrowed to one `panelId`.
   *
   * Fire-and-forget by design: the worker is telling its panels something, not
   * asking them. A panel that is closed, never opened, or still loading simply
   * misses it, which is why anything a panel must not miss belongs in storage
   * the panel reads on mount rather than in a push.
   */
  postPanelMessage(extensionId: string, message: unknown, panelId?: string): void {
    this.rpc.notify('panelMessage', [
      { extensionId, message, ...(panelId !== undefined ? { panelId } : {}) },
    ]);
  }

  // --- T2 UI methods -------------------------------------------------------

  registerVerseDecorator(extensionId: string, descriptor: VerseDecoratorDescriptor): () => void {
    const key = `${extensionId}::${descriptor.id}`;
    this.decorators.set(key, descriptor);
    this.decoratorOwners.set(key, extensionId);
    this.rpc.notify('verseDecoratorRegistered', [{ extensionId, descriptor }]);
    return () => {
      if (this.decorators.delete(key)) {
        this.decoratorOwners.delete(key);
        this.rpc.notify('verseDecoratorUnregistered', [{ extensionId, decoratorId: descriptor.id }]);
      }
    };
  }

  async updateVerseDecorations(
    extensionId: string,
    groupId: string,
    decorations: DecorationDto[],
  ): Promise<void> {
    this.rpc.notify('verseDecorationsUpdated', [{ extensionId, groupId, decorations }]);
  }

  registerVerseHover(extensionId: string, descriptor: VerseHoverProviderDescriptor): () => void {
    const key = `${extensionId}::${descriptor.id}`;
    this.hoverProviders.set(key, descriptor);
    this.hoverOwners.set(key, extensionId);
    this.rpc.notify('verseHoverRegistered', [{ extensionId, descriptor }]);
    return () => {
      if (this.hoverProviders.delete(key)) {
        this.hoverOwners.delete(key);
        this.rpc.notify('verseHoverUnregistered', [{ extensionId, hoverId: descriptor.id }]);
      }
    };
  }

  registerContextMenu(
    extensionId: string,
    target: ContextMenuTarget,
    item: ContextMenuItemDescriptor,
  ): () => void {
    const key = `${extensionId}::${item.id}`;
    this.contextMenuItems.set(key, { target, item });
    this.contextMenuOwners.set(key, extensionId);
    this.rpc.notify('contextMenuItemRegistered', [{ extensionId, target, item }]);
    return () => {
      if (this.contextMenuItems.delete(key)) {
        this.contextMenuOwners.delete(key);
        this.rpc.notify('contextMenuItemUnregistered', [{ extensionId, itemId: item.id }]);
      }
    };
  }

  /**
   * RESERVED, and unreachable from the extension API.
   * `UiApiImpl.handleRegisterDisplayMode` now rejects every call with
   * `MethodNotImplementedYet`, so nothing calls this except tests.
   *
   * The `displayModeRegistered` / `displayModeUnregistered` notifications are
   * GONE, not merely unused. They had no listener anywhere in `src/ui` - the
   * Bible pane's Display Mode picker is the fixed Simple/Standard/Study set from
   * `useBibleStore` - so every notify was a message into a void. Keeping them
   * would have been worse than removing them: an IPC channel with no receiver
   * reads to the next person as a wired-up feature and is the thing you check
   * last when the feature turns out not to exist. Removing them makes the whole
   * path honest - the API rejects, the bridge is inert, and nothing pretends.
   *
   * The registry maps stay so the method still satisfies `IExtensionUiBridge`
   * and so `disposeUiContributionsByOwner` keeps one code shape across all T2
   * contributions. Restore the notifies alongside a renderer that listens for
   * them when display modes are actually built.
   */
  registerDisplayMode(extensionId: string, descriptor: DisplayModeDescriptor): () => void {
    const key = `${extensionId}::${descriptor.id}`;
    this.displayModes.set(key, descriptor);
    this.displayModeOwners.set(key, extensionId);
    return () => {
      if (this.displayModes.delete(key)) {
        this.displayModeOwners.delete(key);
      }
    };
  }

  registerStatusBarItem(extensionId: string, item: StatusBarItemDescriptor): () => void {
    const key = `${extensionId}::${item.id}`;
    this.statusBarItems.set(key, item);
    this.statusBarOwners.set(key, extensionId);
    this.rpc.notify('statusBarItemRegistered', [{ extensionId, item }]);
    return () => {
      if (this.statusBarItems.delete(key)) {
        this.statusBarOwners.delete(key);
        this.rpc.notify('statusBarItemUnregistered', [{ extensionId, itemId: item.id }]);
      }
    };
  }

  async pickFile(_extensionId: string, opts?: PickFileOpts): Promise<PickedFileDto | undefined> {
    const win = this.getWindow();
    if (!win) return undefined;

    const filters: Electron.FileFilter[] = [];
    if (opts?.filters) {
      for (const f of opts.filters) {
        filters.push({
          name: typeof f.name === 'string' ? f.name : f.name.key,
          extensions: f.extensions,
        });
      }
    }

    const result = await dialog.showOpenDialog(win, {
      title: opts?.title ? (typeof opts.title === 'string' ? opts.title : opts.title.key) : undefined,
      filters: filters.length > 0 ? filters : undefined,
      properties: opts?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) return undefined;

    const filePath = result.filePaths[0];
    const encoding = opts?.encoding ?? 'text';
    const buf = fs.readFileSync(filePath);
    const contents: string | ArrayBuffer = encoding === 'binary'
      ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      : buf.toString('utf-8');

    return {
      name: path.basename(filePath),
      size: buf.byteLength,
      contents,
      handle: crypto.randomUUID(),
    };
  }

  async saveFile(
    _extensionId: string,
    content: string | ArrayBuffer | Uint8Array,
    opts?: SaveFileOpts,
  ): Promise<boolean> {
    const win = this.getWindow();
    if (!win) return false;

    const filters: Electron.FileFilter[] = [];
    if (opts?.filters) {
      for (const f of opts.filters) {
        filters.push({
          name: typeof f.name === 'string' ? f.name : f.name.key,
          extensions: f.extensions,
        });
      }
    }

    const result = await dialog.showSaveDialog(win, {
      title: opts?.title ? (typeof opts.title === 'string' ? opts.title : opts.title.key) : undefined,
      defaultPath: opts?.defaultFilename,
      filters: filters.length > 0 ? filters : undefined,
    });

    if (result.canceled || !result.filePath) return false;

    if (typeof content === 'string') {
      fs.writeFileSync(result.filePath, content, 'utf-8');
    } else if (content instanceof Uint8Array) {
      fs.writeFileSync(result.filePath, content);
    } else {
      fs.writeFileSync(result.filePath, Buffer.from(new Uint8Array(content)));
    }
    return true;
  }

  disposeUiContributionsByOwner(extensionId: string): number {
    let removed = 0;
    const registries: [Map<string, unknown>, Map<string, string>][] = [
      [this.decorators, this.decoratorOwners],
      [this.hoverProviders, this.hoverOwners],
      [this.contextMenuItems, this.contextMenuOwners],
      [this.displayModes, this.displayModeOwners],
      [this.statusBarItems, this.statusBarOwners],
    ];
    for (const [dataMap, ownerMap] of registries) {
      for (const [key, owner] of ownerMap) {
        if (owner === extensionId) {
          dataMap.delete(key);
          ownerMap.delete(key);
          removed++;
        }
      }
    }
    return removed;
  }
}
