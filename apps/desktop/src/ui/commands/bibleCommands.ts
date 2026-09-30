/**
 * Bible-pane commands. Initial scaffold; menu/shortcut additions are pulled
 * in as the BiblePane component is migrated to dispatch through the registry.
 *
 * Examples this module will eventually own: open verse in commentary,
 * toggle parallel view, switch display mode, copy verse with formatting,
 * navigate prev/next chapter, jump to verse, etc.
 *
 * Today: `bible.toggleKeywordMarks` (Ctrl+Shift+K), keyword marks (task 0065).
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { useBibleStore } from '../stores/useBibleStore';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useKeywordMarkStore } from '../stores/useKeywordMarkStore';

/** The tab id of the Bible pane the reader was last in (the primary pane when none has been focused). */
export function activeBibleTabId(): string | undefined {
  const panels = useBibleStore.getState().panels; // allow-getstate: command handler, not render
  const panelId = useLayoutStore.getState().lastActiveBiblePanelId ?? panels.keys().next().value; // allow-getstate: command handler
  const panel = panelId ? panels.get(panelId) : undefined;
  return panel?.openTabs[panel.activeTabIndex]?.tabId;
}

export function registerBibleCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'bible.toggleKeywordMarks',
      title: { key: 'bible.toggleKeywordMarks' },
      category: { key: 'bible.toggleKeywordMarks.category' },
      shortcut: { key: 'Ctrl+Shift+K', mac: 'Cmd+Shift+K' },
      aliases: [{ key: 'bible.toggleKeywordMarks.alias.0' }, { key: 'bible.toggleKeywordMarks.alias.1' }],
      handler: () => {
        const tabId = activeBibleTabId();
        if (tabId) useKeywordMarkStore.getState().toggleTab(tabId); // allow-getstate: command handler
      },
    }),
  ];
}
