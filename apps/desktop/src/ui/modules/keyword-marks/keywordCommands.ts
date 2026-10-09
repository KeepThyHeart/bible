/**
 * Keyword marks commands (task 0065, moved into the feature module in 0127): `bible.toggleKeywordMarks`
 * (Ctrl+Shift+K). Registered by the module host while the module is on; the store loads on first use.
 */

import type { ICommandRegistry } from '../../services/ICommandRegistry';
import type { IDisposable } from '../../types/Command';
import { useBibleStore } from '../../stores/useBibleStore';
import { useLayoutStore } from '../../stores/useLayoutStore';

/** The tab id of the Bible pane the reader was last in (the primary pane when none has been focused). */
export function activeBibleTabId(): string | undefined {
  const panels = useBibleStore.getState().panels; // allow-getstate: command handler, not render
  const panelId = useLayoutStore.getState().lastActiveBiblePanelId ?? panels.keys().next().value; // allow-getstate: command handler
  const panel = panelId ? panels.get(panelId) : undefined;
  return panel?.openTabs[panel.activeTabIndex]?.tabId;
}

export function registerKeywordCommands(registry: ICommandRegistry): IDisposable[] {
  return [
    registry.register({
      id: 'bible.toggleKeywordMarks',
      title: { key: 'bible.toggleKeywordMarks' },
      category: { key: 'bible.toggleKeywordMarks.category' },
      shortcut: { key: 'Ctrl+Shift+K', mac: 'Cmd+Shift+K' },
      aliases: [{ key: 'bible.toggleKeywordMarks.alias.0' }, { key: 'bible.toggleKeywordMarks.alias.1' }],
      handler: async () => {
        const tabId = activeBibleTabId();
        if (!tabId) return;
        const { useKeywordMarkStore } = await import('./useKeywordMarkStore'); // keeps the store out of the entry chunk
        useKeywordMarkStore.getState().toggleTab(tabId); // allow-getstate: command handler
      },
    }),
  ];
}
