import React from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import BiblePane from './BiblePane';
import CommentaryPane from './CommentaryPane';
import BookPane from './BookPane';
import NewTabPage from './NewTabPage';
import PaneErrorBoundary from './PaneErrorBoundary';

// Everything below is split out of the first-paint bundle. Bible,
// Commentary, Book and NewTab stay eager because the default layout mounts
// them; the rest are panes the reader has to go and open. The notes panes in
// particular drag the whole TipTap/ProseMirror editor stack (~1MB) behind them,
// which nobody is typing into on the first frame.
const UserNotesPane = React.lazy(() => import('./notes/UserNotesPane'));
const PrayerTab = React.lazy(() => import('./notes/tabs/PrayerTab'));
const StudyPane = React.lazy(() => import('./StudyPane'));
const TopicsPane = React.lazy(() => import('./TopicsPane'));
const SearchResultsPane = React.lazy(() => import('./SearchResultsPane'));
const CommentarySinglePanel = React.lazy(() => import('./commentary/CommentarySinglePanel'));
const BookSinglePanel = React.lazy(() => import('./book/BookSinglePanel'));
const DictionarySinglePanel = React.lazy(() => import('./dictionary/DictionarySinglePanel'));
const ExtensionPanelHost = React.lazy(() => import('./extensions/ExtensionPanelHost'));

/** Fills the pane while a lazily-loaded pane module is in flight. */
const PaneLoading: React.FC = () => (
  <div className="h-full w-full" aria-hidden="true" style={{ backgroundColor: 'var(--theme-bg-primary)' }} />
);
import type { PanelContentType } from '../stores/useLayoutStore';
import { useI18n } from '../contexts/useI18n';

/**
 * Built-in (host-supplied) panel content types. Extension-contributed
 * `ext:*` panels are routed separately to ExtensionPanelHost.
 */
type BuiltinPanelContentType = Exclude<PanelContentType, `ext:${string}`>;

/**
 * Maps content types to their full multi-tab React components.
 */
const CONTENT_COMPONENTS: Record<BuiltinPanelContentType, React.ComponentType<any>> = {
  bible: BiblePane,
  commentary: CommentaryPane,
  book: BookPane,
  dictionary: BookPane,
  notes: UserNotesPane,
  prayer: PrayerTab,
  search: SearchResultsPane,
  study: StudyPane,
  topics: TopicsPane,
  newtab: NewTabPage,
};

/**
 * Dockview panel component that renders the appropriate content
 * based on the panel's contentType parameter.
 *
 * When contentKey is provided for commentary, renders the lightweight
 * CommentarySinglePanel instead of the full CommentaryPane.
 */
const PanelContentRenderer: React.FC<IDockviewPanelProps<{
  contentType: PanelContentType;
  contentKey?: string;
}>> = (props) => {
  const { t } = useI18n();
  const { params, api } = props;
  const { contentType, contentKey } = params;

  // Route extension-contributed panels (`ext:<extId>.<panelTypeId>`) to the
  // ExtensionPanelHost iframe.
  if (typeof contentType === 'string' && contentType.startsWith('ext:')) {
    const rest = contentType.slice('ext:'.length);
    const dotIdx = rest.indexOf('.');
    if (dotIdx > 0) {
      const extensionId = rest.slice(0, dotIdx);
      const panelTypeId = rest.slice(dotIdx + 1);
      return (
        <div className="h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
          <PaneErrorBoundary paneName={contentType}>
            <React.Suspense fallback={<PaneLoading />}>
            <ExtensionPanelHost
              extensionId={extensionId}
              panelTypeId={panelTypeId}
              panelId={api.id}
            />
          </React.Suspense>
          </PaneErrorBoundary>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--theme-text-secondary)' }}>
        <span>{t('panelContentRenderer.malformedExtensionPanelContentType', { v1: contentType })}</span>
      </div>
    );
  }

  // Route to single-item panels when contentKey is provided
  if (contentKey) {
    if (contentType === 'commentary') {
      return (
        <div className="h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
          <PaneErrorBoundary paneName={contentType}>
            <React.Suspense fallback={<PaneLoading />}>
            <CommentarySinglePanel panelId={api.id} dockviewPanelApi={api} contentKey={contentKey} />
          </React.Suspense>
          </PaneErrorBoundary>
        </div>
      );
    }
    if (contentType === 'book') {
      return (
        <div className="h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
          <PaneErrorBoundary paneName={contentType}>
            <React.Suspense fallback={<PaneLoading />}>
            <BookSinglePanel panelId={api.id} dockviewPanelApi={api} contentKey={contentKey} />
          </React.Suspense>
          </PaneErrorBoundary>
        </div>
      );
    }
    if (contentType === 'dictionary') {
      return (
        <div className="h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
          <PaneErrorBoundary paneName={contentType}>
            <React.Suspense fallback={<PaneLoading />}>
            <DictionarySinglePanel panelId={api.id} dockviewPanelApi={api} contentKey={contentKey} />
          </React.Suspense>
          </PaneErrorBoundary>
        </div>
      );
    }
  }

  const Component = CONTENT_COMPONENTS[contentType as BuiltinPanelContentType];

  if (!Component) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--theme-text-secondary)' }}>
        <span>{t('panelContentRenderer.unknownPanelType', { v1: contentType })}</span>
      </div>
    );
  }

  const componentProps: Record<string, unknown> = {
    panelId: api.id,
    dockviewPanelApi: api,
  };

  // Books and dictionaries share one component but are two separate panes: this
  // is what tells `BookPane` which kind it holds.
  if (contentType === 'dictionary' || contentType === 'book') {
    componentProps.paneKind = contentType;
  }

  if (contentKey) {
    componentProps.contentKey = contentKey;
  }

  return (
    // `data-tour-pane` is the anchor the guided tour spotlights (see
    // components/onboarding/tourSteps.ts). Purely an identification hook - it
    // carries no styling and no behaviour.
    <div
      className="h-full w-full overflow-hidden"
      data-tour-pane={contentType}
      style={{ backgroundColor: 'var(--theme-bg-primary)' }}
    >
      <PaneErrorBoundary paneName={contentType}>
            <React.Suspense fallback={<PaneLoading />}>
        <Component {...componentProps} />
      </React.Suspense>
          </PaneErrorBoundary>
    </div>
  );
};

export default PanelContentRenderer;
