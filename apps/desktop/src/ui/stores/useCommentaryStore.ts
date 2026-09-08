// Re-export shim - the useCommentaryStore implementation has been sliced into
// `./commentary/`. This shim preserves the original import path so consumers
// (components, hooks, other stores) don't need to be updated.
//
// See: docs/old/cleanup/07-store-slice-refactor.md
export { useCommentaryStore, DEFAULT_PANEL_ID } from './commentary/useCommentaryStore';
export type {
  CommentaryState,
  CommentaryPanelState,
  CommentaryModule,
  CommentaryEntry,
  CommentaryEntrySummary,
  CommentaryTab,
  CommentaryHomeModuleData,
} from './commentary/types';
export { createDefaultPanelState } from './commentary/types';
