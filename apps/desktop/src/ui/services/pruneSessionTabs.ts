/**
 * Drop restored tabs whose module is no longer installed.
 *
 * A saved session names the modules it had open. Restoring one on a machine
 * where a module is gone - uninstalled, never downloaded, or a fresh install
 * carrying a session over - would open a tab, then ask the main process for
 * content from a module that is not there and log an error per request. The
 * tab itself is useless too: it can only ever show "not found". Pruning before
 * the restore keeps both out.
 */

interface TabLike {
  abbreviation: string;
}

interface TabbedSession {
  openTabs?: TabLike[];
  activeTabIndex?: number;
  /** Book/dictionary panes: strip order, by type + abbreviation. */
  tabOrder?: Array<{ type: string; abbreviation: string }>;
  [key: string]: unknown;
}

/**
 * A copy of `session` holding only tabs whose abbreviation is in `installed`.
 *
 * Active tab: kept when it survives, otherwise the nearest surviving tab at or
 * before its position. Per-tab maps (`currentEntryByTab`, `currentSectionByTab`,
 * `browseModeByTab`) lose the dropped modules' entries. Returns `session`
 * itself when nothing needed dropping, so callers can compare by identity.
 *
 * @param installed Abbreviations that can be opened now, or `null` when they
 *   could not be listed - in which case nothing is pruned, since guessing wrong
 *   would discard the reader's tabs.
 * @param type Which strip entries (`tabOrder`) belong to this session.
 */
export function pruneSessionTabs<T extends TabbedSession>(
  session: T | undefined | null,
  installed: ReadonlySet<string> | null,
  type?: 'book' | 'dictionary',
): T | undefined | null {
  if (!session || !installed || !session.openTabs || session.openTabs.length === 0) return session;

  const kept = session.openTabs.filter(tab => installed.has(tab.abbreviation));
  const dropped = session.openTabs.filter(tab => !installed.has(tab.abbreviation)).map(tab => tab.abbreviation);
  if (dropped.length === 0) return session;

  const activeTab = session.openTabs[session.activeTabIndex ?? 0];
  const activeIndex = activeTab ? kept.findIndex(tab => tab.abbreviation === activeTab.abbreviation) : -1;
  let nextActive = activeIndex;
  if (nextActive < 0) {
    // Nearest survivor at or before the old position, else the first.
    const before = session.openTabs
      .slice(0, (session.activeTabIndex ?? 0) + 1)
      .filter(tab => installed.has(tab.abbreviation));
    const anchor = before[before.length - 1];
    nextActive = anchor ? kept.findIndex(tab => tab.abbreviation === anchor.abbreviation) : 0;
  }

  const result: TabbedSession = { ...session, openTabs: kept, activeTabIndex: Math.max(0, nextActive) };

  for (const key of ['currentEntryByTab', 'currentSectionByTab', 'browseModeByTab']) {
    const map = session[key];
    if (map && typeof map === 'object') {
      result[key] = Object.fromEntries(Object.entries(map as Record<string, unknown>).filter(([abbr]) => !dropped.includes(abbr)));
    }
  }
  if (session.tabOrder) {
    result.tabOrder = session.tabOrder.filter(ref => !(type ? ref.type === type : true) || !dropped.includes(ref.abbreviation));
  }
  return result as T;
}
