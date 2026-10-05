import React, { useEffect, useSyncExternalStore } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import PaneErrorBoundary from './PaneErrorBoundary';
import { parseExtensionContentType } from './DockviewTabRenderer';
import { modulePoints, fireActivation } from '../modules/moduleHost';
import { eagerPanelComponent } from '../modules/host/panels';

// Panel components come from the module registry (`modulePoints.views`, bound
// by the `host` module in modules/host/panels.ts): Bible, Commentary, Book and
// NewTab stay eager because the default layout mounts them; the rest are lazy
// imports for panes the reader has to go and open. The notes panes in
// particular drag the whole TipTap/ProseMirror editor stack (~1MB) behind them,
// which nobody is typing into on the first frame.
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

/** One React.lazy component per registry loader, so a panel type is never wrapped twice. */
const lazyComponents = new WeakMap<object, React.LazyExoticComponent<React.ComponentType<any>>>();

function lazyPanelComponent(type: string): React.ComponentType<any> | undefined {
  const loader = modulePoints.views.resolve<{ default: React.ComponentType<any> }>(`panel:${type}`);
  if (!loader) return undefined;
  let component = lazyComponents.get(loader);
  if (!component) {
    component = React.lazy(() => loader());
    lazyComponents.set(loader, component);
  }
  return component;
}

/**
 * The component for a registered built-in panel type, or undefined when the
 * type is not registered (its module is off): the caller shows a placeholder
 * and the panel stays in the layout.
 */
function componentForPanelType(type: string): React.ComponentType<any> | undefined {
  if (!modulePoints.panelTypes.has(type)) return undefined;
  return eagerPanelComponent(type) ?? lazyPanelComponent(type);
}

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
  // Catalog string with an English fallback until the key reaches every locale.
  const tr = (key: string, fallback: string): string => {
    const v = t(key);
    return v && v !== key ? v : fallback;
  };
  const { params, api } = props;
  const { contentType, contentKey } = params;
  // Re-render when a module is switched on or off at runtime.
  useSyncExternalStore(
    (cb) => modulePoints.panelTypes.subscribe(cb),
    () => modulePoints.panelTypes.getSnapshot(),
  );

  // Opening a panel of a type is the activation event of the module that owns it.
  useEffect(() => {
    if (typeof contentType === 'string' && !contentType.startsWith('ext:')) fireActivation(`onPanel:${contentType}`);
  }, [contentType]);

  // Route extension-contributed panels (`ext:<extId>.<panelTypeId>`) to the
  // ExtensionPanelHost iframe. Parsed by the same helper the tab strip uses,
  // which splits on the LAST dot: extension ids are themselves dotted.
  if (typeof contentType === 'string' && contentType.startsWith('ext:')) {
    const parsed = parseExtensionContentType(contentType);
    if (parsed) {
      const { extensionId, panelTypeId } = parsed;
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

  const Component = componentForPanelType(contentType);

  if (!Component) {
    return (
      <div
        className="flex items-center justify-center h-full"
        data-testid="panel-unavailable"
        data-panel-type={contentType}
        style={{ color: 'var(--theme-text-secondary)', backgroundColor: 'var(--theme-bg-primary)' }}
      >
        <span>{tr('panelContentRenderer.panelUnavailable', 'This panel is unavailable')}</span>
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
