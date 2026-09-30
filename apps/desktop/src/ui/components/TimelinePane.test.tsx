import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TimelinePane from './TimelinePane';

const mockOpenModuleManager = vi.fn();
vi.mock('../utils/openModuleManager', () => ({ openModuleManager: (...a: unknown[]) => mockOpenModuleManager(...a) }));

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => `<${key}>` }),
}));

vi.mock('../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'default',
  useBibleStore: () => null,
}));

vi.mock('../stores/crossStoreBridge', () => ({ navigateToVerseInPrimary: vi.fn() }));
vi.mock('../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));
vi.mock('@bible/ui', () => ({ TimelinePanel: () => <div data-testid="timeline-panel" /> }));

describe('TimelinePane', () => {
  beforeEach(() => {
    mockOpenModuleManager.mockClear();
  });

  it('shows a friendly empty state pointing at the Module Manager when no module is installed', async () => {
    (window as any).electron = { timeline: { getDataset: vi.fn().mockResolvedValue({ ok: true, value: null }) } };
    render(<TimelinePane />);
    expect(await screen.findByTestId('timeline-pane-empty')).toBeInTheDocument();
    expect(screen.getByText('<timelinePane.emptyTitle>')).toBeInTheDocument();
    await userEvent.click(screen.getByText('<timelinePane.openModuleManager>'));
    expect(mockOpenModuleManager).toHaveBeenCalled();
  });

  it('renders the timeline panel when a dataset is returned', async () => {
    (window as any).electron = {
      timeline: { getDataset: vi.fn().mockResolvedValue({ ok: true, value: { items: [], chronologies: [] } }) },
    };
    render(<TimelinePane />);
    await waitFor(() => expect(screen.getByTestId('timeline-panel')).toBeInTheDocument());
  });
});
