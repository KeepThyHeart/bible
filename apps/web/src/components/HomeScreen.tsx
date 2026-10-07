import { useState, useEffect } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { useTranslation } from 'react-i18next';
import { bibleStore } from '../stores/bibleStore';
import { commentaryStore } from '../stores/commentaryStore';
import { searchStore } from '../stores/searchStore';
import { focusSearchField } from '../utils/focusSearchField';
import { sanitizeHtml } from '../utils/sanitize';
import type { VotdData } from '../providers/interfaces';
import { AppTileGrid } from '@bible/ui';
import { openApp, prefetchApp } from '../host/appHost';
import { useNavEntries } from '../host/appNavEntries';
import { useNavItems } from '../host/navPrefs';
import { modulePoints } from '../modules/moduleHost';
import type { NewTabTileContribution } from '@bible/core/browser';

interface HomeScreenProps {
  onNavigate?: (view: 'bible' | 'search') => void;
}

/** Link-style tiles: `home.watchPresentation` is a bare page, not an in-app route. */
function tileHref(tile: NewTabTileContribution): string | undefined {
  return 'commandId' in tile.target && tile.target.commandId === 'home.watchPresentation' ? '/watch' : undefined;
}

export function HomeScreen({ onNavigate }: HomeScreenProps) {
  const { t } = useTranslation();
  const [votd, setVotd] = useState<VotdData | null>(null);
  const appEntries = useNavEntries(useNavItems('tiles'));
  const tileEntries = useSyncExternalStore(
    modulePoints.newTabTiles.subscribe.bind(modulePoints.newTabTiles),
    modulePoints.newTabTiles.getSnapshot.bind(modulePoints.newTabTiles),
  );
  const tiles = tileEntries.map((e) => e.item).filter((tile) => !tile.platforms || tile.platforms.includes('web'));

  useEffect(() => {
    bibleStore.getVerseOfTheDay()
      .then(data => setVotd(data))
      .catch(() => {});
  }, []);

  const handleReadBible = () => {
    bibleStore.setShowHome(false);
    onNavigate?.('bible');
  };

  const handleSearch = () => {
    // Mark the search UI open so the desktop right-pane strip actually renders
    // (and highlights) the Search tab — it is gated on searchStore.isOpen, so
    // without this the pane switches to a mode with no matching tab and the
    // click reads as doing nothing.
    searchStore.open();
    commentaryStore.setRightPaneMode('search');
    commentaryStore.expand();
    onNavigate?.('search');
    // Desktop's only visible search input is the header field (the panel's own
    // input is display:none above 1024px). Focus it once the pane has rendered.
    // On mobile the header field is hidden, focusSearchField() no-ops, and the
    // panel's inline input remains the entry point.
    requestAnimationFrame(() => { focusSearchField(); });
  };

  const runTile = (tile: NewTabTileContribution) => {
    const target = tile.target;
    if ('panelType' in target) {
      // On web a panelType target is a right-pane mode id. Only search needs the
      // extra open/focus handling today.
      if (target.panelType === 'search') handleSearch();
      else {
        commentaryStore.setRightPaneMode(target.panelType as Parameters<typeof commentaryStore.setRightPaneMode>[0]);
        commentaryStore.expand();
      }
    } else if ('commandId' in target && target.commandId === 'home.readBible') {
      handleReadBible();
    } else if ('appId' in target) {
      void openApp(target.appId);
    }
  };

  return (
    <div class="home-screen">
      <div class="home-screen__header">
        <i class="fa-solid fa-book-bible home-screen__icon" />
        <h1 class="home-screen__title">{t('app.name')}</h1>
      </div>
      {/* Fixed-height slot: the skeleton occupies the same box as the loaded
          card, so the verse arriving never re-centers the column. */}
      <div class="home-screen__votd-slot">
        {votd && votd.text ? (
          <div
            class="home-screen__votd"
            onClick={() => bibleStore.navigateTo(votd.book, votd.chapter, votd.verse)}
          >
            <div class="home-screen__votd-label">
              {votd.holiday ? t('bibleContent.votdHoliday', { holiday: votd.holiday }) : t('bibleContent.votdLabel')}
            </div>
            <div
              class="home-screen__votd-text"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(votd.text_html || votd.text) }}
            />
            <div class="home-screen__votd-ref">
              {t(String(votd.book), { ns: 'books' })} {votd.chapter}:{votd.verse}
            </div>
          </div>
        ) : (
          <div
            class="home-screen__votd home-screen__votd--skeleton home-screen__loading"
            aria-hidden="true"
          >
            <div class="home-screen__skeleton-line home-screen__skeleton-line--label" />
            <div class="home-screen__skeleton-line" />
            <div class="home-screen__skeleton-line home-screen__skeleton-line--short" />
            <div class="home-screen__skeleton-line home-screen__skeleton-line--ref" />
          </div>
        )}
      </div>
      <div class="home-screen__actions">
        {tiles.map((tile, index) => {
          const label = 'key' in tile.title ? t(tile.title.key, tile.title.fallback) : '';
          const cls = `home-screen__action-btn${index === 0 ? ' home-screen__action-btn--primary' : ''}`;
          const iconName = tile.icon?.kind === 'builtin' ? tile.icon.name : undefined;
          const content = (
            <>
              {iconName && <i class={`fa-solid ${iconName}`} />}
              <span>{label}</span>
            </>
          );
          const href = tileHref(tile);
          if (href) {
            // A plain link, not a store action: `/watch` is a separate, bare page
            // (see `present/watch.html`), the same way the projection viewer is --
            // not a route this app itself renders. Someone handed a code by a
            // presenter, rather than a link or a QR code, starts here.
            return (
              <a key={tile.id} class={cls} href={href}>
                {content}
              </a>
            );
          }
          return (
            <button key={tile.id} class={cls} onClick={() => runTile(tile)}>
              {content}
            </button>
          );
        })}
      </div>
      {appEntries.length > 1 && (
        <section class="home-screen__apps" aria-labelledby="home-screen-apps-title">
          <h2 id="home-screen-apps-title" class="home-screen__apps-title">{t('apps.home.title', 'Apps')}</h2>
          <AppTileGrid
            items={appEntries}
            onSelect={(id) => { void openApp(id); }}
            onPrefetch={prefetchApp}
            labels={{ gridLabel: t('apps.home.title', 'Apps') }}
          />
        </section>
      )}
    </div>
  );
}
