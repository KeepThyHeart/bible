/**
 * Application-shell commands: preferences, about, documentation, dev tools,
 * report-issue, keyboard shortcuts dialog.
 *
 * Most of these dispatch a DOM CustomEvent that App.tsx listens for and
 * routes to the appropriate React state setter (showPreferences,
 * showAbout, etc.). This keeps the command modules free of React state
 * coupling while preserving the existing UI flow.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { getAppConfig, isIssueReportingConfigured } from '../config/appConfig';

// Vite replaces `import.meta.env.DEV` with a literal at build time. The
// renderer tsconfig doesn't pull in `vite/client`, so declare just the member
// we use rather than taking a dependency on those ambient types.
declare global {
  interface ImportMeta {
    readonly env: { readonly DEV: boolean };
  }
}

function dispatchAppEvent(name: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
}

export function registerAppCommands(registry: ICommandRegistry): IDisposable[] {
  const disposables: IDisposable[] = [
    registry.register({
      id: 'app.openPreferences',
      title: { key: 'app.openPreferences' },
      category: { key: 'app.openPreferences.category' },
      shortcut: { key: 'Ctrl+,', mac: 'Cmd+,' },
      handler: () => dispatchAppEvent('command:app:openPreferences'),
    }),
    registry.register({
      id: 'app.openKeyboardShortcuts',
      title: { key: 'app.openKeyboardShortcuts' },
      category: { key: 'app.openKeyboardShortcuts.category' },
      shortcut: { key: 'Ctrl+/', mac: 'Cmd+/' },
      handler: () => dispatchAppEvent('command:app:openKeyboardShortcuts'),
    }),
    registry.register({
      id: 'app.openDocumentation',
      title: { key: 'app.openDocumentation' },
      category: { key: 'app.openDocumentation.category' },
      handler: () => dispatchAppEvent('command:app:openDocumentation'),
    }),
    // Re-runnable on demand, forever - the tour is a reference, not a
    // one-time gate, and a user who dismissed it on day one may well want it
    // on day thirty.
    registry.register({
      id: 'app.startTour',
      title: { key: 'app.startTour' },
      category: { key: 'app.startTour.category' },
      handler: () => dispatchAppEvent('command:app:startTour'),
    }),
    registry.register({
      id: 'app.about',
      title: { key: 'app.about' },
      category: { key: 'app.about.category' },
      handler: () => dispatchAppEvent('command:app:openAbout'),
    }),
    // Manual "Check for Updates". User-initiated only - this merely
    // opens the dialog; the dialog shows the host and requires a confirm before
    // any network request, and is blocked when offline mode is on.
    registry.register({
      id: 'app.checkForUpdates',
      title: { key: 'app.checkForUpdates' },
      category: { key: 'app.checkForUpdates.category' },
      handler: () => dispatchAppEvent('command:app:checkForUpdates'),
    }),
  ];

  // `app.toggleDevTools` is a developer affordance, not a feature: a consumer
  // build should not advertise "Toggle Developer Tools" in the View menu or the
  // command palette. Registering it only in development keeps the
  // Ctrl+Shift+I accelerator working while you're running the dev server, and
  // drops both the menu entry and the palette entry from packaged builds -
  // `buildMenuSpec` omits items whose command isn't registered.
  if (import.meta.env.DEV) {
    disposables.push(
      registry.register({
        id: 'app.toggleDevTools',
        title: { key: 'app.toggleDevTools' },
        category: { key: 'app.toggleDevTools.category' },
        shortcut: { key: 'Ctrl+Shift+I', mac: 'Alt+Cmd+I' },
        handler: () => dispatchAppEvent('command:app:toggleDevTools'),
      }),
    );
  }

  // `app.reportIssue` opens the maintainer's external issue tracker (or a
  // mailto: address). No target is configured by default, and a command that
  // opens a dead link is worse than one that isn't there - so we only register
  // it when the build supplies `BIBLE_ISSUE_REPORT_URL`. Unregistered commands
  // are invisible to both the command palette and `buildMenuSpec`.
  // NOTE: this is distinct from `help.reportIssue`, the in-app diagnostics
  // dialog registered by `diagnosticsCommands.ts`.
  if (isIssueReportingConfigured(getAppConfig())) {
    disposables.push(
      registry.register({
        id: 'app.reportIssue',
        title: { key: 'app.reportIssue' },
        category: { key: 'app.reportIssue.category' },
        handler: () => dispatchAppEvent('command:app:reportIssue'),
      }),
    );
  }

  return disposables;
}
