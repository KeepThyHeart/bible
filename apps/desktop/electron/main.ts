import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { tmpdir } from 'os';
import log from 'electron-log';
import { registerBibleHandlers, closeBibleDb } from './ipc/bibleHandlers';
import { registerCommentaryHandlers, closeCommentaryDbs } from './ipc/commentaryHandlers';
import { registerDictionaryHandlers, closeDictionaryDbs } from './ipc/dictionaryHandlers';
import { registerBookHandlers, closeBookDbs } from './ipc/bookHandlers';
import { registerTopicalIndexHandlers, closeTopicalDbs } from './ipc/topicalIndexHandlers';
import { registerCrossReferenceHandlers, closeXrefDbs } from './ipc/crossReferenceHandlers';
import { registerTagGraphHandlers, closeTagGraphDb } from './ipc/tagGraphHandlers';
import { registerSearchHandlers, closeSearchDb } from './ipc/searchHandlers';
import { registerSessionHandlers, closeSessionDb } from './ipc/sessionHandlers';
import { registerNotesHandlers, initializeNotesDatabase, closeNotesDatabase } from './ipc/notesHandlers';
import { registerCollectionHandlers, closeCollectionService } from './ipc/collectionHandlers';
import { registerHighlightHandlers, initializeHighlightRepository, closeHighlightRepository } from './ipc/highlightHandlers';
import { registerModuleHandlers, closeModuleManager } from './ipc/moduleHandlers';
import { registerFeaturePackHandlers, closeFeaturePackHandlers } from './ipc/featurePackHandlers';
import { registerI18nHandlers } from './ipc/i18nHandlers';
import { loadMainCatalogs, t } from './services/MainI18n';
import { registerBackupHandlers } from './ipc/backupHandlers';
import { registerFileNotesHandlers, initializeFileNotesService } from './ipc/fileNotesHandlers';
import {
  registerDiagnosticsHandlers,
  initializeDiagnosticsService,
  getDiagnosticsService,
  getDiagnosticsQueue,
  getDiagnosticsConfig,
  getDiagnosticsUploader,
} from './ipc/diagnosticsHandlers';
import { registerStudyHandlers } from './ipc/studyHandlers';
import { registerNetworkHandlers, initializeNetworkService } from './ipc/networkHandlers';
import { registerUpdateHandlers, setBlocklistRefresher } from './ipc/updateHandlers';
import { MenuBuilder, registerMenuRebuildHandler } from './menu/menuBuilder';
import { detectAndRegisterModules } from './utils/moduleDetector';
import { initializeMainDatabase } from './utils/initMainDatabase';
import { windowManager } from './services/WindowManager';
import { WindowStateService } from './services/WindowStateService';
import { getPaneConfig } from './config/paneConfig';
import { APP_CONFIG } from './config/appConfig';
import { SESSION_SAVE_SHUTDOWN_TIMEOUT_MS } from './config/constants';
import { getBundledMainDbPath, getDataPath, resolveAppIconPath, resolveMainDbPath } from './utils/appPaths';
import { applyWindowSecurity, lockDownNavigation, openExternalUrl } from './utils/windowSecurity';
import { closeSharedMainDb } from './services/sharedMainDb';
import { closeStudyCache } from './services/StudyCacheService';
import { startStudyCacheSweep, stopStudyCacheSweep } from './services/StudyCacheSweeper';
import { closeSharedUserDb, getSharedUserDb } from './services/sharedUserDb';
import { getModuleDatabaseRegistry } from './services/ModuleDatabaseRegistry';
import { ExtensionHost } from './extensions/ExtensionHost';
import { ExtensionDevConfig } from './extensions/ExtensionDevConfig';
import { electronUtilityProcessFactory } from './extensions/electronUtilityProcessFactory';
import { BibleBridge } from './extensions/bridges/BibleBridge';
import { CommentaryBridge } from './extensions/bridges/CommentaryBridge';
import { DictionaryBridge } from './extensions/bridges/DictionaryBridge';
import { BookBridge } from './extensions/bridges/BookBridge';
import { RendererCommandBridge } from './extensions/bridges/RendererCommandBridge';
import { RendererContextBridge } from './extensions/bridges/RendererContextBridge';
import { RendererUiBridge } from './extensions/bridges/RendererUiBridge';
import { RendererWorkspaceBridge } from './extensions/bridges/RendererWorkspaceBridge';
import { RendererL10nBridge } from './extensions/bridges/RendererL10nBridge';
import { createRendererConsentPrompter } from './extensions/bridges/RendererConsentPrompter';
import { SafeStorageSecretsKeychain } from './extensions/SecretsKeychain';
import { ExtensionDatabaseRegistry } from './extensions/ExtensionDatabaseRegistry';
import { openHardenedExtensionDatabase } from './extensions/ExtensionSqlGuard';
import {
  ElectronNetworkGateway,
  defaultExtensionSessionFactory,
} from './extensions/gateways/ExtensionNetworkGateway';
import { getBibleRepository } from './ipc/bibleHandlers';
import { getCommentaryRepository } from './ipc/commentaryHandlers';
import { getDictionaryRepository } from './ipc/dictionaryHandlers';
import { getBookRepository } from './ipc/bookHandlers';
import { getSharedBookRepo, getSharedModuleMetadataRepo } from './services/sharedMainDb';
import { registerExtensionHandlers } from './ipc/extensionHandlers';
import { registerMarketplaceHandlers } from './ipc/marketplaceHandlers';
import { ExtensionCatalogService } from './extensions/marketplace/ExtensionCatalogService';
import { ExtensionBlocklistService } from './extensions/marketplace/ExtensionBlocklistService';
import {
  registerExtUiProtocol,
  registerExtUiSchemePrivileged,
} from './extensions/extUiProtocol';

