import { resolveShortcutAction } from '../../study/usePresenterShortcuts';

export type PresenterKeyAction =
  | { type: 'help' }
  | { type: 'revealHighlight' }
  | { type: 'clearHighlights' }
  | { type: 'planItem'; direction: 'next' | 'previous' }
  | { type: 'step'; direction: 'next' | 'previous' }
  | { type: 'toggleBlank' };

type KeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'repeat'>;

/**
 * The Presenter page's own keys: `?` help, `H` reveal the next note highlight,
 * `X` clear highlights, `N` / `Shift+N` next / previous plan item. Plain keys
 * only (a modifier belongs to something else), and never while typing, which
 * the caller checks. Before going live the clicker layer (arrows, `.`, `B`)
 * is answered here as well, against the local session; once live the
 * always-mounted `usePresenterShortcuts` owns those, so answering them too
 * would step twice.
 */
export function resolvePresenterKey(
  event: KeyEvent,
  context: { live: boolean; acceptClickerKeys: boolean; hasLive: boolean },
): PresenterKeyAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.key === '?') return { type: 'help' };
  if (event.repeat) return null;
  switch (event.key) {
    case 'h': case 'H': return { type: 'revealHighlight' };
    case 'x': case 'X': return { type: 'clearHighlights' };
    case 'n': return { type: 'planItem', direction: 'next' };
    case 'N': return { type: 'planItem', direction: 'previous' };
  }
  if (context.live) return null;
  const action = resolveShortcutAction(event, { hasStaged: false, acceptClickerKeys: context.acceptClickerKeys, hasLive: context.hasLive });
  if (action?.type === 'next' || action?.type === 'previous') return { type: 'step', direction: action.type };
  if (action?.type === 'toggleBlank') return { type: 'toggleBlank' };
  return null;
}

/** The plan item `N` / `Shift+N` should show, given the plan's ids and the live one; null at the ends or with an empty plan. */
export function planTarget(ids: readonly string[], liveId: string | null, direction: 'next' | 'previous'): string | null {
  if (ids.length === 0) return null;
  const at = liveId ? ids.indexOf(liveId) : -1;
  if (at < 0) return ids[0];
  const to = at + (direction === 'next' ? 1 : -1);
  return to >= 0 && to < ids.length ? ids[to] : null;
}
