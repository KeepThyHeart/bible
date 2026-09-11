/**
 * Renderer-facing IPC handlers for the extension host.
 *
 * Exposes the surface the Extensions panel UI needs:
 *
 *   extensions:list                    -> ExtensionStateInfo[]
 *   extensions:get                     -> ExtensionStateInfo | null
 *   extensions:installFromFolder       -> InstallResult | InstallError
 *   extensions:installFromZip          -> InstallResult | InstallError
 *   extensions:pickFolderAndInstall    -> InstallResult | InstallError
 *   extensions:pickZipAndInstall       -> InstallResult | InstallError
 *   extensions:uninstall               -> void
 *   extensions:enable                  -> void
 *   extensions:disable                 -> void
 *   extensions:activate                -> void
 *   extensions:deactivate              -> void
 *   extensions:resetCrashState         -> void
 *   extensions:updatePermissions       -> void
 *   extensions:getSettings             -> Record
 *   extensions:setSettings             -> void
 *   extensions:getLog                  -> ExtensionLogEntry[]
 *   extensions:getCrashLog             -> ExtensionCrashRecord[]
 *   extensions:getPanelTypeUiEntry     -> { uiEntry, title? } | null
 *   extensions:uiFetch                 -> NetworkFetchResponse
 *
 * The renderer-driven per-permission consent dialog (see
 * `RendererConsentPrompter`) means the install handler does not pop its own
 * confirm - it lets `host.installExtension` invoke the prompter.
 */

import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import log from 'electron-log';

import type { ExtensionHost } from '../extensions/ExtensionHost';
import type { IExtensionUiBridge } from '../extensions/api-impl/IExtensionDataBridges';
import { t } from '../services/MainI18n';

export interface ExtensionHandlersOptions {
  /**
   * UI bridge - the panel-type registry lives here, so the IPC handler that
   * resolves `getPanelTypeUiEntry` reaches into it. Optional so tests and
   * callers without a UI bridge still work; the handler returns null in that
   * case.
   */
  uiBridge?: IExtensionUiBridge;
}

