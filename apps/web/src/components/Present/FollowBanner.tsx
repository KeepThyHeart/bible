import { useTranslation } from 'react-i18next';
import { useStore } from '../../hooks/useStore';
import { followStore } from '../../stores/followStore';
import { moduleStore } from '../../stores/moduleStore';
import { formatPassageRef } from '../../constants';
import { buildViewerLink } from '../../present/controlLink';

/**
 * The one piece of chrome `/present/f/<code>` adds to the ordinary reading
 * app: a strip saying what is being followed, and the two things a follower
 * can do about it -- stop, or (once stopped, or once they have wandered off
 * on their own) jump back.
 *
 * Deliberately not a route of its own or a different page: `followStore`
 * already drives `bibleStore.navigateTo` directly, so the app underneath this
 * banner is the ordinary reader, doing the ordinary thing, the whole time.
 */
export function FollowBanner() {
  const { t } = useTranslation();
  const active = useStore(followStore, () => followStore.active);
  const paused = useStore(followStore, () => followStore.paused);
  const wall = useStore(followStore, () => followStore.wall);
  const connection = useStore(followStore, () => followStore.connection);
  const closedReason = useStore(followStore, () => followStore.closedReason);
  const joinCode = useStore(followStore, () => followStore.joinCode);

  if (!active) return null;

  if (connection === 'closed') {
    return (
      <div class="follow-banner follow-banner--ended" role="status" aria-label={t('present.followBannerLabel')}>
        <span>{t('present.followEnded')}</span>
      </div>
    );
  }

  const live = wall?.live;
  const ref = live?.kind === 'passage'
    ? formatPassageRef(live.book, live.chapter, wall!.position.index || null, moduleStore.getBookName(live.book))
    : null;

  return (
    <div
      class={`follow-banner${paused ? ' follow-banner--paused' : ''}`}
      role="status"
      aria-label={t('present.followBannerLabel')}
    >
      <span class="follow-banner__dot" aria-hidden="true" />
      <span class="follow-banner__label">
        {ref
          ? (paused ? t('present.pausedLabel', { ref }) : t('present.followingLabel', { ref }))
          : t('present.followingWaiting')}
      </span>
      <span class="follow-banner__actions">
        {paused
          ? (
            <button type="button" class="follow-banner__button" onClick={() => followStore.resume()}>
              {t('present.backToLive')}
            </button>
          )
          : (
            <button type="button" class="follow-banner__button" onClick={() => followStore.stopFollowing()}>
              {t('present.stopFollowing')}
            </button>
          )}
        {joinCode && (
          <a
            class="follow-banner__link"
            href={buildViewerLink(joinCode)}
            target="_blank"
            rel="noopener"
          >
            {t('present.openScreenViewInstead')}
          </a>
        )}
      </span>
    </div>
  );
}
