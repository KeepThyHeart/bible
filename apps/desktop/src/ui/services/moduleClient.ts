/**
 * Typed renderer client for a feature module's main-process API (task 0113).
 *
 * Convention: a module's `types.ts` (shared by main and renderer, imported with
 * `import type`) exports
 *
 *   export interface FooApi { getThing(id: number): Promise<Thing>; }
 *   export interface FooEvents { changed: [thing: Thing]; }   // name -> callback args tuple
 *
 * main implements `FooApi` via `ipc.handle` (electron/modules/FeatureMainModule.ts)
 * and the renderer does
 *
 *   const foo = createModuleClient<FooApi, FooEvents>('foo');
 *   const thing = await foo.getThing(3);
 *   const off = foo.on('changed', (thing) => ...);
 *
 * Calls go through `window.electron.modules.invoke(ns, method, ...args)`; the
 * handler's `Result<T>` envelope is unwrapped (see ipcResult.ts), so failures
 * are rejections (`IpcResultError` with a `code`).
 */

import { unwrap, type Result } from './ipcResult';


export type ModuleClient<TApi extends object, TEvents extends object = {}> = {
  [K in keyof TApi]: TApi[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
} & {
  on<E extends keyof TEvents & string>(event: E, cb: (...args: TEvents[E] extends unknown[] ? TEvents[E] : never) => void): () => void;
};

export interface ModulesBridge {
  invoke(ns: string, method: string, ...args: unknown[]): Promise<unknown>;
  on(ns: string, event: string, cb: (...args: any[]) => void): () => void;
}

function bridge(): ModulesBridge {
  const modules = (window as unknown as { electron?: { modules?: ModulesBridge } }).electron?.modules;
  if (!modules) throw new Error('Feature module bridge not available (not running in Electron)');
  return modules;
}

export function createModuleClient<TApi extends object, TEvents extends object = {}>(
  ns: string,
  getBridge: () => ModulesBridge = bridge,
): ModuleClient<TApi, TEvents> {
  const cache = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  return new Proxy({} as ModuleClient<TApi, TEvents>, {
    get(_target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (prop === 'on') {
        return (event: string, cb: (...args: any[]) => void) => getBridge().on(ns, event, cb);
      }
      let fn = cache.get(prop);
      if (!fn) {
        fn = (...args) => unwrap(getBridge().invoke(ns, prop, ...args) as Promise<Result<unknown>>);
        cache.set(prop, fn);
      }
      return fn;
    },
  });
}
