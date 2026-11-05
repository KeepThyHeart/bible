import { useEffect, useRef, useState } from 'preact/hooks';
import { Popover } from '@bible/ui';
import type { ComponentChildren } from 'preact';

/**
 * A small "?" button that opens its text in a popover, so a long explanation
 * costs one icon of space instead of a paragraph. Closes on Escape or a click
 * elsewhere (the shared Popover does both).
 */
export function HelpTip(props: { label: string; children: ComponentChildren; width?: number }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Escape (handled by the Popover) hands focus back to this button, not to <body>.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setTimeout(() => buttonRef.current?.focus(), 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const rect = open ? buttonRef.current?.getBoundingClientRect() : undefined;
  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        class={`pz-helptip ${open ? 'pz-helptip--on' : ''}`}
        aria-label={props.label}
        title={props.label}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <i class="fa-solid fa-circle-question" aria-hidden="true" />
      </button>
      <Popover
        open={open}
        /* rtl-physical: viewport rect from getBoundingClientRect (positioning owned by task 0088) */
        anchor={rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null}
        onClose={() => setOpen(false)}
        insideRefs={[buttonRef]}
        width={props.width ?? 300}
        estimatedHeight={140}
        label={props.label}
        className="pz-helptip__pop"
      >
        {props.children as never}
      </Popover>
    </>
  );
}
