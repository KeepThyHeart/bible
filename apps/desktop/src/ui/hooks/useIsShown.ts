import { useEffect, useState } from 'react';

/** Whether `node` sits inside an element carrying the `hidden` attribute (the app stage hides inactive apps this way). */
function insideHidden(node: Element | null): boolean {
  return !!node?.closest('[hidden]');
}

/**
 * Tracks whether the element behind `getNode` is actually on screen, as far as the `hidden` attribute goes.
 *
 * The desktop app stage keeps every app mounted and hides the inactive ones with `[hidden]` (visibility, not
 * unmounting). A modal that lives inside a hidden app must not take focus or make the rest of the page
 * `inert`: nobody can see it, and the whole window stops responding. Use the result as the `active` flag
 * of a focus trap. Re-evaluates when any `hidden` attribute changes, so the dialog engages when its app
 * is shown again.
 */
export function useIsShown(getNode: () => Element | null): boolean {
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const update = (): void => setShown(!insideHidden(getNode()));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    return () => observer.disconnect();
    // getNode reads a ref; it is stable by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return shown;
}
