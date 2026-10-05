/**
 * Small shared types for feature modules and their contribution points
 * (task 0080, M1). Pure TypeScript, no platform imports: part of
 * `@bible/core/browser`.
 *
 * Naming: "feature module" (never just "module") everywhere in this folder, so
 * it cannot be confused with a Bible *module* (`Services/ModuleLoader`).
 */

import type { LocalizedString } from '../Extensions/ExtensionApiDtos';

/** A synchronous dispose handle (the in-process twin of the extension API's `DisposableHandle`). */
export interface Disposable {
  dispose(): void;
}

/** Wrap a function as a `Disposable` that runs at most once. */
export function toDisposable(fn: () => void): Disposable {
  let done = false;
  return {
    dispose() {
      if (done) return;
      done = true;
      fn();
    },
  };
}

/** Dispose several handles; one that throws does not stop the rest. The first error is rethrown. */
export function disposeAll(items: Iterable<Disposable>): void {
  let first: unknown;
  let failed = false;
  for (const item of items) {
    try {
      item.dispose();
    } catch (err) {
      if (!failed) first = err;
      failed = true;
    }
  }
  if (failed) throw first;
}

/** The two hosts a feature module can target. */
export type HostPlatform = 'desktop' | 'web';

/**
 * Who registered a contribution. Every contribution point keeps it, so a
 * disabled feature module or an uninstalled extension can be removed in one
 * call (`disposeBySource`), and so extension contributions can be held to the
 * extension order band and id prefix.
 */
export type ContributionSource =
  | { readonly kind: 'builtin'; readonly moduleId: string }
  | { readonly kind: 'extension'; readonly extensionId: string };

/** Stable string key for a source: `builtin:present`, `extension:ext.kth.bible-memory`. */
export function sourceKey(source: ContributionSource): string {
  return source.kind === 'builtin' ? `builtin:${source.moduleId}` : `extension:${source.extensionId}`;
}

/**
 * A label the host resolves at render time.
 *
 * - Built-ins: an i18n key plus the English fallback (desktop `II18nService`,
 *   web i18next). `fallback` is shown verbatim while a catalog lacks the key.
 * - Extensions (M3): the manifest's `LocalizedString`, resolved through that
 *   extension's own l10n bundle.
 */
export type LabelRef =
  | { readonly key: string; readonly fallback: string }
  | { readonly extensionId: string; readonly text: LocalizedString };

/**
 * Order bands. The values mirror `ORDER_BUILTIN_*` / `ORDER_PLUGIN_*` in
 * `Extensions/Permissions.ts` (a test pins them equal). They are repeated here
 * because importing `Permissions.ts` would pull the whole extension API
 * registry into every browser bundle that uses a contribution point.
 */
export const CONTRIBUTION_ORDER = {
  builtinMin: 0,
  builtinMax: 99,
  extensionMin: 100,
  extensionMax: 1000,
  extensionDefault: 500,
  builtinDefault: 50,
} as const;

/** Clamp an order hint into its source's band (missing or non-finite: the band default). */
export function clampOrder(order: number | undefined, source: ContributionSource): number {
  const ext = source.kind === 'extension';
  const min = ext ? CONTRIBUTION_ORDER.extensionMin : CONTRIBUTION_ORDER.builtinMin;
  const max = ext ? CONTRIBUTION_ORDER.extensionMax : CONTRIBUTION_ORDER.builtinMax;
  const def = ext ? CONTRIBUTION_ORDER.extensionDefault : CONTRIBUTION_ORDER.builtinDefault;
  if (typeof order !== 'number' || !Number.isFinite(order)) return def;
  return Math.min(max, Math.max(min, order));
}

/** A lazy code loader: `() => import('./x')`. Calling it is what fetches the chunk. */
export type LazyLoader<T> = () => Promise<T>;

/**
 * Memoise a loader: the first call starts the import, later calls share it.
 * A rejected load is forgotten, so the next call retries (a flaky network
 * must not poison the app for the rest of the session). `peek()` returns the
 * value once loaded, synchronously, so a view can render without a Suspense
 * round trip after the first activation.
 */
export interface OnceLoader<T> {
  (): Promise<T>;
  peek(): T | undefined;
  readonly started: boolean;
}

export function lazyOnce<T>(loader: LazyLoader<T>): OnceLoader<T> {
  let pending: Promise<T> | null = null;
  let value: T | undefined;
  let loaded = false;
  const fn = (() => {
    if (!pending) {
      pending = loader().then(
        (v) => {
          value = v;
          loaded = true;
          return v;
        },
        (err: unknown) => {
          pending = null;
          throw err;
        },
      );
    }
    return pending;
  }) as OnceLoader<T>;
  fn.peek = () => (loaded ? value : undefined);
  Object.defineProperty(fn, 'started', { get: () => pending !== null || loaded });
  return fn;
}
