/**
 * Production `IUtilityProcessFactory` backed by Electron's `utilityProcess`.
 *
 * One `utilityProcess.fork()` per active extension, each a separate V8
 * isolate. Wraps Electron's API in the wrapper-friendly
 * `IUtilityProcessHandle` shape so `ExtensionWorkerProcess` doesn't import
 * anything from `electron` directly. That means `ExtensionWorkerProcess.ts`
 * is unit-testable under vitest's plain Node, and only this file pulls in
 * the runtime electron dependency.
 */

import type {
  IUtilityProcessFactory,
  IUtilityProcessHandle,
  WorkerEventListener,
  WorkerEventName,
} from './ExtensionWorkerProcess';

/**
 * Lazy import so vitest doesn't try to resolve `electron` when running
 * unit tests against the wrapper. Production callers (electron/main.ts)
 * always have it.
 */
function loadElectron(): typeof import('electron') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('electron') as typeof import('electron');
}

export const electronUtilityProcessFactory: IUtilityProcessFactory = {
  fork({ scriptPath, args, execArgv, serviceName }) {
    const electron = loadElectron();
    const child = electron.utilityProcess.fork(scriptPath, args, {
      execArgv,
      serviceName,
      stdio: 'pipe',
    });

    const handle: IUtilityProcessHandle = {
      get pid() {
        return child.pid;
      },
      postMessage(msg: unknown) {
        child.postMessage(msg);
      },
      kill() {
        return child.kill();
      },
      on(event: WorkerEventName, handler: WorkerEventListener) {
        // Electron's UtilityProcess uses Node EventEmitter shape - `message`,
        // `exit`, and `spawn` are all directly forwardable.
        (child as unknown as { on: (e: string, h: (arg?: unknown) => void) => void }).on(
          event,
          (arg) => handler(arg),
        );
      },
      onStderr(handler: (chunk: string) => void) {
        const stderr = (child as unknown as { stderr?: NodeJS.ReadableStream }).stderr;
        if (!stderr) return;
        stderr.setEncoding('utf8');
        stderr.on('data', (chunk: string) => handler(chunk));
      },
    };
    return handle;
  },
};
