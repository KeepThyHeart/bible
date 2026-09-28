/**
 * Loader for the host-served extension UI kit (`kth-*` custom elements).
 *
 * The kit is NOT part of this package. The host serves it from
 * `ext-ui://host/kit/1/kth-kit.js`; `loadKit` adds that classic script, waits
 * for the `KthKit` global, and calls `KthKit.init({ rpc })`. The extension must
 * also declare `uiKit` in its manifest (and hold `ui:contribute-pane`).
 */

export const HOST_KIT_JS = 'ext-ui://host/kit/1/kth-kit.js';
export const KIT_MAJOR = '1';

/** What the kit needs from the bridge. `BibleExtUI` satisfies it. */
export interface KitRpc {
  getLocale(): Promise<{ locale: string; direction: 'ltr' | 'rtl' }>;
}

/** Structural view of the `KthKit` global (keep in sync with the kit's `KthKitApi`). */
export interface KthKitGlobal {
  readonly version: string;
  readonly tags: readonly string[];
  init(opts: { rpc?: KitRpc; components?: readonly string[] }): Promise<void>;
}

export interface LoadKitOptions {
  /** Tags to define. Default: all. Use the same list as `uiKit.components` in your manifest. */
  components?: readonly string[];
  /** Give up waiting for the script after this long. Default 10000. */
  timeoutMs?: number;
}

export interface KitHandle {
  readonly version: string;
  /** Resolves with the `KthKit` global once its elements are defined. Rejects on load error, timeout or version mismatch. */
  readonly ready: Promise<KthKitGlobal>;
  /** Stop waiting. A script that loads afterwards is left alone and settles nothing. */
  dispose(): void;
}

declare global {
  interface Window {
    KthKit?: KthKitGlobal;
  }
}

/** Add the kit script (unless present), await `KthKit` and initialise it. */
export function loadKit(rpc: KitRpc, opts: LoadKitOptions = {}): KitHandle {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settle = async (): Promise<KthKitGlobal> => {
    const kit = window.KthKit;
    if (!kit || String(kit.version).split('.')[0] !== KIT_MAJOR) {
      throw new Error(`UI kit ${KIT_MAJOR} not available`);
    }
    await kit.init({ rpc, components: opts.components });
    return kit;
  };

  const ready = new Promise<KthKitGlobal>((resolve, reject) => {
    if (window.KthKit) {
      // A static <script> already ran.
      settle().then(resolve, reject);
      return;
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${HOST_KIT_JS}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = HOST_KIT_JS;
      script.async = false;
      (document.head ?? document.documentElement).appendChild(script);
    }
    const done = (fn: () => void): void => {
      clearTimeout(timer);
      if (!disposed) fn();
    };
    script.addEventListener('load', () => done(() => settle().then(resolve, reject)), { once: true });
    script.addEventListener('error', () => done(() => reject(new Error(`Failed to load ${HOST_KIT_JS}`))), {
      once: true,
    });
    timer = setTimeout(
      () => done(() => reject(new Error(`Timed out loading ${HOST_KIT_JS}`))),
      opts.timeoutMs ?? 10_000,
    );
  });
  ready.catch(() => {}); // authors who ignore `ready` get no unhandled-rejection noise

  return {
    version: KIT_MAJOR,
    ready,
    dispose(): void {
      disposed = true;
      clearTimeout(timer);
    },
  };
}

// ── Event detail types for `kth-*` events ────────────────────────────────

/** `kth-change` detail of `<kth-reference-picker>`. */
export interface KthReferenceChangeDetail {
  verseId: number;
  endVerseId?: number;
  /** Canonical reference in the host locale, e.g. "Juan 3:16". */
  ref: string;
  wholeChapter?: true;
}

/** `kth-pick` detail of `<kth-book-chapter-picker>`. */
export interface KthPickDetail {
  book: number;
  chapter: number;
  verseId: number;
}

/** `kth-change` detail of `<kth-highlight-swatch>`. */
export interface KthSwatchChangeDetail {
  color: string;
  hex: string;
}
