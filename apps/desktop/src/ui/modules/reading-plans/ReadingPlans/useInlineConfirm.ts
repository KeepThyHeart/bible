import { useEffect, useRef } from 'react';

/**
 * Keyboard behaviour of an inline "Are you sure?" group (Remove / Delete a plan):
 * focus moves to its first button when it opens, and Escape cancels it.
 * Returning focus afterwards is the caller's job, since only it knows what the
 * trigger is (and whether it survives the action).
 *
 * `openKey` is whatever identifies the open confirmation (an id), or null while
 * none is open; the effect runs again when it changes.
 */
export function useInlineConfirm(openKey: string | null, cancel: () => void) {
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openKey === null) return;
    groupRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [openKey]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };
  return { groupRef, onKeyDown };
}
