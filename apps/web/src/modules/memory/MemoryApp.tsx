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
import { onJustAdded, takeJustAdded } from './justAdded';
import { getWebMemoryApi } from './webMemoryApi';
import { loadMemoryTranslator } from './memoryT';

/** The reader's current reference ("John 3:16"), or null before a chapter is open. */
export function activeReference(): string | null {
  const tab = bibleStore.getActiveTab();
  if (!tab || tab.book == null || tab.chapter == null) return null;
  const verse = tab.studyVerse ? tab.studyVerse % 1000 : undefined;
  return formatPassageRef(tab.book, tab.chapter, verse || undefined);
}

export function MemoryApp() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const headingId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;
    let handle: MemoryUiHandle | undefined;
    let off: (() => void) | undefined;
    let offAdded: (() => void) | undefined;
    let cancelled = false;
    // Mount once the UI language's catalog is in (English: at once); a language change re-mounts.
    // "Just added" is taken and listened for only after the mount, so an add made while the
    // catalog loads stays pending and reaches this mount instead of being lost.
    void loadMemoryTranslator(locale).then((memoryT) => {
      if (cancelled) return;
      try {
        const { api, subscribe } = getWebMemoryApi();
        handle = mountMemoryUi(container, {
          api,
          subscribe,
          activeReference: activeReference(),
          justAdded: takeJustAdded(),
          t: memoryT,
          locale,
        });
      } catch (e) {
        console.warn('[memory] could not start:', e);
        setFailed(true);
        return;
      }
      off = bibleStore.subscribe(() => handle?.setActiveReference(activeReference()));
      offAdded = onJustAdded((added) => handle?.offerPractice(added));
    });
    return () => {
      cancelled = true;
      off?.();
      offAdded?.();
      handle?.dispose();
    };
  }, [locale]);

  return (
    <section class="memory-app" data-app="memory" aria-labelledby={headingId}>
      <h1 id={headingId} tabIndex={-1} class="memory-app__title">{t('apps.memory.title', 'Memory')}</h1>
      <div ref={hostRef} class="memory-app__host" />
      {failed && <p role="alert">{t('apps.stage.error', 'This app could not be loaded.')}</p>}
    </section>
  );
}
