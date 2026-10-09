import { bibleStore } from '../../stores/bibleStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { studyStore } from '../../stores/studyStore';
import { searchStore } from '../../stores/searchStore';
import { dictionaryStore } from '../../stores/dictionaryStore';
import { moduleStore } from '../../stores/moduleStore';
import { settingsStore } from '../../stores/settingsStore';
import { eventBus } from '../../events/eventBus';
import { initAutoDownload, runAutoCleanup } from '../../offline/autoDownloadManager';
import { offlineStorageManager } from '../../offline/sharedInstances';
import { isTagGraphEnabled } from '../../utils/clientConfig';
import { fireActivation } from '../../modules/moduleHost';
import { READER_BOOT_EVENT } from '../../modules/host/readerHooks';
import { preferredBible } from '../../host/preferredBible';
import { getOfflineBible } from '../../boot/offlineBible';
import { getSearchProvider } from '../../boot/searchProvider';
import type { ShellContext } from '../../boot/shellContext';

/**
 * Cap how long the boot splash can wait on one request. The chapter fetch is
 * awaited before the first paint, so a hung socket would otherwise leave
 * the user staring at the spinner indefinitely. navigateTo swallows its own
 * errors and sets tab.loadError, so rendering early is always safe.
 */
export function withBootTimeout(p: Promise<void>, ms = 8000): Promise<unknown> {
  return Promise.race([p, new Promise<void>(resolve => setTimeout(resolve, ms))]);
}

/**
 * Study's own boot (the Study binding's `activate`): initialises its stores and
 * resolves the active tab BEFORE first paint, so a returning user never sees the
 * home screen swapped for the Bible pane.
 */
export async function bootStudy(ctx: ShellContext): Promise<void> {
  const { providers, baseUrl } = ctx;

  // Everything that can fail or wait on the network runs before the first
  // `init` below, so a failed boot leaves nothing initialised and a retry
  // cannot repeat setup steps. Both are memoised and run in parallel.
  const [offlineBible, searchProvider] = await Promise.all([getOfflineBible(ctx), getSearchProvider(ctx)]);
  // The server's ui.defaultModule, applied by the shell. Not yet checked against
  // what is installed; see fallBackFromMissingModules below.
  bibleStore.init(offlineBible, settingsStore.getDefaultBible());
  preferredBible.setSource(bibleStore);

  // Auto-download manager (fire-and-forget lite downloads on translation use).
  // Left uninitialized when the server turns it off -- triggerAutoDownload and
  // runAutoCleanup both no-op without a manager, so that is the whole switch.
  if (ctx.offlineAutoDownload) initAutoDownload(offlineStorageManager, ctx.serverStaleDays);
  commentaryStore.init(providers.commentary, providers.studyOverview);
  studyStore.init({
    crossRef: providers.crossRef,
    topical: providers.topical,
    // Omitted entirely when the deployment has the tag graph turned off: the
    // store treats an absent provider as "no entities".
    tagGraph: isTagGraphEnabled() ? providers.tagGraph : undefined,
    interlinear: providers.interlinear,
    studyOverview: providers.studyOverview,
  });
  dictionaryStore.init(baseUrl);
  searchStore.init(searchProvider);

  // The reader is about to show: feature modules that live in it and wire themselves to the
  // offline Bible provider above may activate now.
  // Fire-and-forget, like their own loading; a module that is off does nothing.
  fireActivation(READER_BOOT_EVENT);

  // Now that the installed translations are known (the shell loaded the
  // manifest), move any tab that names one this server does not have onto the
  // default -- before anything below fetches it.
  bibleStore.fallBackFromMissingModules();

  // The first commentary tab waits for the manifest: which module it opens
  // depends on what this server actually offers.
  commentaryStore.openDefaultTab(moduleStore.getCommentaryModules());

  // Resolve the active tab BEFORE the first paint. Everything awaited here is
  // what the first frame depends on; background tabs and cleanup stay after.
  //
  // If the active tab already has cached verses from the session, render them
  // immediately without re-fetching -- this makes repeat visits near-instant.
  const restoredTab = bibleStore.getActiveTab();
  if (window.location.hash) {
    await withBootTimeout(bibleStore.navigateFromHash(window.location.hash));
  } else if (restoredTab && restoredTab.verses.length > 0) {
    // Session had cached verses -- render immediately, no fetch needed
    bibleStore.setShowHome(false);
    bibleStore.updateHash();
    // Restored tabs carry no study verse, and this path skips navigateTo -- so
    // establish one before the panes below bind to it.
    bibleStore.ensureStudyVerse();
    // Sync commentary pane to the restored chapter
    if (restoredTab.book && restoredTab.chapter) {
      eventBus.emit('commentary:load-chapter', { book: restoredTab.book, chapter: restoredTab.chapter });
    }
  } else if (restoredTab && !restoredTab.book) {
    await withBootTimeout(bibleStore.navigateTo(1, 1)); // Genesis 1
  } else if (restoredTab && restoredTab.book && restoredTab.chapter) {
    // Has book/chapter but no cached verses -- fetch them
    await withBootTimeout(bibleStore.navigateTo(restoredTab.book, restoredTab.chapter));
  }
}

/** Study's after-first-paint work: background tabs, cleanup. */
export function afterStudyFirstPaint(ctx: ShellContext): void {
  // Always load any restored tabs that don't have verses yet (e.g. background tabs)
  bibleStore.loadRestoredTabs();

  // Clean up stale auto-downloaded modules (fire-and-forget)
  runAutoCleanup().catch(() => {});
}
