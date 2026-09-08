import React from 'react';

/**
 * Neutral placeholder shown in a pane while startup session restore is still
 * in progress and we don't yet know whether the pane will end up with any
 * open tabs.
 *
 * This is a THIRD state, distinct from the two panes already distinguish:
 *   - "restoring" (this component): session restore hasn't resolved yet.
 *   - "loading content": a tab is already open and its content is in flight
 *     (each pane's own `isLoading` handling).
 *   - "genuinely empty": restore has resolved and there really are zero tabs.
 *
 * Before this existed, panes keyed their "no content" onboarding empty state
 * (with install/choose-a-module call-to-action buttons) purely on
 * `openTabs.length === 0`, which is also true for the first render or two of
 * every startup - producing a confusing flash of "Get a commentary" before
 * the session restore populates the tab. Gate that branch on `isSessionLoaded`
 * (see `useSessionStore`) and show this instead.
 */
const PaneLoadingSkeleton: React.FC<{ testId?: string }> = ({ testId = 'pane-loading-skeleton' }) => (
  <div
    className="flex flex-col items-center justify-center h-full w-full px-lg py-xl"
    data-testid={testId}
    aria-hidden="true"
  >
    <div className="w-full max-w-sm space-y-sm animate-pulse">
      <div className="h-4 rounded bg-background-hover w-2/3 mx-auto" />
      <div className="h-3 rounded bg-background-hover w-full" />
      <div className="h-3 rounded bg-background-hover w-5/6 mx-auto" />
      <div className="h-3 rounded bg-background-hover w-4/6 mx-auto" />
    </div>
  </div>
);

export default PaneLoadingSkeleton;
