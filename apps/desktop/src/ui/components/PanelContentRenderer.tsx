import React from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import BiblePane from './BiblePane';
import CommentaryPane from './CommentaryPane';
import CommentarySinglePanel from './commentary/CommentarySinglePanel';
import BookSinglePanel from './book/BookSinglePanel';
import DictionarySinglePanel from './dictionary/DictionarySinglePanel';
import BookPane from './BookPane';
import UserNotesPane from './notes/UserNotesPane';
import PrayerTab from './notes/tabs/PrayerTab';
import StudyPane from './StudyPane';
import TopicsPane from './TopicsPane';
import NewTabPage from './NewTabPage';
import SearchResultsPane from './SearchResultsPane';
import ExtensionPanelHost from './extensions/ExtensionPanelHost';
import PaneErrorBoundary from './PaneErrorBoundary';
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
            <ExtensionPanelHost
              extensionId={extensionId}
              panelTypeId={panelTypeId}
              panelId={api.id}
            />
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
            <CommentarySinglePanel panelId={api.id} dockviewPanelApi={api} contentKey={contentKey} />
          </PaneErrorBoundary>
        </div>
      );
    }
    if (contentType === 'book') {
      return (
        <div className="h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
          <PaneErrorBoundary paneName={contentType}>
            <BookSinglePanel panelId={api.id} dockviewPanelApi={api} contentKey={contentKey} />
          </PaneErrorBoundary>
        </div>
      );
    }
    if (contentType === 'dictionary') {
      return (
        <div className="h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
          <PaneErrorBoundary paneName={contentType}>
            <DictionarySinglePanel panelId={api.id} dockviewPanelApi={api} contentKey={contentKey} />
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
        <Component {...componentProps} />
      </PaneErrorBoundary>
    </div>
  );
};

export default PanelContentRenderer;
