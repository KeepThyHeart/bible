import { IpcKnownError, type IpcError, type Result } from '../ipc/result';
import type { MainModuleDeps, ModuleIpc } from './FeatureMainModule';

/** The slice of `ipcMain` used here. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
}

export const MODULE_CHANNEL_PREFIX = 'module:';
export const IDENT_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function moduleChannel(id: string, method: string): string {
  return `${MODULE_CHANNEL_PREFIX}${id}:${method}`;
}

export function moduleEventChannel(id: string, name: string): string {
  return `${MODULE_CHANNEL_PREFIX}${id}:event:${name}`;
}

function classify(id: string, method: string, err: unknown, deps: MainModuleDeps): IpcError {
  if (err instanceof IpcKnownError) {
    deps.log.warn(`[module:${id}:${method}] ${err.code}: ${err.message}`);
    return { code: err.code, message: err.message };
  }
  deps.log.error(`[module:${id}:${method}] internal error:`, err);
  return { code: 'internal', message: err instanceof Error ? err.message : String(err) };
}

export function createModuleIpc(id: string, ipcMain: IpcMainLike, deps: MainModuleDeps): ModuleIpc {
  const registered = new Set<string>();
  let disposed = false;
  const check = (what: string, value: string) => {
    if (!IDENT_RE.test(value)) throw new Error(`module ${id}: bad ${what} "${value}"`);
  };
  check('module id', id);
  return {
    id,
    handle(method, fn) {
      if (disposed) throw new Error(`module ${id}: ipc already disposed`);
      check('method', method);
      const channel = moduleChannel(id, method);
      if (registered.has(channel)) throw new Error(`module ${id}: duplicate handler "${method}"`);
      ipcMain.handle(channel, async (_event, ...args): Promise<Result<any>> => {
        try {
          return { ok: true, value: await fn(...(args as any)) };
        } catch (err) {
          return { ok: false, error: classify(id, method, err, deps) };
        }
      });
      registered.add(channel);
    },
    send(name, ...args) {
      check('event', name);
      const channel = moduleEventChannel(id, name);
      for (const w of deps.getWindows()) {
        if (!w.isDestroyed()) w.webContents.send(channel, ...args);
      }
    },
    channels: () => [...registered],
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const channel of registered) ipcMain.removeHandler(channel);
      registered.clear();
    },
  };
}
