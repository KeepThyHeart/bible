/**
 * Imperative mount of the VerseSelector for hosts without React (Memory's vanilla DOM views). Runs on React or
 * preact/compat (`react-dom/client`). `update` re-renders with merged props (a changed `initialReference`
 * re-seeds); `dispose` unmounts.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { VerseSelector } from './VerseSelector';
import type { VerseSelectorProps } from './VerseSelector';

export interface VerseSelectorHandle {
  update(props: Partial<VerseSelectorProps>): void;
  dispose(): void;
}

export function mountVerseSelector(container: HTMLElement, props: VerseSelectorProps): VerseSelectorHandle {
  const root = createRoot(container);
  let current = props;
  let disposed = false;
  const render = () => root.render(createElement(VerseSelector, current));
  render();
  return {
    update(next) {
      if (disposed) return;
      current = { ...current, ...next };
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.unmount();
    },
  };
}
