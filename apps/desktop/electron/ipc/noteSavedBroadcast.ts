import { BrowserWindow } from 'electron';

/** Pushed to every window except the saver after a note is written. */
export interface NoteSavedEvent {
  /** Resolved absolute path of the saved note (the key windows compare). */
  absolutePath: string;
  /** The `updated` timestamp the main process wrote. */
  updated: string;
  /** `webContents.id` of the window that saved. */
  senderId: number;
}

export const NOTE_SAVED_CHANNEL = 'file-notes:note-saved';

/** Send the event to every live window except the one that saved (no echo, no false conflict). */
export function broadcastNoteSaved(event: NoteSavedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (win.webContents.id === event.senderId) continue;
    win.webContents.send(NOTE_SAVED_CHANNEL, event);
  }
}
