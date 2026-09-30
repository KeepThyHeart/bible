import { useEffect, useState } from 'preact/hooks';
import type { PresentState } from '../../../present/protocol';
import { ViewerApp } from '../../../present/ViewerApp';
import { LOCAL_PREVIEW_SOURCE, parseLocalPreviewState } from './localPreviewProtocol';

/**
 * Runs inside the pre-live preview frame (the viewer page with `?local=1`):
 * renders the real viewer from state the Presenter posts in, so the preview
 * and the real screen are the same code. The viewer's own `?interactive=1`
 * bridge sends gestures back up to the Presenter.
 *
 * Imported by the viewer entry (`present/viewer.tsx`), so keep it light.
 */
export function LocalPreviewHost(): preact.JSX.Element {
  const [state, setState] = useState<PresentState | null>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      const next = parseLocalPreviewState(event.data);
      if (next) setState(next);
    };
    window.addEventListener('message', onMessage);
    // Ask for the current state: the parent may have posted before we listened.
    window.parent.postMessage({ source: LOCAL_PREVIEW_SOURCE, kind: 'hello' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return <ViewerApp localState={state} />;
}
