import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { TimelinePane } from './TimelinePane';

vi.mock('@bible/ui', () => ({
  TimelinePanel: (props: { dataset: { info: { name: string } } }) => <div data-testid="panel">{props.dataset.info.name}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

const dataset = { info: { name: 'Test' }, chronologies: [], lanes: [], items: [] };

describe('TimelinePane', () => {
  it('shows the empty state when no timeline module is installed', async () => {
    render(<TimelinePane provider={{ getDataset: () => Promise.resolve(null) }} />);
    expect(screen.getByText('timeline.loading')).toBeTruthy();
    expect(await screen.findByText('timeline.empty')).toBeTruthy();
  });

  it('shows an error with a retry that reloads', async () => {
    const getDataset = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(dataset);
    render(<TimelinePane provider={{ getDataset }} />);
    expect(await screen.findByText('timeline.error')).toBeTruthy();
    fireEvent.click(screen.getByText('timeline.retry'));
    await waitFor(() => expect(screen.getByTestId('panel').textContent).toBe('Test'));
    expect(getDataset).toHaveBeenCalledTimes(2);
  });
});
