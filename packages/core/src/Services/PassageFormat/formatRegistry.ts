/**
 * Format Registry
 *
 * Central registry for all verse copy formats
 */

import { CopyFormat } from './types';
import standardFormat from './standardFormat';
import combinedFormat from './combinedFormat';
import templateFormat from './templateFormat';

/**
 * Every format this registry can *render*. Not the list either dialog offers -
 * that is `formatCatalog.ts`.
 *
 * Three entries. "Standard" and "Combined" are two shapes of the same renderer
 * (see passageCopyRenderer.ts), both driven by the user's saved
 * `AdvancedCopyOptions`; "Custom Template" is a user-editable Handlebars-style
 * template (see templateFormat.ts) that answers to nothing but its own text.
 *
 * **Standard and Combined are registered but never offered.** One thing still
 * renders through them: a note saved with `data-expansion-format="standard"` in
 * its `verseExpansion` mark, which has to keep its shape when re-formatted.
 * Deleting the entries would turn that into a dead id. `formatCatalog.ts` is
 * where they are hidden from the pickers, via `LEGACY_PASSAGE_FORMAT_IDS`.
 *
 * `getLastUsedFormatId()` validates the persisted id against this registry, so
 * a user whose stored id names nothing here lands on Standard rather than on a
 * format that does not exist.
 */
const BUILT_IN_FORMATS: CopyFormat[] = [
  standardFormat,
  combinedFormat,
  templateFormat
];

const ALL_FORMATS: CopyFormat[] = [
  ...BUILT_IN_FORMATS
];

/**
 * Format registry for easy lookup
 */
const formatRegistry = new Map<string, CopyFormat>();

// Register all formats
for (const format of ALL_FORMATS) {
  formatRegistry.set(format.id, format);
}

/**
 * Get all available copy formats
 */
export function getAllFormats(): CopyFormat[] {
  return [...ALL_FORMATS];
}

/**
 * Get a format by ID
 *
 * @param id - Format ID (e.g., 'standard', 'combined')
 * @returns The format, or undefined if not found
 */
export function getFormatById(id: string): CopyFormat | undefined {
  return formatRegistry.get(id);
}

/**
 * Get the default format
 */
export function getDefaultFormat(): CopyFormat {
  return standardFormat;
}

/**
 * This *registry's* fallback, for consumers that can only render lines.
 *
 * Not the dialogs' default - that is `DEFAULT_PASSAGE_FORMAT_ID` in
 * `formatCatalog.ts`, and it names a block-tree format this registry cannot
 * produce. `formatVersesWithFormat()` returns a string of lines and therefore
 * cannot fall back to a markup shape, so its floor stays Standard.
 */
export const DEFAULT_FORMAT_ID = 'standard';

/**
 * Get all built-in formats
 */
export function getBuiltInFormats(): CopyFormat[] {
  return [...BUILT_IN_FORMATS];
}
