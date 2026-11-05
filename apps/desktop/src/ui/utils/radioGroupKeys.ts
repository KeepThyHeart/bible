import type { KeyboardEvent } from 'react';

/**
 * Keyboard handling for a custom `role="radiogroup"` of `role="radio"` buttons
 * (the WAI-ARIA radio pattern). Put it on the group's `onKeyDown`, and give each
 * radio `tabIndex={selected ? 0 : -1}` so the group is a single Tab stop.
 *
 * Arrow keys move focus to the next/previous radio (wrapping) and select it,
 * Home/End jump to the ends. Left/Right follow the reading direction, so they
 * mirror in an RTL UI; Up/Down always mean previous/next.
 */
export function onRadioGroupKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const group = e.currentTarget;
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).filter(
    (el) => !(el as HTMLButtonElement).disabled && el.closest('[role="radiogroup"]') === group,
  );
  if (radios.length === 0) return;
  const current = radios.indexOf((e.target as HTMLElement).closest<HTMLElement>('[role="radio"]') as HTMLElement);
  if (current === -1) return;
  const rtl = (group.ownerDocument.defaultView ?? window).getComputedStyle(group).direction === 'rtl';

  let next: number;
  switch (e.key) {
    case 'ArrowDown':
      next = current + 1;
      break;
    case 'ArrowUp':
      next = current - 1;
      break;
    case 'ArrowRight':
      next = current + (rtl ? -1 : 1);
      break;
    case 'ArrowLeft':
      next = current + (rtl ? 1 : -1);
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = radios.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  const target = radios[(next + radios.length) % radios.length];
  target.focus();
  target.click();
}
