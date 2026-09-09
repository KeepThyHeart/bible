/**
 * The application status bar.
 *
 * **Why this exists.** `ui:status-bar` has been a defined permission since the
 * extension API shipped, `ITasksApi.run` documents that "the host shows a
 * progress entry in the status bar", and `packages/word-count-example` — the
 * platform's only reference extension — exists for the sole purpose of writing
 * to it. There was no status bar. Three unrelated consumers assumed a surface
 * that did not exist, and an extension writing to it got a valid handle and
 * silence.
 *
 * **It costs nothing until something uses it.** With no registered items the
 * component renders `null`, so the app's chrome is unchanged for every user
 * who has no extension contributing one. That is the mitigation for the one
 * real risk here: this adds a permanent strip to a shipping app's layout, and
 * a strip that is empty most of the time would be a tax on everyone to serve
 * a few.
 *
 * Items are placed by `alignment` into a leading and a trailing slot and
 * ordered within each by `priority`, descending — higher priority sits nearer
 * the outer edge, which is the convention every editor status bar uses.
 *
 * Not rendered in detached windows in v1: a popped-out pane is a single
 * document surface, and a second copy of the app's global status would be
 * noise. See `docs/features/status-bar.md`.
 */

import React from 'react';

import { useI18n } from '../contexts/useI18n';
import { useAppServices } from '../contexts/ContextProvider';
import {
  useExtensionUiStore,
  type ExtensionStatusBarItem,
} from '../extensions/extensionUiStore';

/** Sort by priority descending, then by id so equal priorities are stable. */
function byPriority(a: ExtensionStatusBarItem, b: ExtensionStatusBarItem): number {
  const pa = a.item.priority ?? 0;
  const pb = b.item.priority ?? 0;
  if (pa !== pb) return pb - pa;
  return a.key.localeCompare(b.key);
}

interface StatusBarEntryProps {
  entry: ExtensionStatusBarItem;
}

const StatusBarEntry: React.FC<StatusBarEntryProps> = ({ entry }) => {
  const { i18n } = useI18n();
  const { registry } = useAppServices();
  const { item } = entry;

  const label = i18n.resolve(item.text);
  const tooltip = item.tooltip !== undefined ? i18n.resolve(item.tooltip) : undefined;

  // An item with no command is a readout, not a control, so it must not look
  // or behave like a button - no hover affordance, no tab stop, no role.
  if (!item.command) {
    return (
      <span
        className="px-2 py-0.5 text-xs text-text-secondary whitespace-nowrap"
        {...(tooltip !== undefined ? { title: tooltip } : {})}
        data-testid={`status-bar-item-${item.id}`}
      >
        {label}
      </span>
    );
  }

  const command = item.command;
  return (
    <button
      type="button"
      onClick={() => {
        // An extension's command failing is the extension's problem to report;
        // it must not surface as an unhandled rejection in the app's console
        // or take the status bar down with it.
        void registry.execute(command).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`[StatusBar] command '${command}' failed`, err);
        });
      }}
      className="px-2 py-0.5 text-xs text-text-secondary hover:bg-background-hover rounded transition-colors whitespace-nowrap cursor-pointer"
      {...(tooltip !== undefined ? { title: tooltip } : {})}
      data-testid={`status-bar-item-${item.id}`}
    >
      {label}
    </button>
  );
};

export const StatusBar: React.FC = () => {
  const { t } = useI18n();
  const items = useExtensionUiStore((s) => s.statusBarItems);

  const { leading, trailing } = React.useMemo(() => {
    const lead: ExtensionStatusBarItem[] = [];
    const trail: ExtensionStatusBarItem[] = [];
    for (const entry of items) {
      // `alignment` defaults to 'left': an item that does not say where it
      // wants to be is more likely a readout than a control.
      (entry.item.alignment === 'right' ? trail : lead).push(entry);
    }
    return { leading: lead.sort(byPriority), trailing: trail.sort(byPriority) };
  }, [items]);

  // The whole point of the empty case: no items, no chrome.
  if (items.length === 0) return null;

  return (
    <footer
      className="flex-shrink-0 border-t border-border bg-surface-secondary flex items-center justify-between gap-2 px-2 h-6 overflow-hidden"
      role="status"
      aria-label={t('ui.statusBar.label')}
      data-testid="status-bar"
    >
      <div className="flex items-center gap-1 min-w-0 overflow-hidden">
        {leading.map((entry) => (
          <StatusBarEntry key={entry.key} entry={entry} />
        ))}
      </div>
      <div className="flex items-center gap-1 min-w-0 overflow-hidden">
        {trailing.map((entry) => (
          <StatusBarEntry key={entry.key} entry={entry} />
        ))}
      </div>
    </footer>
  );
};

export default StatusBar;
