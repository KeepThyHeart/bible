import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { join } from 'path';
import { getPaneConfig } from '../config/paneConfig';
import { applyWindowSecurity } from '../utils/windowSecurity';

/**
 * Configuration for detaching a pane
 */
export interface DetachConfig {
  paneType: string;
  title: string;
  width?: number;
  height?: number;
  initialState: any;
}

/**
 * Detached window information
 */
export interface DetachedWindowInfo {
  id: string;
  paneType: string;
  browserWindow: BrowserWindow;
  linkedToMain: boolean;
  currentState: any;
}

/**
 * WindowManager - Manages detached pane windows
 *
 * This is a generic service that works for ANY pane type (Bible, Commentary, Dictionary, etc.)
 * Each detached window renders the same React components as the main window.
 */
export class WindowManager {
  private detachedWindows: Map<string, DetachedWindowInfo> = new Map();
  private windowIdCounter: number = 1;

  /**
   * Detach a pane to a new window (generic - works for any pane type)
   *
   * @param config Configuration for the detached window
   * @returns Window ID
   */
  detachPane(config: DetachConfig): string {
    const windowId = `detached-${this.windowIdCounter++}`;

    log.info(`[WindowManager] Detaching pane: ${config.paneType}, windowId: ${windowId}`);

    // Create new BrowserWindow
    const window = new BrowserWindow({
      width: config.width || 900,
      height: config.height || 700,
      title: config.title,
      autoHideMenuBar: true, // Hide menu bar in detached windows for cleaner UI
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // Detached windows load the same renderer bundle as the main window
        // (detached.html -> src/ui/detached.tsx) and use the same preload, so
        // they get the same sandbox setting main.ts uses. All SQLite access
        // happens in the main process behind IPC handlers; the renderer never
        // touches better-sqlite3 or any other native module directly.
        sandbox: true
      },
      backgroundColor: '#FFFFFF',
      show: false // Show when ready
    });

    // Remove the menu bar completely (more cross-platform than autoHideMenuBar alone)
    window.setMenu(null);

    // Keep the title we computed from `paneConfig.titleFormat`.
    //
    // `detached.html` carries its own <title>, and Electron applies a loaded
    // page's title to the window - which silently overwrote the pane-specific
    // title with the generic "Detached Pane - ..." for every popped-out window.
    // Cancelling the BrowserWindow's own 'page-title-updated' (the webContents
    // event of the same name does not gate the native title) leaves the
    // constructor's `title` in place.
    window.on('page-title-updated', (event) => {
      event.preventDefault();
    });

    // Same navigation/window-open policy as the main window - a detached pane
    // renders the same untrusted study content and carries the same preload.
    applyWindowSecurity(window.webContents, `detached window ${windowId}`);

