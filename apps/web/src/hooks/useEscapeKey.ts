import { useEffect, useRef } from 'preact/hooks';

/**
 * Call `onEscape` when Escape is pressed while `isOpen` is true.
 *
 * The listener is attached for the component's whole life, with the open flag
 * read from a ref, rather than attached when the dialog opens. Preact flushes
 * effects on an animation frame, so an open-triggered listener is not live for
 * the first frames the dialog is on screen — it is visible and deaf to Escape.
 * A person is unlikely to win that race; a loaded machine running tests wins it
 * often enough to fail runs.
 *
 * Only for components that stay mounted while closed, which is every dialog in
 * `DialogLayer`. A component mounted at the moment it opens gets no benefit —
 * its mount effect is deferred by the same frame.
 */
export function useEscapeKey(isOpen: boolean, onEscape: () => void): void {
  const stateRef = useRef({ isOpen, onEscape });
  stateRef.current = { isOpen, onEscape };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const { isOpen: open, onEscape: close } = stateRef.current;
      if (!open) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
