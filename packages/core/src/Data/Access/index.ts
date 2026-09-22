/**
 * Swappable Data Access layer (task 0026, revision 2).
 *
 * - M1: types and the keyword-index registry, no behaviour change to any
 *   existing code.
 * - M2: `Fts5QueryCompiler`, the only place that writes FTS5 MATCH syntax.
 * - M3: `InModuleFts5Provider`, the strangler-step provider wrapping today's
 *   in-module FTS5 tables - the first thing in this folder `BibleSearchService`
 *   actually calls.
 *
 * Task 0027, "Module Format v2", revision 2:
 *
 * - F4: `Codec/`, the read side of `module_info.compression` - one codec per
 *   module, resolved once at open, bare standard frames in the cells.
 * - F6: `Fts5/SidecarFts5Provider` (+ `Fts5/sidecarSchema`), the first
 *   build-capable provider - one `.kwi` file per module revision, with the
 *   full unbuilt/building/ready/stale/failed state machine over real files.
 */

export * from './Capabilities';
export * from './KeywordTypes';
export * from './IKeywordIndexProvider';
export * from './DataAccessConfig';
export * from './IKeywordIndexRegistry';
export * from './KeywordIndexRegistry';
export * from './Fts5/Fts5QueryCompiler';
export * from './Fts5/InModuleFts5Provider';
export * from './Fts5/sidecarSchema';
export * from './Fts5/SidecarFts5Provider';
export * from './Codec';
