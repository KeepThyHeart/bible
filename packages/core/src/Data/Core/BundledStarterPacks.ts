import starterPacksJson from './starter-packs.json';
import { parseStarterPacks, type StarterPack } from './StarterPackTypes';

/**
 * The recommended module sets that ship with the app, read from
 * `starter-packs.json` (edit that file to change them).
 *
 * They are what first run offers when the official catalog does not publish
 * `starter_packs` of its own, so a fresh install has a sensible "install the
 * basics" choice without anyone having to change the catalog. Like every other
 * starter pack they only NAME modules: the app resolves the ids against the
 * verified official catalog and downloads each one from there, so nothing here
 * widens what is trusted.
 *
 * Entries that fail validation are dropped rather than throwing - a typo in one
 * pack must not stop the app starting.
 */
export const BUNDLED_STARTER_PACKS: readonly StarterPack[] = parseStarterPacks(
  (starterPacksJson as { packs: unknown }).packs
).packs;
