/**
 * LocaleMetadata.ts
 *
 * The shape of one locale's *translation-maturity* metadata, as read from
 * that locale's own `meta.json` (flat, dotted keys: `locale.name`,
 * `locale.nativeName`, `locale.status`, `locale.direction`).
 *
 * This is deliberately separate from `LocaleRegistry.ts`: the registry
 * describes facts about a *language* (direction, script, digits) that are
 * true years before anyone drafts a catalog for it, while `LocaleStatus`
 * describes how far *one app's shipped catalog* for that language has come
 * (`draft` / `beta` / `complete`). A language can be fully described in the
 * registry with no `meta.json` anywhere, and two apps can independently be at
 * different statuses for the same language (as they are today: desktop has
 * six draft catalogs, web has none yet).
 *
 * Both apps use the same three-tier meaning:
 *
 *  - `draft`    - machine-drafted and incomplete, or awaiting review. A
 *                 built-in locale at this status is withheld from the
 *                 language picker entirely.
 *  - `beta`     - machine-drafted but complete and stable enough to offer,
 *                 with an honest "beta" badge.
 *  - `complete` - reviewed by a native speaker. Offered with no badge.
 *
 * Desktop's `II18nService.ts` defines its own `LocaleStatus`/`LocaleMetadata`
 * with this identical shape (it predates this shared module and reaches
 * consumers through Electron's catalog IPC bridge, which this platform-free
 * module must not depend on). Both are kept in step by convention and by
 * `scripts/check-translations.js`, which reads the same `locale.status` key
 * from both apps' `meta.json` files.
 */

import type { LocaleDirection } from './LocaleRegistry';

export type { LocaleDirection };

export type LocaleStatus = 'complete' | 'beta' | 'draft';

/** Descriptive, per-app metadata for one shipped locale catalog. */
export interface LocaleMetadata {
  /** BCP-47 code, i.e. the folder name. */
  code: string;
  /** Name in English, for logs and for maintainers: `Spanish`. */
  name: string;
  /** Endonym, for the language picker: `Español`. */
  nativeName: string;
  status: LocaleStatus;
  direction: LocaleDirection;
}

/**
 * Parse a locale's `meta.json` (already `JSON.parse`d) into a
 * {@link LocaleMetadata}, tolerating a missing or malformed `locale.status`
 * by treating it as `draft` - understating a translation's maturity is
 * always the safe direction to fail (see the desktop docs this mirrors,
 * `apps/desktop/locales/README.md`).
 */
export function parseLocaleMeta(code: string, raw: Record<string, unknown>): LocaleMetadata {
  const status = raw['locale.status'];
  const name = raw['locale.name'];
  const nativeName = raw['locale.nativeName'];
  return {
    code,
    name: typeof name === 'string' ? name : code,
    nativeName: typeof nativeName === 'string' ? nativeName : (typeof name === 'string' ? name : code),
    status: status === 'complete' || status === 'beta' ? status : 'draft',
    direction: raw['locale.direction'] === 'rtl' ? 'rtl' : 'ltr',
  };
}