    // Load detached window HTML
    if (process.env.ELECTRON_RENDERER_URL) {
      // Development mode - use Vite dev server with query params
      window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/detached.html?type=${config.paneType}&id=${windowId}`);
    } else {
      // Production mode - load from file
      window.loadFile(join(__dirname, '../renderer/detached.html'), {
        query: {
          type: config.paneType,
          id: windowId
        }
      });
    }

    // Get component name from pane config (computed once)
    const paneConfig = getPaneConfig(config.paneType as any);
    const componentName = paneConfig?.component || 'BiblePane';
    const initPayload = {
      paneType: config.paneType,
      windowId: windowId,
      componentName: componentName,
      state: config.initialState
    };

    // Show window when ready AND send initialization data.
    // 'ready-to-show' fires after the first paint, which means React has mounted
    // and the 'onInitializePane' listener (registered in useEffect) is in place.
    // Using 'did-finish-load' was too early - the IPC arrived before React mounted.
    window.once('ready-to-show', () => {
      log.info(`[WindowManager] Showing detached window: ${windowId}`);
      window.show();
      log.info(`[WindowManager] Sending initial state for ${config.paneType}`);
      window.webContents.send('initialize-pane', initPayload);
    });

    // Handle window close
    window.on('closed', () => {
      log.info(`[WindowManager] Detached window closed: ${windowId}`);
      this.detachedWindows.delete(windowId);
    });

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
      window.webContents.openDevTools();
    }

    // Store window info
    const windowInfo: DetachedWindowInfo = {
      id: windowId,
      paneType: config.paneType,
      browserWindow: window,
      linkedToMain: true, // Default to linked
      currentState: config.initialState
    };

    this.detachedWindows.set(windowId, windowInfo);

    return windowId;
  }

  /**
   * Close a detached window
   *
   * @param windowId ID of the window to close
   * @returns true if window was found and closed
   */
  closeDetachedWindow(windowId: string): boolean {
    const windowInfo = this.detachedWindows.get(windowId);

    if (!windowInfo) {
      log.warn(`[WindowManager] Cannot close window ${windowId}: not found`);
      return false;
    }

    log.info(`[WindowManager] Closing detached window: ${windowId}`);

    try {
      windowInfo.browserWindow.close();
      this.detachedWindows.delete(windowId);
      return true;
    } catch (error) {
      log.error(`[WindowManager] Error closing window ${windowId}:`, error);
      return false;
    }
  }

  /**
   * Get all detached windows
   */
  getAllDetachedWindows(): DetachedWindowInfo[] {
    return Array.from(this.detachedWindows.values());
  }

  /**
   * Get detached windows by pane type
   */
  getDetachedWindowsByType(paneType: string): DetachedWindowInfo[] {
    return Array.from(this.detachedWindows.values()).filter(
      w => w.paneType === paneType
    );
  }

  /**
   * Get a specific detached window
   */
  getDetachedWindow(windowId: string): DetachedWindowInfo | undefined {
    return this.detachedWindows.get(windowId);
  }

  /**
   * Toggle link state for a detached window
   */
  toggleLink(windowId: string): boolean {
    const windowInfo = this.detachedWindows.get(windowId);

    if (!windowInfo) {
      return false;
    }

    windowInfo.linkedToMain = !windowInfo.linkedToMain;
    log.info(`[WindowManager] Window ${windowId} link toggled to: ${windowInfo.linkedToMain}`);

    return windowInfo.linkedToMain;
  }

  /**
   * Update state for a detached window
   */
  updateWindowState(windowId: string, state: any): void {
    const windowInfo = this.detachedWindows.get(windowId);

    if (windowInfo) {
      windowInfo.currentState = state;
    }
  }

  /**
   * Close all detached windows
   */
  closeAllDetachedWindows(): void {
    log.info(`[WindowManager] Closing all ${this.detachedWindows.size} detached windows`);

    const windowIds = Array.from(this.detachedWindows.keys());
    windowIds.forEach(id => this.closeDetachedWindow(id));
  }

  /**
   * Get count of detached windows
   */
  getDetachedWindowCount(): number {
    return this.detachedWindows.size;
  }

  /**
   * Broadcast verse change to all linked detached windows
   * Used to sync commentary/notes panes with Bible navigation
   *
   * `excludeWebContentsId` is the sender's, so a window never hears its own
   * navigation back. It matters now that the traffic runs both ways: a
   * *detached* Bible window broadcasts too, and main.ts forwards these to the
   * main window as well, so the commentary/study/topics panes there follow a
   * Bible pane that has been popped out.
   */
  broadcastVerseChange(verseId: number, excludeWebContentsId?: number): void {
    log.info(`[WindowManager] Broadcasting verse change: ${verseId}`);

    this.detachedWindows.forEach((windowInfo) => {
      // Only send to linked windows (not unlinked/browse mode windows)
      const isSender = excludeWebContentsId !== undefined
        && windowInfo.browserWindow.webContents.id === excludeWebContentsId;
      if (windowInfo.linkedToMain && !windowInfo.browserWindow.isDestroyed() && !isSender) {
        log.info(`[WindowManager] Sending verse change to window: ${windowInfo.id}`);
        windowInfo.browserWindow.webContents.send('verse-changed', verseId);
      }
    });
  }
}

// Singleton instance
export const windowManager = new WindowManager();
