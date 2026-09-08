import { useEffect, useRef } from 'react';
import { activateFocusTrap } from '../utils/focusTrap';

/**
 * React hook that activates a focus trap on the returned ref's element while
 * `active` is true. Focus is moved into the container on activation and
 * restored to the previously focused element on release.
 *
 * Pass `onEscape` to also close the dialog when Escape is pressed. The keydown
 * listener lives on the trapped container (not window), and propagation is
 * stopped, so a dialog opened on top of another closes only itself.
 *
 * Usage:
 *   const ref = useFocusTrap<HTMLDivElement>(isOpen, onClose);
 *   return <div ref={ref} role="dialog" aria-modal="true">...</div>;
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  active: boolean,
  onEscape?: () => void,
): React.RefObject<T> {
  const ref = useRef<T>(null);

  // Held in a ref so callers can pass an inline arrow function without the
  // effect below re-running on every render. Re-activating the trap would pull
  // focus back to the first focusable element mid-interaction.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const handle = activateFocusTrap(node, {
      // Only forward Escape when the caller actually supplied a handler -
      // existing single-argument call sites must keep letting Escape bubble to
      // whatever listener they already had.
      onEscape: onEscapeRef.current ? () => onEscapeRef.current?.() : undefined,
    });
    return () => handle.release();
  }, [active]);

  return ref;
}
