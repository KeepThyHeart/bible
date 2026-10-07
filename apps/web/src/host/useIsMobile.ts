import { useEffect, useState } from 'preact/hooks';
import { isMobileLayout } from '../utils/isMobileLayout';

const MOBILE_BREAKPOINT = 768;
const MOBILE_TOUCH_BREAKPOINT = 1024;

/**
 * True while the viewport uses the phone layout (narrow, or touch-primary up
 * to tablet landscape). One source for Study's desktop/mobile choice and the
 * shell's rail/sheet choice, so they never disagree.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(isMobileLayout);
  useEffect(() => {
    const mqlNarrow = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const mqlTouch = window.matchMedia(`(max-width: ${MOBILE_TOUCH_BREAKPOINT}px) and (pointer: coarse)`);
    const handler = () => setIsMobile(isMobileLayout());
    mqlNarrow.addEventListener('change', handler);
    mqlTouch.addEventListener('change', handler);
    return () => {
      mqlNarrow.removeEventListener('change', handler);
      mqlTouch.removeEventListener('change', handler);
    };
  }, []);
  return isMobile;
}
