/**
 * A saved dockview layout naming panel type 'quiz' (task 0125): with the module on it
 * restores and renders the quiz view (activating the module); with it off the layout
 * still loads and the panel shows the same "unavailable" placeholder as any unknown type.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { sanitizeDockviewState } from '../../services/LayoutStateSanitizer';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('./QuizPane', () => ({ default: () => <div data-testid="quiz-pane" /> }));
vi.doMock('./module', () => ({ activate: vi.fn() }));

async function boot(override = '') {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  registerBuiltinModules();
  return host;
}

async function renderPanel() {
  const { default: PanelContentRenderer } = await import('../../components/PanelContentRenderer');
  const props: any = { params: { contentType: 'quiz' }, api: { id: 'p1' } };
  return render(<PanelContentRenderer {...props} />);
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('a saved layout naming the quiz panel type', () => {
  const layout = {
    grid: { root: { type: 'branch', size: 1, data: [{ type: 'leaf', size: 1, data: { id: 'g', views: ['quiz_0'], activeView: 'quiz_0' } }] }, width: 1, height: 1, orientation: 'HORIZONTAL' },
    panels: { quiz_0: { id: 'quiz_0', contentComponent: 'panelContent', title: 'Quiz', params: { contentType: 'quiz' } } },
    activeGroup: 'g',
  } as never;

  it('is kept by the sanitizer whether or not the module is on', () => {
    expect(sanitizeDockviewState(layout).layout).toBe(layout);
  });

  it('renders the quiz view with the module on (the panel activates the module)', async () => {
    const { featureModules } = await boot('');
    await renderPanel();
    expect(await screen.findByTestId('quiz-pane')).toBeInTheDocument();
    await waitFor(() => expect(featureModules.isActive('quiz')).toBe(true));
  }, 60_000);

  it('degrades to the unavailable placeholder with the module off', async () => {
    await boot('-quiz');
    await act(async () => { await renderPanel(); });
    expect(screen.getByTestId('panel-unavailable')).toHaveAttribute('data-panel-type', 'quiz');
    expect(screen.queryByTestId('quiz-pane')).toBeNull();
  }, 60_000);
});
