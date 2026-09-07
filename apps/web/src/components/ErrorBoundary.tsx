import { Component } from 'preact';
import type { ComponentChildren } from 'preact';
import i18n from '../i18n';

interface Props {
  children: ComponentChildren;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches unhandled render errors and shows a recovery UI instead of a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('[ErrorBoundary] Render crash:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleClearAndReload = () => {
    // Clear service worker caches then reload
    if (typeof caches !== 'undefined') {
      caches.keys()
        .then(names => Promise.all(names.map(n => caches.delete(n))))
        .then(() => location.reload())
        .catch(() => location.reload());
    } else {
      location.reload();
    }
  };

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div class="error-boundary">
          <i class="fa-solid fa-triangle-exclamation error-boundary__icon" />
          <div class="error-boundary__title">{i18n.t('errorBoundary.title')}</div>
          <div class="error-boundary__message">
            {i18n.t('errorBoundary.message')}
          </div>
          <div class="error-boundary__actions">
            <button class="error-boundary__btn error-boundary__btn--primary" onClick={this.handleRetry}>
              {i18n.t('errorBoundary.tryAgain')}
            </button>
            <button class="error-boundary__btn" onClick={this.handleReload}>
              {i18n.t('errorBoundary.reloadPage')}
            </button>
            <button class="error-boundary__btn" onClick={this.handleClearAndReload}>
              {i18n.t('errorBoundary.clearCacheReload')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
