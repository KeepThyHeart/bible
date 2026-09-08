/**
 * The Help panel - what the header's `?` opens.
 *
 * The button opens a panel that lists every help destination, and the guided
 * tour is one item on it. Starting the tour directly would make the one
 * obvious "I need help" affordance in the window mean exactly one thing, and
 * the wrong one for most of the moments a reader reaches for it: someone who
 * wants to look something up would get a five-step walkthrough of panes they
 * can already see, and the in-app documentation, the keyboard shortcuts and
 * the docs site would have no entry point outside the native menu bar.
 *
 * Everything here dispatches the same `command:*` DOM events the native menu
 * and the command palette use, so there is one code path per action and no
 * behaviour to keep in sync - the same rule `HeaderActions` follows.
 *
 * Two entries are build-configured and are simply absent when this build has
 * not set them (see `electron/config/appConfig.ts`):
 *
 *  - `BIBLE_DOCS_URL` - the documentation website. An entry that opens nothing
 *    is worse than no entry, so an unset URL removes the row rather than
 *    showing a disabled one.
 *  - `BIBLE_ABOUT_TEXT` - a sentence or two about the app, shown at the top.
 */
import React, { useEffect, useRef } from 'react';
import { useI18n } from '../contexts/useI18n';
import {
  getAboutText,
  getAppConfig,
  getDocsUrl,
  getIssueReportUrl,
  getProductName,
} from '../config/appConfig';

export interface HelpPanelProps {
  onClose: () => void;
}

/** Hands a URL to the OS browser via the main process. */
function openExternal(url: string): void {
  const w = window as unknown as {
    electron?: { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
  };
  void w.electron?.ipcRenderer?.invoke('app:open-external', url);
}

interface HelpItem {
  id: string;
  label: string;
  description: string;
  /** Marks a row that leaves the app, so the panel can say so. */
  external?: boolean;
  onSelect: () => void;
}

const HelpPanel: React.FC<HelpPanelProps> = ({ onClose }) => {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);

  const dispatch = (name: string): void => {
    onClose();
    window.dispatchEvent(new CustomEvent(name));
  };

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const current = items.findIndex(el => el === document.activeElement);
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowDown': next = current < 0 ? 0 : (current + 1) % items.length; break;
      case 'ArrowUp': next = current <= 0 ? items.length - 1 : current - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      default: return;
    }
    e.preventDefault();
    if (next !== null) items[next].focus();
  };

  const docsUrl = getDocsUrl();
  const issueUrl = getIssueReportUrl();
  const aboutText = getAboutText();
  const { appVersion } = getAppConfig();

  const items: HelpItem[] = [
    {
      id: 'documentation',
      label: t('helpPanel.documentation'),
      description: t('helpPanel.documentationHint'),
      onSelect: () => dispatch('command:app:openDocumentation'),
    },
    {
      id: 'tour',
      label: t('helpPanel.tour'),
      description: t('helpPanel.tourHint'),
      onSelect: () => dispatch('command:app:startTour'),
    },
    {
      id: 'shortcuts',
      label: t('helpPanel.shortcuts'),
      description: t('helpPanel.shortcutsHint'),
      onSelect: () => dispatch('command:app:openKeyboardShortcuts'),
    },
  ];

  if (docsUrl) {
    items.push({
      id: 'docsSite',
      label: t('helpPanel.docsSite'),
      description: docsUrl,
      external: true,
      onSelect: () => {
        onClose();
        openExternal(docsUrl);
      },
    });
  }

  if (issueUrl) {
    items.push({
      id: 'reportIssue',
      label: t('helpPanel.reportIssue'),
      description: t('helpPanel.reportIssueHint'),
      external: true,
      onSelect: () => dispatch('command:app:reportIssue'),
    });
  }

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={t('helpPanel.label')}
      data-testid="help-panel"
      onKeyDown={handleKeyDown}
      className="absolute end-0 top-full mt-1 z-50 w-80 bg-surface border border-border-secondary rounded-md shadow-lg py-1"
    >
      {/* The blurb is the maintainer's own words about the build, so it is not
          translated - it arrives as one already-written string. */}
      {aboutText && (
        <>
          <div className="px-4 py-2 text-xs text-text-secondary leading-relaxed">{aboutText}</div>
          <div className="border-t border-border my-1" />
        </>
      )}

      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={item.onSelect}
          className="w-full px-4 py-2 text-start hover:bg-background-hover transition-colors"
        >
          <span className="flex items-center gap-1.5 text-sm text-text-primary">
            {item.label}
            {item.external && (
              <svg
                className="w-3 h-3 flex-shrink-0 text-text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
                focusable="false"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 01-1 1H6a1 1 0 01-1-1V7a1 1 0 011-1h4" />
              </svg>
            )}
          </span>
          <span className="block text-xs text-text-secondary truncate">{item.description}</span>
        </button>
      ))}

      <div className="border-t border-border my-1" />
      <div className="px-4 py-1.5 text-[11px] text-text-muted">
        {appVersion
          ? t('helpPanel.versionLine', { product: getProductName(), version: appVersion, })
          : getProductName()}
      </div>
    </div>
  );
};

export default HelpPanel;
