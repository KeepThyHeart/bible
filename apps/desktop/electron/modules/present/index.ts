/**
 * Main-process half of the Presenter feature module (task 0198).
 *
 * The desktop pane (renderer) is the controller; `PresenterServer` serves a page that follows it
 * from a localhost address, so it can be opened in a browser, in a second window, or (LAN mode,
 * off by default) on another device. Channels are `module:present:<method>` (see
 * `FeatureMainModule`); the renderer side is `src/ui/modules/present/`.
 *
 * Nothing runs until the controller presses Start, and everything is torn down on Stop and when
 * the app quits (`close`).
 */
import { BrowserWindow, screen, shell } from 'electron';
import { networkInterfaces } from 'node:os';
import { VerseIdHelper } from '@bible/core';
import { IpcKnownError } from '../../ipc/result';
import { ensureBibleRepository } from '../../ipc/bibleHandlers';
import { getSharedBookRepo } from '../../services/sharedMainDb';
import { lockDownNavigation } from '../../utils/windowSecurity';
import { qrSvg } from '../../../../web/src/modules/present/lib/qr';
import type { FeatureMainModule, ModuleIpc } from '../FeatureMainModule';
import { PresentController, type PresentScripture } from './controller';
import type { PresentApi, PresentDisplay, PresentEvents, PresentPassageRequest, PresentVerse } from './types';

/** IPv4 addresses of this machine on the local network (not loopback, not link-local). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return out;
}

const scripture: PresentScripture = {
  async getChapter(module, book, chapter): Promise<PresentVerse[]> {
    const repo = await ensureBibleRepository(module);
    if (!repo) throw new IpcKnownError('not_found', `Bible not found: ${module}`);
    return repo.getChapter(book, chapter).map((v) => ({ verse: VerseIdHelper.parse(v.verseId).verse, text: v.text }));
  },
  getBook(book) {
    const row = getSharedBookRepo().getByBookNumber(book);
    return row ? { name: row.bookName, chapterCount: row.chapterCount } : null;
  },
};

let screenWindow: BrowserWindow | null = null;

function closeScreenWindow(): void {
  if (screenWindow && !screenWindow.isDestroyed()) screenWindow.close();
}

function openScreenWindow(url: string, parent?: BrowserWindow): void {
  if (screenWindow && !screenWindow.isDestroyed()) {
    screenWindow.close();
  }
  // Prefer a second display (the projector); otherwise a normal window beside the app.
  const primary = screen.getPrimaryDisplay();
  const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
  const area = (other ?? primary).workArea;
  const win = new BrowserWindow({
    x: other ? area.x + 40 : undefined,
    y: other ? area.y + 40 : undefined,
    width: other ? Math.min(area.width - 80, 1280) : 960,
    height: other ? Math.min(area.height - 80, 720) : 600,
    title: 'Presentation',
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    // A plain web page: no preload, no Node, sandboxed; it must never reach the app's IPC.
    // Own non-persistent session; a child of the app window so closing the app closes it too.
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'present-screen' },
    ...(parent ? { parent } : {}),
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  lockDownNavigation(win.webContents, 'present-screen');
  win.removeMenu();
  void win.loadURL(url);
  win.on('closed', () => {
    if (screenWindow === win) screenWindow = null;
  });
  screenWindow = win;
}

const presentModule: FeatureMainModule = {
  id: 'present',
  registerIpc(ipc: ModuleIpc, deps) {
    const mainWindow = (): BrowserWindow | undefined => deps.getWindows().find((w): w is BrowserWindow => w instanceof BrowserWindow && !w.isDestroyed());
    let watching: BrowserWindow | undefined;
    const controller = new PresentController(
      { scripture, lanAddresses, qr: (url) => qrSvg(url, { title: 'QR code for the presenter address' }) },
      (status) => ipc.send('changed' satisfies keyof PresentEvents, status),
    );
    const handle = <A extends unknown[], T>(method: keyof PresentApi, fn: (...a: A) => T | Promise<T>): void =>
      ipc.handle(method, fn);

    handle('status', () => controller.status());
    handle('start', async (options?: { lan?: boolean }) => {
      const before = controller.localUrl();
      const status = await controller.start({ lan: options?.lan === true });
      // Closing the app window ends the presentation (no orphaned listener).
      const main = mainWindow();
      if (main && main !== watching) {
        watching = main;
        main.once('closed', () => {
          watching = undefined;
          closeScreenWindow();
          void controller.stop();
        });
      }
      // The address changed (local <-> LAN): bring an open screen window along.
      if (before && status.server && status.server.url !== before && screenWindow && !screenWindow.isDestroyed()) {
        void screenWindow.loadURL(status.server.url);
      }
      return status;
    });
    handle('stop', async () => {
      closeScreenWindow();
      return controller.stop();
    });
    handle('setPassage', (request: PresentPassageRequest) => controller.setPassage(request));
    handle('step', (delta: number) => controller.step(delta));
    handle('focusVerse', (verse: number) => controller.focusVerse(verse));
    handle('setDisplay', (patch: Partial<PresentDisplay>) => controller.setDisplay(patch));
    handle('openInBrowser', async () => {
      const url = controller.localUrl();
      if (!url) throw new IpcKnownError('unavailable', 'The presenter is not running');
      // Our own loopback address, built here: never a renderer-supplied URL. Loopback is not
      // egress, so the "web requests" master switch (openExternalUrl) does not apply.
      await shell.openExternal(url);
    });
    handle('openInWindow', () => {
      const url = controller.localUrl();
      if (!url) throw new IpcKnownError('unavailable', 'The presenter is not running');
      openScreenWindow(url, mainWindow());
    });

    return {
      dispose() {
        closeScreenWindow();
        void controller.stop();
      },
    };
  },
};

export default presentModule;
