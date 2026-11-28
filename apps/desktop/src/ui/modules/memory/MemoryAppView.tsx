/**
 * The Memory app (task 0114): the DOM UI from `@bible/memory/ui`, which draws the same app-page frame as
 * the other apps (title, tabs, start-aligned column). The host adds "Back to Study" to its title row.
 * This file is a lazy chunk; it is the only place that imports the UI package.
 */
import React from 'react';
import { mountMemoryUi } from '@bible/memory/ui';
import { mountVerseSelector } from '@bible/ui';
import type { MemoryUiHandle } from '@bible/memory/ui';
import { useI18n } from '../../contexts/useI18n';
import { translateWithDefault } from '../../utils/translateWithDefault';
import { appRegistry, openApp } from '../../apps/appHost';
import { resolveLabelRef } from '../../apps/navEntries';
import { subscribeActiveVerseBroadcast } from '../../extensions/activeVerseBroadcast';
import { formatVerseReference } from '../../utils/verseReference';
import { memoryClient } from './memoryClient';
import { memoryT } from './memoryT';
import { onMemoryCardsRequest, onMemoryPracticeRequest, takePendingMemoryCards, takePendingMemoryPractice } from './memoryModule';

export const MemoryAppView: React.FC = () => {
  const { t, i18n } = useI18n();
  const hostRef = React.useRef<HTMLDivElement>(null);
  const desc = appRegistry.get('memory');
  const title = desc ? resolveLabelRef(desc.title, t, i18n) : translateWithDefault(t, 'apps.memory.title', 'Memory');

  React.useEffect(() => {
    const container = hostRef.current;
    if (!container) return;
    const handle: MemoryUiHandle = mountMemoryUi(container, {
      api: memoryClient,
      subscribe: (listener) => memoryClient.on('push', listener),
      t: memoryT,
      locale: i18n.currentLocale,
      verseSelector: { mount: mountVerseSelector },
      initialView: takePendingMemoryCards() ? 'card' : 'plan',
      title,
      actions: [{ label: translateWithDefault(t, 'apps.extension.backToStudy', 'Back to Study'), onClick: () => void openApp('study') }],
      initialPractice: takePendingMemoryPractice() ?? undefined,
    });
    const offCards = onMemoryCardsRequest(() => handle.showCards());
    const offPractice = onMemoryPracticeRequest((id) => handle.practice(id));
    const offVerse = subscribeActiveVerseBroadcast((change) => handle.setActiveReference(formatVerseReference(change.verseId)));
    return () => {
      offVerse();
      offCards();
      offPractice();
      handle.dispose();
    };
  }, [i18n.currentLocale, title]);

  return (
    <section className="h-full min-h-0 bg-background text-text-primary" data-app="memory" aria-label={title}>
      <div ref={hostRef} className="relative h-full min-h-0" />
    </section>
  );
};

export default MemoryAppView;
