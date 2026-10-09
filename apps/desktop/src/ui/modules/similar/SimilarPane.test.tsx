import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SimilarPane from './SimilarPane';
import { useSimilarStore } from './useSimilarStore';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => `<${key}>`, localizer: { referenceParserConfig: undefined } }),
}));
vi.mock('./similarAPI', () => ({
  similarAPI: { find: vi.fn(), explain: vi.fn().mockResolvedValue([]), reset: vi.fn().mockResolvedValue(true) },
}));
vi.mock('../../services/electronAPI', () => ({
  bibleAPI: { createUserCrossReference: vi.fn() },
}));
vi.mock('../../utils/openModuleManager', () => ({ openModuleManager: vi.fn() }));
const navigate = vi.fn();
vi.mock('../../stores/useBibleStore', () => ({
  useBibleStore: { getState: () => ({ navigateToVerseInPrimary: navigate, openPassageInNewPanel: vi.fn() }) },
}));
vi.mock('@bible/ui', () => ({
  DEFAULT_SIMILAR_LIST_LABELS: {},
  SimilarList: (p: { rows: Array<{ key: string; reference: string }>; onOpen: (r: unknown, e: { newTab: boolean }) => void }) => (
    <ul>{p.rows.map(r => <li key={r.key}><button onClick={() => p.onOpen(r, { newTab: false })}>{r.reference}</button></li>)}</ul>
  ),
}));

const PANEL = 'similar_test';
const source = { startVerseId: 45005008, endVerseId: 45005008 };

function setPanel(changes: Record<string, unknown>) {
  const panels = new Map();
  panels.set(PANEL, { ...useSimilarStore.getState().getPanelState('none'), ...changes });
  useSimilarStore.setState({ panels });
}

describe('SimilarPane', () => {
  beforeEach(() => {
    navigate.mockClear();
    useSimilarStore.setState({ panels: new Map(), explanations: new Map() });
  });

  it('shows the idle message with no source', () => {
    render(<SimilarPane panelId={PANEL} />);
    expect(screen.getByTestId('similar-idle')).toBeInTheDocument();
  });

  it('shows the unavailable message for a missing table and pack', () => {
    setPanel({ source, status: 'unavailable', unavailableReason: 'no-table-no-pack' });
    render(<SimilarPane panelId={PANEL} />);
    expect(screen.getByText('<similar.noPack>')).toBeInTheDocument();
  });

  it('shows the empty message when there are no rows', () => {
    setPanel({ source, status: 'ready', result: { rows: [], floor: 0 } });
    render(<SimilarPane panelId={PANEL} />);
    expect(screen.getByTestId('similar-empty')).toBeInTheDocument();
  });

  it('shows the preparing message', () => {
    setPanel({ source, status: 'preparing' });
    render(<SimilarPane panelId={PANEL} />);
    expect(screen.getByTestId('similar-preparing')).toBeInTheDocument();
  });

  it('renders rows and navigates the Bible pane on click', async () => {
    setPanel({ source, status: 'ready', maxResults: 20, result: { floor: 0.5, rows: [{ key: 'a', reference: '1 John 4:10', startVerseId: 62004010, endVerseId: 62004010 }] } });
    render(<SimilarPane panelId={PANEL} />);
    expect(screen.getByTestId('similar-header')).toHaveTextContent('<similar.header>');
    await userEvent.click(screen.getByText('1 John 4:10'));
    expect(navigate).toHaveBeenCalledWith(62004010, undefined);
  });

  it('the hide cross-references checkbox updates the filters', async () => {
    const setFilters = vi.spyOn(useSimilarStore.getState(), 'setFilters').mockImplementation(() => {});
    setPanel({ source, status: 'ready', result: { rows: [], floor: 0 } });
    render(<SimilarPane panelId={PANEL} />);
    await userEvent.click(screen.getByTestId('similar-hide-xrefs'));
    expect(setFilters).toHaveBeenCalledWith(PANEL, { hideKnownXrefs: true });
    setFilters.mockRestore();
  });
});
