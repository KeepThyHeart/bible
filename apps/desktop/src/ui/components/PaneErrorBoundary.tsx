import React from 'react';
import { i18nService } from '../services/I18nService';

interface Props {
  paneName: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class PaneErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[${this.props.paneName}] Render error:`, error, info);
    // Forward to the diagnostics subsystem. Best-effort; never throw.
    try {
      void window.electron?.diagnostics?.reportRendererError?.({
        message: `[${this.props.paneName}] ${error.message}`,
        stack: error.stack,
        componentStack: info.componentStack ?? undefined,
      });
    } catch {
      // ignore
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 p-4" style={{ color: 'var(--theme-text-secondary)' }}>
          <p>{i18nService.t('paneErrorBoundary.message')}</p>
          <button
            className="px-3 py-1 rounded text-sm"
            style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-primary)' }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            {i18nService.t('paneErrorBoundary.tryAgain')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default PaneErrorBoundary;
