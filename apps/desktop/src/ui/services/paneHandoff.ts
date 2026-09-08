/**
 * Handing a reader from one pane to another without a flash of the wrong
 * thing.
 *
 * Dockview mounts a pane's content the moment its tab becomes active, so a
 * cross-pane navigation that activated the tab *before* pointing the target at
 * its new subject showed the reader the previous subject - or an empty shell -
 * until the new content arrived. Clicking a topic in the Study pane was the
 * clearest case: the Topics pane appeared still showing the topic before it.
 *
 * The fix has two halves. Point the target pane at its new subject first, then
 * hold the tab switch until the content it needs has actually been fetched.
 * The hold is capped, because a switch that waits on a slow query stops feeling
 * like a switch at all: past the cap the reader gets the tab regardless, sees
 * the pane's own loading state, and knows the click landed.
 */
export const PANE_HANDOFF_CAP_MS = 50;

/**
 * Runs `activate` once `content` settles or `capMs` elapses, whichever comes
 * first - and only ever once.
 *
 * `content` rejecting is not an error here: a failed prefetch just means the
 * pane will fetch and report the failure itself, so the switch still happens.
 */
export function activateWhenContentReady(
  activate: () => void,
  content: Promise<unknown>,
  capMs: number = PANE_HANDOFF_CAP_MS,
): void {
  let switched = false;
  const run = (): void => {
    if (switched) return;
    switched = true;
    clearTimeout(timer);
    activate();
  };

  const timer = setTimeout(run, capMs);
  content.then(run, run);
}
