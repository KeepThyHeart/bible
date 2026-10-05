import { useState, useEffect } from 'preact/hooks';
import { DesktopApp } from '../../DesktopApp';
import { MobileApp } from '../../MobileApp';
import { FollowBanner } from '../../components/Present/FollowBanner';
import { getShellContext } from '../../host/appHost';
import { setStudyOwnsHash } from '../../host/hashGate';
import { bootStudy, afterStudyFirstPaint } from './studyBoot';

const MOBILE_BREAKPOINT = 768;
const MOBILE_TOUCH_BREAKPOINT = 1024;

function getIsMobile(): boolean {
  if (window.innerWidth <= MOBILE_BREAKPOINT) return true;
  // Touch-primary devices (phones/tablets) in landscape can exceed 768px
  // but should still use mobile layout up to 1024px
  const isTouchPrimary = window.matchMedia('(pointer: coarse)').matches;
  return isTouchPrimary && window.innerWidth <= MOBILE_TOUCH_BREAKPOINT;
}

/** The reading app: the follow banner plus the desktop or mobile layout. */
export function StudyView() {
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

  const { providers } = getShellContext();
  return (
    <>
      <FollowBanner />
      {isMobile ? <MobileApp providers={providers} /> : <DesktopApp providers={providers} />}
    </>
  );
}

let booted: Promise<void> | null = null;
let afterPaintDone = false;

/**
 * The Study binding's `activate`: runs on every mount, boots Study only once.
 * Study owns the URL hash from here on (set before its view mounts).
 */
export function activateStudy(): Promise<void> {
  setStudyOwnsHash(true);
  const ctx = getShellContext();
  booted ??= bootStudy(ctx).catch((err) => {
    booted = null; // let a retry boot again
    throw err;
  });
  return booted.then(() => {
    if (afterPaintDone) return;
    afterPaintDone = true;
    requestAnimationFrame(() => requestAnimationFrame(() => afterStudyFirstPaint(ctx)));
  });
}

/** Study is keep-alive 'always', so this only runs if that ever changes. */
export function deactivateStudy(): void {
  setStudyOwnsHash(false);
}
