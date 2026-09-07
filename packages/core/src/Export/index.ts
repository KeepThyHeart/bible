/**
 * Export surface for module content.
 *
 * Currently: USFM. Everything here is a pure function over already-fetched rows
 * - no database handles, no filesystem access - so it can run in the main
 * process, the renderer, a CLI, or a server without change.
 *
 * See `docs/Design/DataModel/ModuleFormat.md` for the normative format.
 */

export * from './VerseFormatting';
export * from './UsfmBookCodes';
export * from './toUSFM';
export * from './parseUSFM';
