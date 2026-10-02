/**
 * Whether the viewport uses the phone layout. Mirrors `App.tsx`'s `getIsMobile`
 * (narrow, or touch-primary up to tablet landscape) for components that pick a
 * bottom sheet over an anchored popover.
 */
const MOBILE_BREAKPOINT = 768;
const MOBILE_TOUCH_BREAKPOINT = 1024;

export function isMobileLayout(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth <= MOBILE_BREAKPOINT) return true;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse && window.innerWidth <= MOBILE_TOUCH_BREAKPOINT;
}
