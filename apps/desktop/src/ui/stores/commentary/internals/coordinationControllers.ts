import { CommentaryCoordinationController } from '@bible/core';

// Per-panel coordination controllers (mutable, lives outside Zustand)
export const commentaryControllers = new Map<string, CommentaryCoordinationController>();

export function getCommentaryController(panelId: string): CommentaryCoordinationController {
  let ctrl = commentaryControllers.get(panelId);
  if (!ctrl) {
    ctrl = new CommentaryCoordinationController();
    commentaryControllers.set(panelId, ctrl);
  }
  return ctrl;
}
