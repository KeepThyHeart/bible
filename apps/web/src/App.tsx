import { useState, useEffect } from 'preact/hooks';
import { DesktopApp } from './DesktopApp';
import { MobileApp } from './MobileApp';
import type { IDataProviders } from './providers/interfaces';

const MOBILE_BREAKPOINT = 768;
const MOBILE_TOUCH_BREAKPOINT = 1024;

function getIsMobile(): boolean {
  if (window.innerWidth <= MOBILE_BREAKPOINT) return true;
  // Touch-primary devices (phones/tablets) in landscape can exceed 768px
  // but should still use mobile layout up to 1024px
  const isTouchPrimary = window.matchMedia('(pointer: coarse)').matches;
  return isTouchPrimary && window.innerWidth <= MOBILE_TOUCH_BREAKPOINT;
}

interface AppProps {
  providers: IDataProviders;
}

export function App({ providers }: AppProps) {
  const [isMobile, setIsMobile] = useState(getIsMobile);

  useEffect(() => {
    const mqlNarrow = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const mqlTouch = window.matchMedia(`(max-width: ${MOBILE_TOUCH_BREAKPOINT}px) and (pointer: coarse)`);
    const handler = () => setIsMobile(getIsMobile());
    mqlNarrow.addEventListener('change', handler);
    mqlTouch.addEventListener('change', handler);
    return () => {
      mqlNarrow.removeEventListener('change', handler);
      mqlTouch.removeEventListener('change', handler);
    };
  }, []);

  return isMobile
    ? <MobileApp providers={providers} />
    : <DesktopApp providers={providers} />;
}