export function registerExtensionHandlers(
  host: ExtensionHost,
  options: ExtensionHandlersOptions = {},
): void {
  ipcMain.handle('extensions:list', async () => {
    return host.listExtensions();
  });

  ipcMain.handle('extensions:get', async (_e, extensionId: string) => {
    return host.getExtension(extensionId);
  });

  async function installFromFolder(
    sourcePath: string,
    _parentWindow: BrowserWindow | undefined,
  ): Promise<unknown> {
    // The host drives a renderer-side consent dialog
    // (`createRendererConsentPrompter`). We pass no `consent` field so the
    // host invokes the prompter and the user gets the per-permission UI.
    const result = await host.installExtension({
      sourcePath,
    });
    if (result.ok && result.state.enabled) {
      try {
        await host.activate(result.state.manifest.id);
      } catch (err) {
        log.warn(
          `[extensions:installFromFolder] post-install activate(${result.state.manifest.id}) failed:`,
          err,
        );
      }
    }
    return result;
  }

  ipcMain.handle('extensions:installFromFolder', async (event, sourcePath: string) => {
    const focused = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return installFromFolder(sourcePath, focused);
  });

  ipcMain.handle('extensions:pickFolderAndInstall', async (event) => {
    const focused = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const picked = await dialog.showOpenDialog(focused!, {
      title: t('main.dialog.selectExtensionFolder'),
      properties: ['openDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, code: 'Cancelled', message: 'User cancelled the folder picker.' };
    }
    return installFromFolder(picked.filePaths[0]!, focused);
  });

  // --- Developer Mode ----------------------------------------------------
  // The renderer may *ask* for these, but the authority is the host's
  // `devConfig` - `loadUnpacked` re-checks it rather than trusting that the
  // UI only offered the button when the mode was on.

  ipcMain.handle('extensions:getDeveloperMode', async () => host.isDeveloperMode());

  ipcMain.handle('extensions:setDeveloperMode', async (_e, enabled: boolean) => {
    host.setDeveloperMode(enabled === true);
    return host.isDeveloperMode();
  });

  ipcMain.handle('extensions:pickFolderAndLoadUnpacked', async (event) => {
    const focused = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    if (!host.isDeveloperMode()) {
      return {
        ok: false,
        code: 'DeveloperModeDisabled',
        message: 'Turn on Developer Mode before loading an unpacked extension.',
      };
    }
    const picked = await dialog.showOpenDialog(focused!, {
      title: t('main.dialog.selectUnpackedExtensionFolder'),
      properties: ['openDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, code: 'Cancelled', message: 'User cancelled the folder picker.' };
    }
    return host.loadUnpacked({ sourcePath: picked.filePaths[0]! });
  });

  ipcMain.handle('extensions:reloadUnpacked', async (_e, extensionId: string) =>
    host.reloadUnpacked(extensionId),
  );

  // ZIP archive install. Same consent flow as the folder install: the host runs the renderer-side prompter.
  ipcMain.handle('extensions:installFromZip', async (_event, zipPath: string) => {
    const result = await host.installExtensionFromZip({ zipPath });
    // `enabled` is false for every *fresh* install, so this branch no
    // longer fires for newly sideloaded code - the user enables it explicitly.
    // It still fires when an already-enabled extension is upgraded in place,
    // which is the one case where continuing to run is what the user expects.
    if (result.ok && result.state.enabled) {
      try {
        await host.activate(result.state.manifest.id);
      } catch (err) {
        log.warn(
          `[extensions:installFromZip] post-install activate(${result.state.manifest.id}) failed:`,
          err,
        );
      }
    }
    return result;
  });

  ipcMain.handle('extensions:pickZipAndInstall', async (event) => {
    const focused = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const picked = await dialog.showOpenDialog(focused!, {
      title: t('main.dialog.selectExtensionArchive'),
      properties: ['openFile'],
      filters: [{ name: t('main.filter.extensionArchive'), extensions: ['zip'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, code: 'Cancelled', message: 'User cancelled the file picker.' };
    }
    const zipPath = picked.filePaths[0]!;
    const result = await host.installExtensionFromZip({ zipPath });
    // `enabled` is false for every *fresh* install, so this branch no
    // longer fires for newly sideloaded code - the user enables it explicitly.
    // It still fires when an already-enabled extension is upgraded in place,
    // which is the one case where continuing to run is what the user expects.
    if (result.ok && result.state.enabled) {
      try {
        await host.activate(result.state.manifest.id);
      } catch (err) {
        log.warn(
          `[extensions:pickZipAndInstall] post-install activate(${result.state.manifest.id}) failed:`,
          err,
        );
      }
    }
    return result;
  });

  // The only sanctioned egress path for extension panel iframes. The iframe's CSP no longer lists any remote host, so UI code
  // reaches the network through here or not at all; the request then runs the
  // extension's own allowlist, throttle, bandwidth cap, redirect
  // re-validation, and the master offline switch.
  //
  // `extensionId` is supplied by the renderer's panel host, which knows it
  // from the closure that mounted the iframe - the iframe itself never names
  // an extension, so it cannot borrow another extension's network grant.
  ipcMain.handle(
    'extensions:uiFetch',
    async (_e, extensionId: string, url: string, init?: unknown) => {
      if (typeof extensionId !== 'string' || extensionId.length === 0) {
        throw new Error('extensions:uiFetch: extensionId must be a non-empty string');
      }
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error('extensions:uiFetch: url must be a non-empty string');
      }
      if (init !== undefined && (typeof init !== 'object' || init === null)) {
        throw new Error('extensions:uiFetch: init must be an object when provided');
      }
      // Everything past this point is validated by the api-impl, which already
      // treats its caller as untrusted.
      return host.uiFetch(extensionId, url, init as never);
    },
  );

  // The panel-to-worker channel. A panel iframe posts an opaque message; the
  // host hands it to that panel's own extension worker and returns whatever
  // the worker's `api.panels.onMessage` handler resolved with.
  //
  // Same trust model as `uiFetch` above, and for the same reason: the
  // renderer's panel host supplies `extensionId` from the closure that
  // mounted the iframe. The iframe never names an extension, so a panel
  // cannot address another extension's worker or spend its grants. The
  // payload itself is opaque here - size and timeout are enforced in
  // `panelsApiImpl`, and meaning is the extension's own business.
  ipcMain.handle(
    'extensions:panelInvoke',
    async (
      _e,
      extensionId: string,
      panelId: string,
      panelTypeId: string,
      message: unknown,
    ) => {
      if (typeof extensionId !== 'string' || extensionId.length === 0) {
        throw new Error('extensions:panelInvoke: extensionId must be a non-empty string');
      }
      if (typeof panelId !== 'string' || panelId.length === 0) {
        throw new Error('extensions:panelInvoke: panelId must be a non-empty string');
      }
      if (typeof panelTypeId !== 'string' || panelTypeId.length === 0) {
        throw new Error('extensions:panelInvoke: panelTypeId must be a non-empty string');
      }
      return host.panelInvoke({ extensionId, panelId, panelTypeId }, message);
    },
  );

  // Additional surface needed by the full Extensions panel.
  ipcMain.handle(
    'extensions:updatePermissions',
    async (_e, extensionId: string, grantedPermissions: string[]) => {
      await host.updatePermissions(extensionId, grantedPermissions as never);
    },
  );

  ipcMain.handle('extensions:getSettings', async (_e, extensionId: string) => {
    return host.getSettings(extensionId);
  });

  ipcMain.handle(
    'extensions:setSettings',
    async (_e, extensionId: string, values: Record<string, unknown>) => {
      await host.setSettings(extensionId, values);
    },
  );

  ipcMain.handle('extensions:uninstall', async (_e, extensionId: string) => {
    await host.uninstallExtension(extensionId);
  });

  ipcMain.handle('extensions:enable', async (_e, extensionId: string) => {
    await host.enable(extensionId);
  });

  ipcMain.handle('extensions:disable', async (_e, extensionId: string) => {
    await host.disable(extensionId);
  });

  ipcMain.handle('extensions:activate', async (_e, extensionId: string) => {
    await host.activate(extensionId);
  });

  ipcMain.handle('extensions:deactivate', async (_e, extensionId: string) => {
    await host.deactivate(extensionId);
  });

  ipcMain.handle('extensions:resetCrashState', async (_e, extensionId: string) => {
    await host.resetCrashState(extensionId);
  });

  ipcMain.handle('extensions:getLog', async (_e, extensionId: string, limit?: number) => {
    return host.getLog(extensionId, limit);
  });

  ipcMain.handle('extensions:getCrashLog', async (_e, extensionId: string, limit?: number) => {
    return host.getCrashLog(extensionId, limit);
  });

  ipcMain.handle(
    'extensions:getPanelTypeUiEntry',
    async (_e, extensionId: string, panelTypeId: string) => {
      // The UiBridge owns the panel-type registry. The
      // handler returns the renderer the `uiEntry` (HTML path inside the
      // extension package) and an optional title so `ExtensionPanelHost`
      // can mount the iframe with the right `ext-ui://` URL.
      const def = options.uiBridge?.getPanelType(extensionId, panelTypeId);
      if (!def) return null;
      // Check if the extension has ui:media permission for autoplay support.
      const state = await host.getExtension(extensionId);
      const allowAutoplay =
        state?.grantedPermissions?.includes('ui:media' as never) ?? false;
      return {
        uiEntry: def.uiEntry,
        ...(def.title !== undefined ? { title: def.title } : {}),
        ...(allowAutoplay ? { allowAutoplay: true } : {}),
      };
    },
  );

  ipcMain.handle('extensions:openInstallFolder', async (_e, extensionId: string) => {
    const state = await host.getExtension(extensionId);
    if (!state) return false;
    await shell.openPath(state.installPath);
    return true;
  });
}
