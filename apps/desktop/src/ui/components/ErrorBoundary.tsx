import React from 'react';
import { i18nService } from '../services/I18nService';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary that catches rendering errors in child components
 * and displays a friendly fallback UI instead of crashing the entire app.
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const message = `[ErrorBoundary] ${error.message}\n${errorInfo.componentStack}`;

    if (window.electron?.log?.error) {
      window.electron.log.error(message);
    } else {
      console.error(message);
    }

    // Also forward to the diagnostics subsystem. Failures here are
    // swallowed - we must never make an error boundary throw.
    try {
      void window.electron?.diagnostics?.reportRendererError?.({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack ?? undefined,
      });
    } catch {
      // ignore
    }
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            padding: '32px',
            backgroundColor: 'var(--theme-bg-primary, #ffffff)',
            color: 'var(--theme-text-primary, #1a1a1a)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '480px',
              textAlign: 'center',
            }}
          >
            <h1
              style={{
                fontSize: '24px',
                fontWeight: 600,
                marginBottom: '12px',
                color: 'var(--theme-text-heading, #111)',
              }}
            >
              {i18nService.t('errorBoundary.somethingWentWrong')}
            </h1>
            <p
              style={{
                fontSize: '14px',
                lineHeight: 1.6,
                marginBottom: '24px',
                color: 'var(--theme-text-secondary, #666)',
              }}
            >
              {i18nService.t('errorBoundary.description')}
            </p>
            <details
              style={{
                marginBottom: '24px',
                textAlign: 'left',
                padding: '12px',
                borderRadius: '6px',
                backgroundColor: 'var(--theme-bg-secondary, #f5f5f5)',
                border: '1px solid var(--theme-border, #e0e0e0)',
                fontSize: '13px',
                color: 'var(--theme-text-secondary, #666)',
              }}
            >
              <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>{i18nService.t('errorBoundary.errorDetails')}</summary>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: 0,
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}
              >
                {this.state.error?.message}
              </pre>
            </details>
            <button
              onClick={this.handleReload}
              style={{
                padding: '10px 24px',
                fontSize: '14px',
                fontWeight: 500,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: 'var(--theme-accent-primary, #2563eb)',
                color: 'var(--theme-accent-text, #ffffff)',
              }}
            >
              {i18nService.t('errorBoundary.reload')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
