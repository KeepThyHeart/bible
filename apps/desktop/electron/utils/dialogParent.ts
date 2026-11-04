/**
 * The window a native confirmation should be parented to (B-087). An unparented message box is a separate
 * top-level window with no taskbar entry on Linux: clicking the main window puts it behind and the user is left
 * with an app that seems frozen. Returns `undefined` (an unparented box, the old behaviour) when no window is
 * available, e.g. in tests.
 */
import { BrowserWindow } from 'electron';

export function dialogParent(): BrowserWindow | undefined {
  try {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    return win && !win.isDestroyed() ? win : undefined;
  } catch {
    return undefined;
  }
}
