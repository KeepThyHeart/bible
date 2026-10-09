/**
 * Component tests for GenealogyPane.
 *
 * Pattern: provider-driven component. The genealogy provider is a mock returning
 * a small dataset; the shared GenealogyExplorer (heavy SVG view, tested in
 * @bible/ui) is mocked to capture its props. The graph and store are real.
 * i18n is mocked to return keys as-is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

let lastExplorerProps: Record<string, any> = {};
vi.mock('@bible/ui', () => ({
  GenealogyExplorer: (props: Record<string, unknown>) => {
    lastExplorerProps = props;
    return <div data-testid="genealogy-explorer" data-compact={String(props.compact)} />;
  },
}));

import type { GenealogyDatasetDto, IGenealogyDataProvider } from '@bible/core/browser';
import { GenealogyGraph } from '@bible/core/browser';
import { GenealogyPane, resolvePersonId } from './GenealogyPane';

const dataset: GenealogyDatasetDto = {
  module: 'test',
  sources: [],
  lineages: [],
  persons: [
    { id: 'abraham', name: 'Abraham', sex: 'male', kind: 'individual', firstRef: 1011026 },
    { id: 'isaac', name: 'Isaac', sex: 'male', kind: 'individual', firstRef: 1021003 },
  ],
  edges: [
    { id: 'e1', from: 'abraham', to: 'isaac', type: 'father_of', confidence: 'certain', verses: [{ start: 1021003, end: 1021003 }] },
  ],
  externalIds: { isaac: { tipnr: 'H3327' } },
};

function makeProvider(result: Promise<GenealogyDatasetDto | null>): IGenealogyDataProvider {
  return { getDataset: vi.fn(() => result) };
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  lastExplorerProps = {};
});

describe('GenealogyPane', () => {
  it('shows a loading message until the dataset arrives', async () => {
    const provider = makeProvider(new Promise(() => {}));
    render(<GenealogyPane provider={provider} />);
    expect(screen.getByText('genealogyPane.loading')).toBeTruthy();
    expect(screen.queryByTestId('genealogy-explorer')).toBeNull();
  });

  it('renders the explorer with a graph built from the dataset', async () => {
    const provider = makeProvider(Promise.resolve(dataset));
    render(<GenealogyPane provider={provider} />);
    await flush();
    expect(screen.getByTestId('genealogy-explorer')).toBeTruthy();
    expect((lastExplorerProps.graph as GenealogyGraph).has('abraham')).toBe(true);
    expect(typeof lastExplorerProps.computeLayout).toBe('function');
    expect(typeof lastExplorerProps.formatVerse).toBe('function');
    expect(lastExplorerProps.labels.line).toBe('genealogyPane.line');
  });

  it('loads the dataset once, not on every render', async () => {
    const provider = makeProvider(Promise.resolve(dataset));
    const { rerender } = render(<GenealogyPane provider={provider} />);
    await flush();
    rerender(<GenealogyPane provider={provider} compact />);
    await flush();
    expect(provider.getDataset).toHaveBeenCalledTimes(1);
  });

  it('shows the empty message when the server has no dataset', async () => {
    render(<GenealogyPane provider={makeProvider(Promise.resolve(null))} />);
    await flush();
    expect(screen.getByText('genealogyPane.empty')).toBeTruthy();
    expect(screen.queryByTestId('genealogy-explorer')).toBeNull();
  });

  it('shows the empty message for a dataset with no people', async () => {
    render(<GenealogyPane provider={makeProvider(Promise.resolve({ ...dataset, persons: [] }))} />);
    await flush();
    expect(screen.getByText('genealogyPane.empty')).toBeTruthy();
  });

  it('shows the empty message when there is no provider', async () => {
    render(<GenealogyPane />);
    await flush();
    expect(screen.getByText('genealogyPane.empty')).toBeTruthy();
  });

  it('shows an error with a retry that reloads', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const getDataset = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(dataset);
    render(<GenealogyPane provider={{ getDataset }} />);
    await flush();
    expect(screen.getByText('genealogyPane.error')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText('genealogyPane.retry')); });
    await flush();
    expect(getDataset).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('genealogy-explorer')).toBeTruthy();
  });

  it('passes compact through for the phone sheet', async () => {
    render(<GenealogyPane provider={makeProvider(Promise.resolve(dataset))} compact />);
    await flush();
    expect(screen.getByTestId('genealogy-explorer').getAttribute('data-compact')).toBe('true');
  });

  it('forwards onOpenVerse to the explorer', async () => {
    const onOpenVerse = vi.fn();
    render(<GenealogyPane provider={makeProvider(Promise.resolve(dataset))} onOpenVerse={onOpenVerse} />);
    await flush();
    lastExplorerProps.onOpenVerse(1021003);
    expect(onOpenVerse).toHaveBeenCalledWith(1021003);
  });

  it('focuses the requested person in the family view', async () => {
    render(
      <GenealogyPane
        provider={makeProvider(Promise.resolve(dataset))}
        focus={{ personId: 'isaac', token: 1 }}
      />,
    );
    await flush();
    const state = lastExplorerProps.store.getSnapshot();
    expect(state.view).toBe('family');
    expect(state.focusId).toBe('isaac');
    expect(state.selectedId).toBe('isaac');
  });

  it('leaves the view alone when the requested person is unknown', async () => {
    render(
      <GenealogyPane
        provider={makeProvider(Promise.resolve(dataset))}
        focus={{ personId: 'nobody', name: 'Nobody', token: 1 }}
      />,
    );
    await flush();
    expect(lastExplorerProps.store.getSnapshot().focusId).toBeNull();
  });

  it('re-focuses when a new request arrives while mounted', async () => {
    const provider = makeProvider(Promise.resolve(dataset));
    const { rerender } = render(<GenealogyPane provider={provider} focus={{ personId: 'isaac', token: 1 }} />);
    await flush();
    rerender(<GenealogyPane provider={provider} focus={{ personId: 'abraham', token: 2 }} />);
    await flush();
    expect(lastExplorerProps.store.getSnapshot().focusId).toBe('abraham');
  });
});

describe('resolvePersonId', () => {
  const graph = GenealogyGraph.from(dataset);

  it('accepts a genealogy id as is', () => {
    expect(resolvePersonId(graph, { personId: 'abraham' })).toBe('abraham');
  });

  it('maps an external id to the genealogy person', () => {
    expect(resolvePersonId(graph, { personId: 'H3327' })).toBe('isaac');
  });

  it('falls back to the name', () => {
    expect(resolvePersonId(graph, { personId: 'entity-9', name: 'abraham' })).toBe('abraham');
  });

  it('returns null when nothing matches', () => {
    expect(resolvePersonId(graph, { personId: 'entity-9', name: 'Nobody' })).toBeNull();
    expect(resolvePersonId(graph, { personId: 'entity-9' })).toBeNull();
  });
});
