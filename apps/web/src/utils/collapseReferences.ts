/**
 * Reference collapsing — re-exported from the browser-safe core subset.
 *
 * Previously this reached into core's TypeScript source by relative path
 * (`../../../core/src/Services/ReferenceCollapser`) to dodge CJS interop.
 * `@bible/core/browser` makes that explicit and type-checked; see
 * `packages/core/src/browser.ts`.
 */
export {
  collapseReferences,
  collapseReferencesStructured,
  getBookName,
} from '@bible/core/browser';

export type {
  BookNameFormat,
  CollapseOptions,
  CollapsedSegment,
} from '@bible/core/browser';
