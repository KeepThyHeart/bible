/**
 * Search re-index progress over IPC (task 0197).
 *
 * `ipcRenderer.invoke` structured-clones its arguments, and a function is not cloneable, so passing
 * the renderer's `onProgress` callback as an argument threw "An object could not be cloned" and made
 * every Re-index fail before reaching the main process. Progress now travels the way Electron intends:
 * the renderer subscribes to a push channel, invokes with plain data only, and the main process
 * broadcasts `IndexProgress` messages while it works.
 *
 * Licence: GPL-3.0-or-later.
 */

export const INDEX_PROGRESS_CHANNEL = 'search:index-progress';

export interface IndexProgress {
  module: string;
  current: number;
  total: number;
  bookName: string;
}

/** The slice of `ipcRenderer` the bridge needs (injectable for tests). */
export interface ProgressIpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: IndexProgress) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, payload: IndexProgress) => void): unknown;
}

/**
 * Invoke `search:buildIndex` with plain-data arguments only, relaying pushed progress to `onProgress`.
 */
export async function invokeBuildIndex<T = unknown>(
  ipc: ProgressIpcRenderer,
  modules: string[],
  onProgress?: (progress: IndexProgress) => void
): Promise<T> {
  const listener = (_event: unknown, payload: IndexProgress): void => {
    onProgress?.(payload);
  };
  if (onProgress) ipc.on(INDEX_PROGRESS_CHANNEL, listener);
  try {
    return (await ipc.invoke('search:buildIndex', modules)) as T;
  } finally {
    if (onProgress) ipc.removeListener(INDEX_PROGRESS_CHANNEL, listener);
  }
}
