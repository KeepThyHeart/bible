/**
 * The Presenter module's code (lazy chunk): what `activate()` adds to the
 * host while the module is active. It loads only when the Presenter opens,
 * its verse action runs, or the boot probe found a session or link to resume.
 *
 * - the session runtime (`presentStore`) and the app's busy flag / live badge;
 * - the Study integration through host slots: the send rail and word marks on
 *   verses, the highlight bar, the follow banner, the clicker keys;
 * - the verse search the command box shares with Study;
 * - following a `/present/f/<code>` link;
 * - the `reader.chapterRendered` hook: a follower who opens another chapter
 *   stops being pulled along.
 */
import './present.scss';
import i18n from 'i18next';
import type { Disposable, FeatureModuleContext, FeatureModuleExports } from '@bible/core/browser';
import { appRegistry, getShellContext } from '../../host/appHost';
import { getSearchProvider } from '../../boot/searchProvider';
import { readerOverlays, shellOverlays, studyBanners, verseDecorators } from '../../host/slots';
import { setVerseSearchProviderFactory } from './lib/command/searchProviders';
import { presentBoot } from './binding';
import { ensurePresenterRuntime, setPresenterBusySink } from './runtime';
import { followStore } from './stores/followStore';
import { presentStore } from './stores/presentStore';
import { FollowBanner } from './study/FollowBanner';
import { PresentReaderOverlay, PresenterKeysHost, presentVerseDecorator } from './study/integration';

const own = (fn: () => void): Disposable => ({ dispose: fn });

/** Re-render the reader only when something the verse marks read changed. */
function decorationKey(): string {
  const live = followStore.liveVerse;
  return [
    presentStore.session !== null,
    JSON.stringify(presentStore.wall?.live ?? null),
    presentStore.wall?.position.index ?? '',
    JSON.stringify(presentStore.wall?.position.highlights ?? null),
    JSON.stringify(presentStore.highlightDraft),
    live ? `${live.book}:${live.chapter}:${live.verse}:${JSON.stringify(live.highlights)}` : '',
  ].join('|');
}

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  const subs = ctx.subscriptions;

  setPresenterBusySink((busy) => {
    appRegistry.setBusy('present', busy);
    // A live dot on the rail / switcher (it replaces the header's old "presenting" highlight).
    appRegistry.setBadge('present', busy ? { kind: 'dot', tone: 'live', label: i18n.t('present.app.live') } : undefined);
  });
  subs.push(own(() => {
    setPresenterBusySink(null);
    appRegistry.setBusy('present', false);
    appRegistry.setBadge('present', undefined);
  }));

  // The Presenter's verse search shares Study's provider; built only on first use.
  setVerseSearchProviderFactory(() => getSearchProvider(getShellContext()));
  subs.push(own(() => setVerseSearchProviderFactory(null)));

  subs.push(
    verseDecorators.register(presentVerseDecorator),
    readerOverlays.register(PresentReaderOverlay),
    studyBanners.register(FollowBanner),
    shellOverlays.register(PresenterKeysHost),
  );
  let key = decorationKey();
  const refresh = () => {
    const next = decorationKey();
    if (next === key) return;
    key = next;
    verseDecorators.invalidate();
  };
  subs.push(own(presentStore.subscribe(refresh)), own(followStore.subscribe(refresh)));
  // Switched off at runtime: close a follow-along stream (its banner and marks are gone).
  subs.push(own(() => followStore.stop()));

  await ensurePresenterRuntime(presentBoot.adopted);

  // Follow-along (`/present/f/<code>`): the reader underneath renders as for any
  // other chapter, and `followStore` nudges it to the presenter's live reference.
  if (presentBoot.followCode) {
    followStore.start(presentBoot.followCode);
    presentBoot.followCode = null;
  }
}

export const hooks: FeatureModuleExports['hooks'] = {
  'reader.chapterRendered': () => followStore.noteReaderChapter(),
};
