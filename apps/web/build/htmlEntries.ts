/**
 * The client build's HTML entry points, and which of them the service worker
 * may precache.
 *
 * `index.html` is the app shell. The others are pages of the server feature
 * modules (presenter, games): their URLs are served by the module, and while it
 * is switched off they answer 404. Workbox installs a worker only when every
 * precache URL fetches, so one of these in the precache list made the install
 * fail on any site with present or games off -- the browser dropped the
 * registration and the PWA had no offline support (W-030).
 */

/** Rollup input name -> HTML file, relative to the app root. */
export const HTML_ENTRIES: Record<string, string> = {
  index: 'index.html',
  presentViewer: 'present/viewer.html',
  presentWatch: 'present/watch.html',
  presentSolo: 'present/solo.html',
  // The Games phone page: its own entry, so a phone loads no reader code.
  gamesPlay: 'games/play.html',
};

/** Precache globs to skip: every module page, i.e. every HTML entry but the shell. */
export const MODULE_PAGE_GLOBS: string[] = ['present/**/*.html', 'games/**/*.html'];
