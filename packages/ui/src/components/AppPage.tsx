import type { ReactNode } from 'react';
import { Tabs, tabPanelProps } from './Tabs';
import type { TabItem } from './Tabs';

export interface AppPageProps {
  /** The page heading. Rendered as `h1[tabindex=-1]` so the host can move focus to it when the app opens. */
  title: string;
  /** Buttons at the end of the title row. */
  actions?: ReactNode;
  /** Sections of the page. When given, a tab bar is drawn under the title and `children` is the selected tab. */
  tabs?: TabItem[];
  /** Id of the selected tab. Default: the first tab. */
  tab?: string;
  onTabChange?: (id: string) => void;
  /** Accessible name of the tab bar. Default: the title. */
  tabsLabel?: string;
  /** Prefix for tab and panel ids. Default 'app-page'. */
  idPrefix?: string;
  /** The page content (with tabs: the selected tab's content). */
  children?: ReactNode;
  /** Let the content use the whole width instead of a reading-width column. */
  fullWidth?: boolean;
  /** Keep the tab bar at the top while the page scrolls (the title scrolls away). Default true; no effect without tabs. */
  stickyTabs?: boolean;
  className?: string;
  dir?: 'ltr' | 'rtl';
}

/**
 * The frame of an app page: title row (heading + actions), optional tab bar, content. It fills its container's
 * height and scrolls its content. The content column sits at the start edge with a reading-width cap (none with
 * `fullWidth`); spacing and widths live in `.kth-app-page*`, not in the apps.
 */
export function AppPage(props: AppPageProps) {
  const {
    title, actions, tabs, tab, onTabChange, tabsLabel, idPrefix = 'app-page', children, fullWidth, stickyTabs = true, className, dir,
  } = props;
  const hasTabs = !!tabs && tabs.length > 0;
  const selected = hasTabs ? (tabs.some((t) => t.id === tab) ? tab! : tabs[0].id) : null;
  const root = ['kth-app-page', fullWidth ? 'kth-app-page--full' : '', hasTabs && stickyTabs ? 'kth-app-page--sticky-tabs' : '']
    .filter(Boolean).join(' ');

  return (
    <div className={className ? `${root} ${className}` : root} dir={dir}>
      <div className="kth-app-page__column">
        <div className="kth-app-page__header">
          <h1 className="kth-app-page__title" tabIndex={-1}>{title}</h1>
          {actions ? <div className="kth-app-page__actions">{actions}</div> : null}
        </div>
        {hasTabs && selected !== null ? (
          <>
            <Tabs
              tabs={tabs}
              value={selected}
              onChange={(id) => onTabChange?.(id)}
              label={tabsLabel ?? title}
              idPrefix={idPrefix}
              className="kth-app-page__tabs"
              dir={dir}
            />
            <div className="kth-app-page__body" {...tabPanelProps(idPrefix, selected)}>{children}</div>
          </>
        ) : (
          <div className="kth-app-page__body">{children}</div>
        )}
      </div>
    </div>
  );
}
