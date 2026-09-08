/**
 * A one-shot "every locale catalog is loaded" signal.
 *
 * ## Why this is needed
 *
 * `II18nService.loadCatalog()` deliberately fires no event - see the comment
 * in `main.tsx`, which is why the persisted locale is restored only after
 * `LocaleCatalogLoader.loadAll()` resolves. That is fine for every existing
 * consumer, because they read *strings*, and a component that renders before
 * the catalogs arrive simply renders English and is re-rendered later by
 * something else.
 *
 * It is not fine for a consumer that reads the *list of locales*. The
 * first-run language picker renders at first paint, when
 * `availableLocaleInfos` may still hold only the `en` catalog that `main.tsx`
 * bundles statically - so the picker would offer English and nothing else,
 * permanently, since no event would ever tell it to re-render.
 *
 * Rather than add a catalog-loaded event to `II18nService` (a change every
 * implementation and test double would have to absorb, for one caller), this
 * exposes the completion of the load that `main.tsx` already performs.
 *
 * ## Contract
 *
 * - `whenLocaleCatalogsReady()` resolves once `markLocaleCatalogsReady()` has
 *   been called, and resolves immediately for callers that arrive afterwards.
 * - It NEVER rejects. A failed catalog load still marks ready: the loader
 *   already swallows and logs per-catalog failures, and a picker that hangs
 *   forever because a user's `userData/locales/` folder is unreadable would
 *   be a worse outcome than one showing a short list.
 * - Renderer entry points that do not load catalogs (the detached pane
 *   window) simply never call the marker; nothing there awaits this.
 */

let ready = false;
let resolveReady: (() => void) | undefined;

const readyPromise: Promise<void> = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

/**
 * Announce that `LocaleCatalogLoader.loadAll()` has settled. Idempotent -
 * calling it twice (or after a hot reload) is harmless.
 */
export function markLocaleCatalogsReady(): void {
  if (ready) return;
  ready = true;
  resolveReady?.();
}

/** Resolves when the catalogs are in. Never rejects. */
export function whenLocaleCatalogsReady(): Promise<void> {
  return readyPromise;
}

/** Synchronous peek, for callers that can render a sensible interim state. */
export function areLocaleCatalogsReady(): boolean {
  return ready;
}
