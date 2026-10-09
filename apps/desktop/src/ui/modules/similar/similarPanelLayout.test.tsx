/**
 * A saved dockview layout naming panel type 'similar' (task 0126): with the module on it
 * restores and renders the Similar view (activating the module); with it off the layout
 * still loads and the panel shows the same "unavailable" placeholder as any unknown type.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { sanitizeDockviewState } from '../../services/LayoutStateSanitizer';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('./SimilarPane', () => ({ default: () => <div data-testid="similar-pane" /> }));
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
  const props: any = { params: { contentType: 'similar' }, api: { id: 'p1' } };
  return render(<PanelContentRenderer {...props} />);
}

// Warm the transform cache once: the first import of the panel renderer graph is slow on a busy machine.
beforeAll(async () => {
  await import('../../components/PanelContentRenderer');
}, 300_000);

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('a saved layout naming the similar panel type', () => {
  const layout = {
    grid: { root: { type: 'branch', size: 1, data: [{ type: 'leaf', size: 1, data: { id: 'g', views: ['similar_0'], activeView: 'similar_0' } }] }, width: 1, height: 1, orientation: 'HORIZONTAL' },
    panels: { similar_0: { id: 'similar_0', contentComponent: 'panelContent', title: 'Similar', params: { contentType: 'similar' } } },
    activeGroup: 'g',
  } as never;

  it('is kept by the sanitizer whether or not the module is on', () => {
    expect(sanitizeDockviewState(layout).layout).toBe(layout);
  });

  it('renders the Similar view with the module on (the panel activates the module)', async () => {
    const { featureModules } = await boot('');
    await renderPanel();
    expect(await screen.findByTestId('similar-pane')).toBeInTheDocument();
    await waitFor(() => expect(featureModules.isActive('similar')).toBe(true));
  }, 120_000);

  it('degrades to the unavailable placeholder with the module off', async () => {
    await boot('-similar');
    await act(async () => { await renderPanel(); });
    expect(screen.getByTestId('panel-unavailable')).toHaveAttribute('data-panel-type', 'similar');
    expect(screen.queryByTestId('similar-pane')).toBeNull();
  }, 120_000);
});