// Configure electron-log
log.transports.file.level = 'info';

// EPIPE occurs when the parent process (e.g. Playwright, IDE terminal) closes
// stdout/stderr before Electron finishes writing. Without this wrapper, an
// unhandled EPIPE crashes the app during E2E tests and CI pipelines.
try {
  log.transports.console.level = 'debug';

  const consoleTransport = log.transports.console as any;
  const fileTransport = log.transports.file as any;
  const originalConsoleLog = consoleTransport.log;
  consoleTransport.log = function(message: any) {
    try {
      originalConsoleLog.call(this, message);
    } catch (error: unknown) {
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== 'EPIPE' && code !== 'ERR_STREAM_WRITE_AFTER_END') {
        // Fall back to file-only logging for unexpected stream errors
        fileTransport.log(message);
      }
    }
  };
} catch (error) {
  // If console transport setup fails, disable it and continue with file logging only
  log.transports.console.level = false;
}

// Override console methods to use electron-log
console.log = log.log.bind(log);
console.info = log.info.bind(log);
console.warn = log.warn.bind(log);
console.error = log.error.bind(log);
console.debug = log.debug.bind(log);

// Install diagnostics capture hooks for main-process errors. Must run before
// any code that might crash so we don't miss early-startup failures.
// Uploader / report UI wiring is not built yet; today we only enqueue
// payloads and raise the in-app crash dialog.
function handleMainProcessError(err: unknown, source: string): void {
  try {
    const svc = getDiagnosticsService();
    const queue = getDiagnosticsQueue();
    const config = getDiagnosticsConfig();
    if (!svc || !queue) return;
    const payload = svc.captureMainError(err, source);
    if (!payload) return;
    const id = queue.enqueue(payload);
    if (config?.get().dontAskAgain) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('diagnostics:crash-detected', { id });
    }
  } catch (hookErr) {
    log.error('[diagnostics] error inside crash hook:', hookErr);
  }
}

process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err);
  handleMainProcessError(err, 'uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  log.error('[unhandledRejection]', reason);
  handleMainProcessError(reason, 'unhandledRejection');
});

// Disable sandbox in development and test modes to avoid SUID/shm permission issues.
// Gated on `!app.isPackaged` so a *packaged* build launched with NODE_ENV=test can
// never be tricked into dropping the sandbox - a real install always keeps it on.
if (!app.isPackaged) {
  app.commandLine.appendSwitch('no-sandbox');
  log.info('Running with --no-sandbox flag (development/test mode)');
}

// In test mode, disable /dev/shm usage so the renderer process doesn't FATAL-crash
// in environments where shared memory creation fails (e.g. certain CI/headless setups).
// Also gated on `!app.isPackaged` so it never applies to a real install.
if (!app.isPackaged && process.env.NODE_ENV === 'test') {
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  log.info('Running with --disable-dev-shm-usage flag (test mode)');
}

// Allow E2E tests to isolate user data per worker by pointing userData at a
// temp directory via the ELECTRON_USER_DATA env var. Must be called before
// app.whenReady() so all app.getPath('userData') calls use the right path.
if (process.env.ELECTRON_USER_DATA) {
  app.setPath('userData', process.env.ELECTRON_USER_DATA);
  log.info(`[test] userData path overridden to: ${process.env.ELECTRON_USER_DATA}`);
}

let mainWindow: BrowserWindow | null = null;
let menuBuilder: MenuBuilder | null = null;
/**
 * Remembers the main window's size/position/maximized state between launches,
 * and starts a fresh install maximized. Constructed lazily inside
 * `createWindow()` - its default file path reads `app.getPath('userData')`,
 * which must not be touched before the `ELECTRON_USER_DATA` override above.
 */
let windowStateService: WindowStateService | null = null;
let extensionHost: ExtensionHost | null = null;
let extensionBibleBridge: BibleBridge | null = null;

/**
 * Register window management IPC handlers
 */
