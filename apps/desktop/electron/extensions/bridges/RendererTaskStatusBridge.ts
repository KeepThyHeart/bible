/**
 * Production `IExtensionTaskStatusBridge`.
 *
 * `ITasksApi.run` documents "the host shows a progress entry in the status
 * bar", and until now nothing did: `taskStatusBridge` was an optional
 * constructor field `main.ts` never supplied, so `TasksApiImpl.notifyStatus`
 * always found it absent and no update ever left the api-impl.
 *
 * This bridge closes that gap by piggy-backing on the existing T2 status bar
 * surface (`ui.registerStatusBarItem` / `IExtensionUiBridge`) rather than
 * inventing a second, parallel status-bar widget: one active task becomes one
 * synthetic status bar item, keyed `__task.<taskId>` so it cannot collide
 * with an id the extension registers itself through `ui.registerStatusBarItem`
 * (real status bar item ids come from the extension author and are never
 * required to start with `__`). `RendererUiBridge.registerStatusBarItem`
 * already replaces-by-key on every call - the same "last write wins, keyed by
 * id" contract `UiApiImpl.registerOrReplaceStatusBarItem` relies on for the
 * T2 API - so repeated progress updates for the same task id are cheap and
 * never stack up disposers; only actually-removed tasks need an explicit
 * disposer call.
 */

import type { Extensions } from '@bible/core';

import type { IExtensionUiBridge } from '../api-impl/IExtensionDataBridges';
import type { IExtensionTaskStatusBridge } from '../api-impl/tasksApiImpl';

type BackgroundTaskInfo = Extensions.BackgroundTaskInfo;
type LocalizedString = Extensions.LocalizedString;
type StatusBarItemDescriptor = Extensions.StatusBarItemDescriptor;

const TASK_ITEM_ID_PREFIX = '__task.';

export class RendererTaskStatusBridge implements IExtensionTaskStatusBridge {
  private readonly uiBridge: IExtensionUiBridge;
  /** `${extensionId}::${taskId}` -> disposer for that task's status bar item. */
  private readonly disposers = new Map<string, () => void>();

  constructor(uiBridge: IExtensionUiBridge) {
    this.uiBridge = uiBridge;
  }

  onTaskUpdate(extensionId: string, snapshot: BackgroundTaskInfo[]): void {
    const stillPresent = new Set<string>();
    for (const task of snapshot) {
      const trackingKey = `${extensionId}::${task.id}`;
      stillPresent.add(trackingKey);
      const item: StatusBarItemDescriptor = {
        id: `${TASK_ITEM_ID_PREFIX}${task.id}`,
        text: taskDisplayText(task),
        alignment: 'right',
        // Below the default (500) so an extension's own status bar items -
        // which usually communicate something more specific to that
        // extension - are not routinely pushed aside by a generic "running"
        // indicator every task briefly produces.
        priority: 10,
      };
      const disposer = this.uiBridge.registerStatusBarItem(extensionId, item);
      // Registering again for a task already being shown just refreshed the
      // bridge's entry in place (see the file header) - drop the previous
      // disposer without invoking it, same reasoning as
      // `UiApiImpl.registerOrReplaceStatusBarItem`.
      this.disposers.set(trackingKey, disposer);
    }
    // Anything tracked for this extension that is no longer in the snapshot
    // (settled, or the api-impl's own "started" -> "removed on settle"
    // lifecycle) loses its status bar item.
    for (const [trackingKey, disposer] of [...this.disposers]) {
      if (trackingKey.startsWith(`${extensionId}::`) && !stillPresent.has(trackingKey)) {
        disposer();
        this.disposers.delete(trackingKey);
      }
    }
  }

  clearTasksForExtension(extensionId: string): void {
    for (const [trackingKey, disposer] of [...this.disposers]) {
      if (trackingKey.startsWith(`${extensionId}::`)) {
        disposer();
        this.disposers.delete(trackingKey);
      }
    }
  }
}

/**
 * Compose "<title> — 45% — mixing" from a task snapshot.
 *
 * `title` is a `LocalizedString`, which the main process cannot resolve (that
 * needs the renderer's `I18nService`, and there is no request/response round
 * trip in this fire-and-forget path to ask for one). A plain-string title -
 * by far the common case for a background task's title, which is usually
 * generated at call time ("Rebuilding search index") rather than looked up
 * from a catalog - passes through untouched. A catalog-key title degrades to
 * showing only the progress fields, rather than stringifying the object or
 * throwing; the alternative (plumbing a resolved string through
 * `tasks.run` itself) would require the extension to resolve its own title
 * before calling `run`, which is a bigger API change than this gap justifies.
 */
function taskDisplayText(task: BackgroundTaskInfo): LocalizedString {
  const titleText = typeof task.title === 'string' ? task.title : undefined;
  const pct =
    task.progress?.total !== undefined && task.progress.total > 0
      ? Math.round((task.progress.current / task.progress.total) * 100)
      : undefined;
  const parts = [titleText, pct !== undefined ? `${pct}%` : undefined, task.progress?.message].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length > 0 ? parts.join(' — ') : 'Working…';
}
