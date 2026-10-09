import { DesktopApp } from '../../DesktopApp';
import { MobileApp } from '../../MobileApp';
import { SlotOutlet, studyBanners } from '../../host/slots';
import { getShellContext } from '../../host/appHost';
import { setStudyOwnsHash } from '../../host/hashGate';
import { useIsMobile } from '../../host/useIsMobile';
import { bootStudy, afterStudyFirstPaint } from './studyBoot';

/** The reading app: feature modules' banners (e.g. the follow banner) plus the desktop or mobile layout. */
export function StudyView() {
  const isMobile = useIsMobile();

  const { providers } = getShellContext();
  return (
    <>
      <SlotOutlet slot={studyBanners} />
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