function registerWindowHandlers(): void {
  // Detach pane to new window
  ipcMain.handle('window:detach-pane', async (_event, paneType: string, initialState: any) => {
    try {
      log.info(`[IPC] Detaching pane: ${paneType}`);

      const config = getPaneConfig(paneType as any);
      if (!config) {
        throw new Error(`Unknown pane type: ${paneType}`);
      }

      const windowId = windowManager.detachPane({
        paneType,
        title: config.titleFormat(initialState),
        width: config.defaultWidth,
        height: config.defaultHeight,
        initialState
      });

      log.info(`[IPC] Pane detached successfully: ${windowId}`);
      return { success: true, windowId };
    } catch (error) {
      log.error('[IPC] Error detaching pane:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Close detached window
  ipcMain.handle('window:close-detached', async (_event, windowId: string) => {
    try {
      log.info(`[IPC] Closing detached window: ${windowId}`);
      const success = windowManager.closeDetachedWindow(windowId);
      return { success };
    } catch (error) {
      log.error('[IPC] Error closing detached window:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get all detached windows
  ipcMain.handle('window:get-detached-windows', async () => {
    try {
      const windows = windowManager.getAllDetachedWindows().map(w => ({
        id: w.id,
        paneType: w.paneType,
        linkedToMain: w.linkedToMain
      }));
      return { success: true, windows };
    } catch (error) {
      log.error('[IPC] Error getting detached windows:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Broadcast verse change to every *other* window (for syncing)
  ipcMain.handle('window:broadcast-verse-change', async (event, verseId: number, moduleId?: string) => {
    try {
      log.info(`[IPC] Broadcasting verse change: ${verseId}`);
      const senderId = event.sender.id;
      windowManager.broadcastVerseChange(verseId, senderId);
      // The main window is a listener too, not just a sender. A Bible pane that
      // has been popped out is still the reader's Bible pane: without this,
      // clicking a verse in the detached window left the main window's
      // commentary, study and topics panes on whatever verse they had, and
      // opening a commentary there did nothing at all because no pane in that
      // window knew of a verse to load it for.
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id !== senderId) {
        mainWindow.webContents.send('verse-changed', verseId);
      }
      // Also fan the change out to any extension worker that subscribed via
      // `api.bible.onDidChangeActiveVerse`.
      extensionBibleBridge?.notifyActiveVerse(verseId, moduleId);
      return { success: true };
    } catch (error) {
      log.error('[IPC] Error broadcasting verse change:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

/** The webContents of the hidden window a note is rendered into. */
type NoteRenderContents = BrowserWindow['webContents'];

/** What both note-rendering channels reply with. Not the `Result<T>` envelope
 *  the `file-notes:*` handlers use - these two are registered here, beside the
 *  window plumbing they need, rather than through `ipcHandler`. */
interface NoteRenderResult {
  success: boolean;
  error?: string;
}

/**
 * Render a note's standalone HTML document in a hidden, locked-down
 * BrowserWindow and hand the loaded page to `use`.
 *
 * Printing and PDF export need byte-identical setup - the sanitized document,
 * the injected CSP, the temp file, the navigation lock-down - so it lives here
 * once and the two channels differ only in what they ask the loaded page for.
 * The window and the temp file are disposed on every path, including a load
 * failure and a throw out of `use`.
 */
async function renderNoteDocument<T>(
  html: string,
  use: (contents: NoteRenderContents) => Promise<T>
): Promise<T> {
  // `require` rather than a top-level import, matching the rest of this file's
  // lazily-loaded node builtins.
  const fs = require('fs');

  // Electron's loadURL() with data: URLs is capped (~2MB on some platforms);
  // user notes with embedded images easily exceed that, so we write to a
  // temp file and loadFile() instead. Don't "simplify" this back to a data URL.
  //
  // Defense-in-depth: the renderer already sanitizes the note body before
  // building this document, but we inject a restrictive CSP here too so a
  // sanitizer miss cannot load remote resources, run scripts, or phone home.
  const tempPath = join(
    tmpdir(),
    `bible-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
  );
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'">`;
  const hardenedHtml = html.includes('<head>')
    ? html.replace('<head>', `<head>${csp}`)
    : `<!DOCTYPE html><html><head>${csp}</head><body>${html}</body></html>`;
  fs.writeFileSync(tempPath, hardenedHtml, 'utf-8');

  const renderWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      javascript: false
    }
  });

  // This window renders one locally-written temp file and nothing else, so it
  // gets the strictest policy: no navigation, no child windows, no shell
  // hand-off.
  lockDownNavigation(renderWindow.webContents, 'print window');

  try {
    await new Promise<void>((resolve, reject) => {
      renderWindow.webContents.once('did-finish-load', () => resolve());
      renderWindow.webContents.once('did-fail-load', (_e, code, desc) => {
        reject(new Error(`Failed to load print content: ${desc} (${code})`));
      });
      renderWindow.loadFile(tempPath);
    });
    return await use(renderWindow.webContents);
  } finally {
    // Both disposals are unconditional: a print the user cancelled, a PDF that
    // failed to write and a page that never loaded all leave the same window
    // and the same temp file behind.
    if (!renderWindow.isDestroyed()) renderWindow.destroy();
    fs.rmSync(tempPath, { force: true });
  }
}

function describeRenderError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Register the two channels that render a note outside the editor: sending it
 * to the printer, and writing it out as a PDF. Both go through
 * {@link renderNoteDocument}, so a printed note and an exported one are the
 * same page.
 */
function registerPrintHandler(): void {
  ipcMain.handle('notes:print', async (_event, html: string): Promise<NoteRenderResult> => {
    return renderNoteDocument(
      html,
      contents =>
        new Promise<NoteRenderResult>(resolve => {
          contents.print({ silent: false }, (success, failureReason) => {
            resolve(
              success ? { success: true } : { success: false, error: failureReason || 'Print cancelled' }
            );
          });
        })
    ).catch(err => {
      log.error('[IPC] notes:print failed:', err);
      return { success: false, error: describeRenderError(err) };
    });
  });

  // PDF export. The renderer hands over exactly the document it would print,
  // and the save dialog comes first - mirroring `file-notes:export-markdown`,
  // and meaning a cancelled dialog costs no rendering at all. A cancel is
  // success: the user asked for nothing to happen, and nothing happened.
  ipcMain.handle(
    'notes:export-pdf',
    async (_event, html: string, defaultName: string): Promise<NoteRenderResult> => {
      const parent = BrowserWindow.getFocusedWindow();
      const options = {
        title: t('main.dialog.exportPdf'),
        defaultPath: `${defaultName}.pdf`,
        filters: [
          { name: t('main.filter.pdf'), extensions: ['pdf'] },
          { name: t('main.filter.allFiles'), extensions: ['*'] }
        ]
      };
      const saved = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options);
      if (saved.canceled || !saved.filePath) return { success: true };
      const filePath = saved.filePath;

      return renderNoteDocument(html, contents => contents.printToPDF({ printBackground: true }))
        .then(pdf => {
          const fs = require('fs');
          fs.writeFileSync(filePath, pdf);
          return { success: true };
        })
        .catch(err => {
          log.error('[IPC] notes:export-pdf failed:', err);
          return { success: false, error: describeRenderError(err) };
        });
    }
  );
}

async function createWindow(): Promise<void> {
  log.info('Creating main window...');

  // Restore the geometry the user left the app in. A first run - and any run
  // where the state file is missing, unreadable, or points at a monitor that is
  // no longer plugged in - lands on 1400x900, maximized. See
  // services/WindowStateService.ts.
  windowStateService = new WindowStateService();
  const windowState = windowStateService.read();
  log.info(
    `Restoring window geometry: ${windowState.width}x${windowState.height}` +
      `${windowState.x !== undefined ? ` at ${windowState.x},${windowState.y}` : ' (centred)'}` +
      `${windowState.isMaximized ? ', maximized' : ''}${windowState.isFullScreen ? ', full screen' : ''}`
  );

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    // Omitted rather than passed as undefined when there is no usable saved
    // position, so Electron applies its own centred placement.
    ...(windowState.x !== undefined && windowState.y !== undefined
      ? { x: windowState.x, y: windowState.y }
      : {}),
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
      // Renderer process sandbox is enabled. The preload script only imports
      // `electron` (contextBridge/ipcRenderer) and `electron-log/renderer`,
      // both of which are sandbox-compatible. better-sqlite3 and SQLCipher
      // run in the main process via IPC handlers, so the renderer never needs
      // direct native-module access.
      sandbox: true
    },
    title: APP_CONFIG.productName,
    icon: resolveAppIconPath(),
    backgroundColor: '#FFFFFF',
    show: false // Show when ready
  });

  // Block renderer-initiated navigation away from the app and deny child
  // windows (which would otherwise inherit the preload bridge). See
  // utils/windowSecurity.ts. Installed before the first load so nothing in the
  // initial page can slip past.
  applyWindowSecurity(mainWindow.webContents, 'main window');

  // Maximize (or go full screen) NOW, while the window is still hidden, and
  // start persisting every later geometry change. Doing it after `show()` would
  // paint the window small and then visibly snap it to full size.
  windowStateService.applyAndTrack(mainWindow, windowState);

  // Register IPC handlers (synchronous - handlers must be ready before UI loads)
  registerBibleHandlers(ipcMain);
  registerCommentaryHandlers(ipcMain);
  registerDictionaryHandlers(ipcMain);
  registerBookHandlers(ipcMain);
  registerSearchHandlers(ipcMain);
  // Registered synchronously; the promise it returns resolves when the
  // encrypted user DB is actually open, and every session handler awaits that
  // internally (see `sessionRepoReady` in sessionHandlers.ts). Deliberately not
  // awaited here: awaiting it put SQLCipher's key derivation in front of
  // `loadURL` below, so the renderer could not even start fetching its bundle
  // until the key had been derived.
  void registerSessionHandlers(ipcMain);
  registerNotesHandlers();
  registerCollectionHandlers();
  registerHighlightHandlers();
  registerModuleHandlers(ipcMain);
  registerFeaturePackHandlers(ipcMain);
  registerI18nHandlers(ipcMain);
  registerTopicalIndexHandlers(ipcMain);
  registerCrossReferenceHandlers(ipcMain);
  registerTagGraphHandlers(ipcMain);
  registerStudyHandlers(ipcMain);
  registerBackupHandlers();
  initializeFileNotesService();
  registerFileNotesHandlers();
  // Initialize the single network egress gateway + master offline switch
  // BEFORE anything that can reach the network (the diagnostics uploader
  // resolves the gateway singleton at construction time).
  initializeNetworkService();
  registerNetworkHandlers(ipcMain);
  // Manual "Check for Updates". Registered AFTER the network gateway
  // so the service can resolve the singleton; it only ever reaches the network
  // when the user clicks the menu item (no launch/timer entry point).
  registerUpdateHandlers(ipcMain);
  initializeDiagnosticsService();
  registerDiagnosticsHandlers(ipcMain);
  // Kick off the background uploader ONLY when diagnostics is explicitly
  // enabled (opt-IN). A stock build never contacts a diagnostics
  // endpoint without consent. It self-schedules its first tick a few seconds
  // after start so app boot isn't competing with an HTTP POST.
  if (getDiagnosticsConfig()?.get().enabled) {
    getDiagnosticsUploader()?.start();
  }

  // Register window management handlers
  registerWindowHandlers();

  // Register print handler
  registerPrintHandler();

  // The application menu is built by the renderer (which owns the command
  // registry, i18n catalogs, and keybinding service) and shipped to main via
  // the `menu:rebuild` IPC channel. Until the renderer dispatches its first
  // spec the window has no application menu, which Electron handles
  // gracefully on all platforms.
  menuBuilder = new MenuBuilder();

  // Register menu state update handlers
  ipcMain.on('menu:update-theme', (_event, themeId: string) => {
    menuBuilder?.updateTheme(themeId);
  });

  // App-level shell commands invoked by renderer command handlers (the menu
  // and command palette dispatch through the registry, which fires DOM
  // events; the React layer routes those to these IPCs when they need main
  // process capabilities like dialog/devtools/external links).
  ipcMain.handle('app:show-about', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: t('main.about.title', { productName: APP_CONFIG.productName }),
      message: APP_CONFIG.productName,
      detail: t('main.about.detail', { version: app.getVersion(), year: APP_CONFIG.copyrightYear }),
      buttons: [t('main.about.ok')]
    });
  });
  ipcMain.handle('app:toggle-dev-tools', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.toggleDevTools();
  });
  ipcMain.handle('app:zoom-in', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const z = mainWindow.webContents.getZoomLevel();
    mainWindow.webContents.setZoomLevel(z + 0.5);
  });
  ipcMain.handle('app:zoom-out', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const z = mainWindow.webContents.getZoomLevel();
    mainWindow.webContents.setZoomLevel(z - 0.5);
  });
  ipcMain.handle('app:actual-size', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.setZoomLevel(0);
  });
  // `app:open-external` is reachable from the renderer (it's in
  // ALLOWED_IPC_CHANNELS), so the URL is untrusted input: `shell.openExternal`
  // hands whatever it's given to the OS shell, which on Windows happily acts on
  // `file:`, `smb:` and other schemes. `openExternalUrl` validates the scheme
  // against the https/mailto allowlist and logs rejections. It resolves with a
  // result object rather than throwing so a rejected URL doesn't surface as an
  // unhandled rejection in the renderer.
  ipcMain.handle('app:open-external', async (_event, url: unknown) => {
    return openExternalUrl(url, 'app:open-external');
  });

  // Load the app
  if (process.env.ELECTRON_RENDERER_URL) {
    // Development mode
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // Production mode
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    log.info('Main window ready, showing...');
    // Belt and braces: some Linux window managers ignore `maximize()` on a
    // window that has never been mapped. Re-asserting it here is still before
    // `show()`, so it costs nothing visually when the first call did work.
    if (windowState.isMaximized && !windowState.isFullScreen && mainWindow && !mainWindow.isMaximized()) {
      mainWindow.maximize();
    }
    mainWindow?.show();

    // Open DevTools AFTER window shows (opening DevTools blocks rendering)
    if (process.env.NODE_ENV === 'development') {
      mainWindow?.webContents.openDevTools();
    }
  });

  // Save session before closing.
  // isClosing prevents re-entrance: preventDefault() keeps the window alive,
  // so without this flag the 'close' event would fire again from destroy().
  let isClosing = false;
  mainWindow.on('close', async (event) => {
    if (isClosing) return;

    event.preventDefault();
    isClosing = true;

    try {
      log.info('Saving session before close...');

      // Ask the renderer to serialize its Zustand state to the session DB.
      // Uses ipcMain.once (not handle) because the renderer fires back an
      // event rather than returning a response - this avoids needing the
      // renderer to await the main process during teardown.
      mainWindow?.webContents.send('session:save-requested');

      // Hard timeout ensures the app closes even if the renderer is frozen
      // or has already been garbage-collected during shutdown. See
      // SESSION_SAVE_SHUTDOWN_TIMEOUT_MS in config/constants.ts.
      const result = await new Promise<{ success: boolean; message?: string }>((resolve) => {
        const timeout = setTimeout(
          () => resolve({ success: false, message: 'Timeout' }),
          SESSION_SAVE_SHUTDOWN_TIMEOUT_MS
        );
        ipcMain.once('session:save-result', (_event, data) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      if (result?.success) {
        log.info('Session saved successfully before close');
      } else {
        log.warn('Failed to save session before close:', result?.message);
      }
    } catch (error) {
      log.error('Error saving session before close:', error);
    } finally {
      isClosing = false;
      mainWindow?.destroy();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    menuBuilder = null;
    windowStateService = null;
  });
}

/**
 * Boot the ExtensionHost. Discovers extensions installed under
 * data/extensions/, validates their manifests, and populates the registry.
 * Worker spawn / activation is wired up separately - this just makes the
 * host available so the renderer can list extensions.
 */
async function initializeExtensionHostInBackground(): Promise<void> {
  try {
    log.info('[Background] Booting ExtensionHost...');
    const userDb = await getSharedUserDb();
    const extensionsRoot = join(getDataPath(), 'extensions');

    // Production BibleBridge wired against the existing shared module
    // loaders. The bridge is constructed before the host so
    // we can hand it in via the `bibleBridge` option and keep a reference
    // for the active-verse fan-out below.
    const bibleBridge = new BibleBridge({
      getBibleRepository,
      listBibleModules: () =>
        getSharedModuleMetadataRepo()
          .getByType('bible')
          .map((m) => ({
            moduleId: m.moduleId !== undefined ? String(m.moduleId) : (m.abbreviation || m.getAbbreviation()),
            abbreviation: m.abbreviation || m.getAbbreviation(),
            moduleName: m.moduleName,
            languageCode: m.languageCode,
            version: m.version,
          })),
      listAllBooks: () => getSharedBookRepo().getAll(),
      getDefaultModuleAbbreviation: () => {
        const bibles = getSharedModuleMetadataRepo().getByType('bible');
        const first = bibles[0];
        if (!first) return null;
        return first.abbreviation || first.getAbbreviation() || null;
      },
      sendNavigateToVerse: (verseId: number) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension:navigate-to-verse', verseId);
        }
      },
    });
    extensionBibleBridge = bibleBridge;

    // Production module bridges for commentary, dictionary, and book
    // modules. Each bridge resolves repos lazily through the existing
    // module loader getters from `<type>Handlers.ts`.
    const commentaryBridge = new CommentaryBridge({
      getCommentaryRepository,
      listCommentaryModules: () =>
        getSharedModuleMetadataRepo()
          .getByType('commentary')
          .map((m) => ({
            moduleId: m.moduleId !== undefined ? String(m.moduleId) : (m.abbreviation || m.getAbbreviation()),
            abbreviation: m.abbreviation || m.getAbbreviation(),
            moduleName: m.moduleName,
            languageCode: m.languageCode,
            version: m.version,
          })),
    });
    const dictionaryBridge = new DictionaryBridge({
      getDictionaryRepository,
      listDictionaryModules: () =>
        getSharedModuleMetadataRepo()
          .getByType('dictionary')
          .map((m) => ({
            moduleId: m.moduleId !== undefined ? String(m.moduleId) : (m.abbreviation || m.getAbbreviation()),
            abbreviation: m.abbreviation || m.getAbbreviation(),
            moduleName: m.moduleName,
            languageCode: m.languageCode,
            version: m.version,
          })),
    });
    const bookBridge = new BookBridge({
      getBookRepository,
      listBookModules: () =>
        getSharedModuleMetadataRepo()
          .getByType('book')
          .map((m) => ({
            moduleId: m.moduleId !== undefined ? String(m.moduleId) : (m.abbreviation || m.getAbbreviation()),
            abbreviation: m.abbreviation || m.getAbbreviation(),
            moduleName: m.moduleName,
            languageCode: m.languageCode,
            version: m.version,
          })),
    });

    // Production renderer-backed bridges. Each one talks
    // to the renderer's services (CommandRegistry, WhenContextService,
    // notification stack, useLayoutStore, I18nService) over a small IPC
    // protocol owned by `extensions/bridges/RendererBridgeRpc.ts`. The
    // renderer side of the protocol lives in
    // `src/ui/extensions/extensionRendererBridge.ts`.
    const getMainWindow = (): BrowserWindow | null => mainWindow;
    const commandBridge = new RendererCommandBridge(getMainWindow);
    const contextBridge = new RendererContextBridge(getMainWindow);
    const uiBridge = new RendererUiBridge(getMainWindow);
    const workspaceBridge = new RendererWorkspaceBridge(getMainWindow);
    const l10nBridge = new RendererL10nBridge(getMainWindow);

    // Secrets tier (safeStorage-backed per-extension files) + per-extension
    // SQLite database registry. Both adapters are owned by
    // the host across the process lifetime so files persist across
    // activate/deactivate cycles.
    const secretsKeychain = new SafeStorageSecretsKeychain();
    const extensionDatabaseRegistry = new ExtensionDatabaseRegistry({
      extensionsRoot,
      factory: {
        // Hardened open (trusted_schema off, query_only on read-only
        // handles). Statement-level admission control lives in
        // `ExtensionSqlGuard.assertExtensionSqlAllowed`, applied by the
        // registry itself.
        open: (filePath, dbOpts) =>
          openHardenedExtensionDatabase(filePath, { readonly: dbOpts.readonly }),
      },
    });

    // Outbound HTTP. One gateway per extension, each on its own `Session`
    // partition so cookies, cache, and HTTP auth cannot bleed
    // across extensions or in from the user's browsing profile.
    //
    // This stayed deliberately unwired while extensions ran as full Node.js:
    // there was no sandbox, so there was no safe egress to enable. The
    // QuickJS realm removed that reason. Every defense the pipeline needs is
    // already in `NetworkApiImpl` (manifest host allowlist, DNS-resolve +
    // private-IP rejection, per-hop redirect re-validation, cross-origin
    // credential stripping, request + bandwidth throttles) and the gateway
    // routes through the app-wide `NetworkGateway`, so the master offline
    // switch turns extension egress off with everything else.
    //
    // The namespace is still attached only for extensions that both declare
    // and were granted `network`; see `attachApiImpls`.
    const extensionSessionFactory = defaultExtensionSessionFactory();
    const networkGatewayFactory = (extensionId: string): ElectronNetworkGateway =>
      new ElectronNetworkGateway({ extensionId, sessionFactory: extensionSessionFactory });

    // Marketplace. Both services are inert on a build with no
    // catalog or blocklist URL configured (the shipped state today): the
    // catalog lists only sources the user added, and the blocklist blocks
    // nothing. Wiring them now costs nothing and means the seam is exercised.
    const blocklist = new ExtensionBlocklistService({ db: userDb });
    const catalogService = new ExtensionCatalogService({ db: userDb });

    extensionHost = new ExtensionHost({
      blocklist,
      db: userDb,
      extensionsRoot,
      workerFactory: electronUtilityProcessFactory,
      networkGatewayFactory,
      consentPrompter: createRendererConsentPrompter(getMainWindow),
      // Developer Mode is off until the user turns it on; passing the config is
      // what makes the toggle exist at all.
      devConfig: new ExtensionDevConfig(),
      bibleBridge,
      commentaryBridge,
      dictionaryBridge,
      bookBridge,
      commandBridge,
      contextBridge,
      uiBridge,
      workspaceBridge,
      l10nBridge,
      secretsKeychain,
      extensionDatabaseRegistry,
    });
    await extensionHost.loadAll();
    // Wire the `ext-ui://` file handler now that the host can resolve
    // extension IDs to install paths.
    try {
      registerExtUiProtocol(extensionHost);
    } catch (err) {
      log.error('[Background] Failed to register ext-ui:// protocol handler:', err);
    }
    // Register the renderer-facing extensions IPC surface
    // and fire startup activation events so any extension that opted in via
    // `activationEvents: ['onStartup', '*']` actually starts running.
    registerExtensionHandlers(extensionHost, { uiBridge });
    registerMarketplaceHandlers({ host: extensionHost, catalogService, blocklist });
    // The blocklist's only fetch trigger: the manual "Check for Updates" flow.
    // Never a timer, never startup - see `updateHandlers.setBlocklistRefresher`.
    setBlocklistRefresher(() => blocklist.refresh());
    try {
      await extensionHost.fireActivationEvent('onStartup');
      await extensionHost.fireActivationEvent('*');
    } catch (err) {
      log.warn('[Background] fireActivationEvent(onStartup) failed:', err);
    }
    const installed = await extensionHost.listExtensions();
    log.info(`[Background] ExtensionHost ready (${installed.length} extension(s))`);
  } catch (error) {
    log.error('[Background] ExtensionHost failed to boot:', error);
  }
}

/**
 * Initialize user content databases in background after window is shown.
 * Notes and highlights can load after Bible text appears.
 */
async function initializeUserContentInBackground(): Promise<void> {
  log.info('[Background] Starting user content initialization...');
  const startTime = Date.now();

  try {
    // Initialize notes and highlights in parallel (session is already initialized)
    await Promise.all([
      initializeNotesDatabase().then(() => {
        log.info('[Background] Notes database initialized');
      }),
      initializeHighlightRepository().then(() => {
        log.info('[Background] Highlight repository initialized');
      })
    ]);

    const elapsed = Date.now() - startTime;
    log.info(`[Background] User content initialized in ${elapsed}ms`);

    // Notify renderer that user data is ready
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('user-data-ready');
    }
  } catch (error) {
    log.error('[Background] Error initializing user content:', error);
  }
}

// Register the `ext-ui://` custom scheme as privileged BEFORE app.whenReady().
// The actual file handler is wired further down once `extensionHost` exists.
registerExtUiSchemePrivileged();

// App lifecycle
app.whenReady().then(async () => {
  log.info('Application starting...');

  // Read the locale catalogs before anything builds a window title, a menu
  // or a native dialog. Cheap: a handful of small JSON files, read once.
  loadMainCatalogs();
  log.info(`Log file location: ${log.transports.file.getFile().path}`);

  // Initialize main database schema before anything else
  // All handlers and module detector use this path for main.db
  const mainDbPath = resolveMainDbPath();
  const mainDbInit = initializeMainDatabase(mainDbPath, getBundledMainDbPath());
  mainDbInit.close(); // Close init connection; handlers open their own
  log.info('Main database schema initialized at:', mainDbPath);

  // Register the menu:rebuild IPC handler. The renderer pushes a fresh
  // MenuSpec at boot and on locale/keybinding changes; the handler hands it
  // off to whichever MenuBuilder is currently active.
  registerMenuRebuildHandler(() => menuBuilder);

  // Create window first so the user sees the UI shell immediately;
  // background tasks (module detection, notes DB) load after the window appears.
  await createWindow();

  // Initialize user content in background (notes, highlights)
  // Session is already initialized in createWindow, but notes/highlights can load after
  initializeUserContentInBackground();

  // Boot the extension host in the background - it depends on the user DB
  // (initialized above) but is not on the critical path for showing the UI.
  initializeExtensionHostInBackground();

  // Detect and register modules in background (non-blocking)
  setImmediate(() => {
    try {
      const result = detectAndRegisterModules();
      log.info(`Module detection result: ${result.detected} detected, ${result.registered} new, ${result.updated} updated`);
      if (result.errors.length > 0) {
        log.warn(`Module detection had ${result.errors.length} errors`);
      }
    } catch (error) {
      log.error('Failed to detect modules:', error);
    }

    // Warm the study-overview cache in the background. Started only after
    // module detection, since the cache is keyed by the installed module set;
    // it then waits a further minute before computing anything, so it cannot
    // contribute to startup cost. Purely optional work - see StudyCacheSweeper.
    try {
      startStudyCacheSweep();
    } catch (error) {
      log.error('Failed to start the study cache sweep:', error);
    }
  });

  app.on('activate', async () => {
    // macOS: Re-create window when dock icon clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // macOS: Keep app running when windows closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Close every cached module DB connection before Electron tears the process
// down. `will-quit` fires after all windows are closed but before the native
// Electron shutdown begins, giving us a clean point to release sqlite handles.
// Individual handler `closeXxxDbs()` calls below still run on `quit` for
// belt-and-braces parity with pre-registry behavior; they're idempotent because
// the registry's `closeAll()` already closed the underlying providers.
app.on('will-quit', () => {
  try {
    log.info('[will-quit] Closing all module databases via registry...');
    getModuleDatabaseRegistry().closeAll();
  } catch (error) {
    log.error('[will-quit] Error closing module database registry:', error);
  }
});

// Clean up on quit
app.on('quit', () => {
  log.info('Application shutting down...');

  // Stop the diagnostics uploader timer so it doesn't fire during teardown
  // and attempt to touch a torn-down `net` module.
  getDiagnosticsUploader()?.stop();

  // Close all detached windows
  windowManager.closeAllDetachedWindows();

  // Clean up handler-level repositories (module DBs only)
  closeBibleDb();
  closeCommentaryDbs();
  closeDictionaryDbs();
  closeBookDbs();
  closeTopicalDbs();
  closeXrefDbs();
  stopStudyCacheSweep();
  closeStudyCache();
  closeTagGraphDb();
  closeSearchDb();
  closeSessionDb();
  closeNotesDatabase();
  closeCollectionService();
  closeHighlightRepository();
  closeModuleManager();
  closeFeaturePackHandlers();

  // Close shared DB connections (main.db + encrypted user DB)
  closeSharedUserDb();
  closeSharedMainDb();
  log.info('Database connections closed');
});
