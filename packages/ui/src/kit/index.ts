/**
 * IIFE entry of the extension UI kit (`ext-ui://host/kit/1/kth-kit.js`). Loading the script defines NO elements
 * and has no side effect beyond assigning `globalThis.KthKit`; the page (or `@bible/extension-ui`'s `loadKit`)
 * calls `KthKit.init({ rpc, components })`, which defines the listed tags and reads `ui.getLocale` once.
 *
 * The kit calls no other host method in v1 (`hostMethods` are empty in core). Nothing from the host page is
 * baked in at build time: the only `define` is NODE_ENV.
 */
import { defineKthElement } from './defineKthElement';
import { KIT_ELEMENTS } from './elements';
import { sanitizeLocale, setKitLocale } from './kitLocale';

/** Structurally satisfied by `BibleExtUI` from `@bible/extension-ui`. */
export interface KthRpcLike {
  getLocale(): Promise<{ locale: string; direction: 'ltr' | 'rtl' }>;
}
export interface KthKitInitOptions {
  rpc?: KthRpcLike;
  /** Tags to define (default: all). Unknown tags are skipped with a console warning. */
  components?: readonly string[];
  /** Skip the RPC and use this locale. */
  locale?: string;
  direction?: 'ltr' | 'rtl';
}
export interface KthKitApi {
  readonly version: '1';
  readonly tags: readonly string[];
  /** Defines components (default all), then resolves the locale. Never rejects because of the RPC. */
  init(opts?: KthKitInitOptions): Promise<void>;
  define(tags?: readonly string[]): void;
  setLocale(locale: string, direction?: 'ltr' | 'rtl'): void;
}

const TAGS: readonly string[] = Object.freeze(Object.keys(KIT_ELEMENTS));

function define(tags: readonly string[] = TAGS): void {
  for (const tag of tags) {
    const el = Object.prototype.hasOwnProperty.call(KIT_ELEMENTS, tag) ? KIT_ELEMENTS[tag] : undefined;
    if (!el) {
      console.warn(`KthKit: unknown component "${String(tag)}" skipped`);
      continue;
    }
    defineKthElement(tag, el.component, el.spec);
  }
}

function setLocale(locale: string, direction?: 'ltr' | 'rtl'): void {
  setKitLocale(sanitizeLocale(locale, direction));
}

async function init(opts: KthKitInitOptions = {}): Promise<void> {
  define(opts.components ?? TAGS);
  if (opts.locale !== undefined) {
    setLocale(opts.locale, opts.direction);
    return;
  }
  if (opts.rpc) {
    try {
      const l = await opts.rpc.getLocale();
      setKitLocale(sanitizeLocale(l?.locale, l?.direction));
    } catch {
      // keep the current locale (English by default)
    }
  }
}

const api: KthKitApi = { version: '1', tags: TAGS, init, define, setLocale };

const g = globalThis as { KthKit?: KthKitApi };
if (!g.KthKit) g.KthKit = Object.freeze(api);
