/**
 * The Memory page (`#/@memory`, lazy chunk): mounts the DOM UI from `@bible/memory/ui` over the user-DB worker.
 * The shell draws the app chrome (rail on desktop layouts, the "Back to Study" bar on the phone), so the page only
 * adds a visually hidden heading (the focus target when the app opens) and the host element.
 */
import './memory.scss';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { mountMemoryUi } from '@bible/memory/ui';
import type { MemoryUiHandle } from '@bible/memory/ui';
import { bibleStore } from '../../stores/bibleStore';
import { formatPassageRef } from '../../constants';
import { getWebMemoryApi } from './webMemoryApi';

/** The reader's current reference ("John 3:16"), or null before a chapter is open. */
export function activeReference(): string | null {
  const tab = bibleStore.getActiveTab();
  if (!tab || tab.book == null || tab.chapter == null) return null;
  const verse = tab.studyVerse ? tab.studyVerse % 1000 : undefined;
  return formatPassageRef(tab.book, tab.chapter, verse || undefined);
}

export function MemoryApp() {
  const { t } = useTranslation();
  const headingId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;
    let handle: MemoryUiHandle | undefined;
    try {
      const { api, subscribe } = getWebMemoryApi();
      handle = mountMemoryUi(container, { api, subscribe, activeReference: activeReference() });
    } catch (e) {
      console.warn('[memory] could not start:', e);
      setFailed(true);
      return;
    }
    const off = bibleStore.subscribe(() => handle?.setActiveReference(activeReference()));
    return () => {
      off();
      handle?.dispose();
    };
  }, []);

  return (
    <section class="memory-app" data-app="memory" aria-labelledby={headingId}>
      <h1 id={headingId} tabIndex={-1} class="memory-app__title">{t('apps.memory.title', 'Memory')}</h1>
      <div ref={hostRef} class="memory-app__host" />
      {failed && <p role="alert">{t('apps.stage.error', 'This app could not be loaded.')}</p>}
    </section>
  );
}
