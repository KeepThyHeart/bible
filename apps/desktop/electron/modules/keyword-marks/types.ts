/**
 * Shared types of the keyword-marks main module: its `TApi`, implemented in `./index.ts` through
 * `ipc.handle` and called by the renderer through `createModuleClient<KeywordMarksApi>('keyword-marks')`.
 * Type-only imports, so the renderer pulls no main-process code in.
 */
import type { KeywordSet } from '@bible/core/browser';

export interface KeywordMarksApi {
  list(): KeywordSet[];
  put(set: unknown): void;
  remove(id: string): void;
}
