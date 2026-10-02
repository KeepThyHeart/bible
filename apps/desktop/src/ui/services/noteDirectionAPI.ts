/**
 * Renderer side of per-note default text direction (task 0076); the data is in
 * the user database (`electron/ipc/noteDirectionHandlers.ts`). `null` means
 * "Default": follow the UI language direction.
 */
import { unwrap, type Result } from './ipcResult';

export type NoteDirectionChoice = 'ltr' | 'rtl' | null;

type Invoke = (channel: 'note-direction:get' | 'note-direction:set', ...args: unknown[]) => Promise<Result<unknown>>;

const defaultInvoke: Invoke = (channel, ...args) =>
  window.electron.ipcRenderer.invoke<Result<unknown>>(channel, ...args);

export class NoteDirectionAPI {
  constructor(private readonly invoke: Invoke = defaultInvoke) {}

  get(notePath: string): Promise<NoteDirectionChoice> {
    return unwrap(this.invoke('note-direction:get', notePath) as Promise<Result<NoteDirectionChoice>>);
  }

  async set(notePath: string, direction: NoteDirectionChoice): Promise<void> {
    await unwrap(this.invoke('note-direction:set', notePath, direction));
  }
}

export const noteDirectionAPI = new NoteDirectionAPI();
