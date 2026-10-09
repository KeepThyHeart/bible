/**
 * The Memory app (task 0114): a host-drawn app bar above the DOM UI from `@bible/memory/ui`.
 * This file is a lazy chunk; it is the only place that imports the UI package.
 */
import React from 'react';
import { mountMemoryUi } from '@bible/memory/ui';
import type { MemoryUiHandle } from '@bible/memory/ui';
import { useI18n } from '../../contexts/useI18n';
import { translateWithDefault } from '../../utils/translateWithDefault';
import { AppIconGlyph } from '../../apps/AppIconGlyph';
import { appRegistry, openApp } from '../../apps/appHost';
import { resolveLabelRef } from '../../apps/navEntries';
import { subscribeActiveVerseBroadcast } from '../../extensions/activeVerseBroadcast';
import { formatVerseReference } from '../../utils/verseReference';
import { memoryClient } from './memoryClient';
import { memoryT } from './memoryT';
import { onMemoryCardsRequest, takePendingMemoryCards } from './memoryModule';

const BACK_BUTTON =
  'rounded px-sm text-xs text-text-secondary hover:bg-background-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export const MemoryAppView: React.FC = () => {
  const { t, i18n } = useI18n();
  const headingId = React.useId();
  const hostRef = React.useRef<HTMLDivElement>(null);
  const desc = appRegistry.get('memory');
  const title = desc ? resolveLabelRef(desc.title, t, i18n) : translateWithDefault(t, 'apps.memory.title', 'Memory');
  const icon = desc?.icon ?? { kind: 'builtin' as const, name: 'brain' };

  React.useEffect(() => {
    const container = hostRef.current;
    if (!container) return;
    const handle: MemoryUiHandle = mountMemoryUi(container, {
      api: memoryClient,
      subscribe: (listener) => memoryClient.on('push', listener),
      t: memoryT,
      locale: i18n.currentLocale,
      initialView: takePendingMemoryCards() ? 'card' : 'plan',
    });
    const offCards = onMemoryCardsRequest(() => handle.showCards());
    const offVerse = subscribeActiveVerseBroadcast((change) => handle.setActiveReference(formatVerseReference(change.verseId)));
    return () => {
      offVerse();
      offCards();
      handle.dispose();
    };
  }, [i18n.currentLocale]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-text-primary" data-app="memory" aria-labelledby={headingId}>
      <header className="flex h-8 shrink-0 items-center gap-sm border-b border-border bg-surface px-md text-sm">
        <span className="flex shrink-0 items-center" aria-hidden="true">
          <AppIconGlyph icon={icon} size={16} />
        </span>
        <h1 id={headingId} tabIndex={-1} className="m-0 truncate text-sm font-semibold text-text-heading">{title}</h1>
        <span className="flex-1" />
        <button type="button" className={BACK_BUTTON} onClick={() => void openApp('study')}>
          {translateWithDefault(t, 'apps.extension.backToStudy', 'Back to Study')}
        </button>
      </header>
      <div ref={hostRef} className="relative min-h-0 flex-1 overflow-auto" />
    </section>
  );
};

export default MemoryAppView;
