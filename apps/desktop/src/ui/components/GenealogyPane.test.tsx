/**
 * The Family Tree pane: loading, empty and error states, the explorer once the dataset arrives,
 * and a "show family tree" request from another pane. The provider is mocked; layouts and the
 * explorer itself are the real shared code (their own suites live in `packages/`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

const mockGetDataset = vi.fn();
vi.mock('../../api/dataProviderAdapter', () => ({
  createDesktopDataProviders: () => ({ genealogy: { getDataset: (...args: unknown[]) => mockGetDataset(...args) } }),
}));

const mockNavigate = vi.fn();
vi.mock('../stores/crossStoreBridge', () => ({
  navigateToVerseInPrimary: (...args: unknown[]) => mockNavigate(...args),
}));

import GenealogyPane from './GenealogyPane';
import { useGenealogyFocusStore } from '../stores/useGenealogyFocusStore';
import { enT } from '../testing/enCatalog';
import type { GenealogyDatasetDto } from '@bible/core/browser';

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
};

describe('GenealogyPane', () => {
  beforeEach(() => {
    mockGetDataset.mockReset();
    mockNavigate.mockReset();
    useGenealogyFocusStore.setState({ requests: {} });
  });

  it('shows a loading state, then the explorer', async () => {
    mockGetDataset.mockResolvedValue(dataset);
    render(<GenealogyPane panelId="genealogy_1" />);
    expect(screen.getByTestId('genealogy-loading')).toHaveTextContent(enT('genealogyPane.loading'));
    await waitFor(() => expect(screen.getByTestId('genealogy-pane')).toBeInTheDocument());
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      enT('genealogyPane.line'), enT('genealogyPane.family'), enT('genealogyPane.tribes'),
    ]);
    expect(mockGetDataset).toHaveBeenCalledTimes(1);
  });

  it('shows the not-installed message when there is no dataset', async () => {
    mockGetDataset.mockResolvedValue(null);
    render(<GenealogyPane panelId="genealogy_1" />);
    await waitFor(() => expect(screen.getByTestId('genealogy-empty')).toHaveTextContent(enT('genealogyPane.empty')));
  });

  it('treats a dataset with no people as not installed', async () => {
    mockGetDataset.mockResolvedValue({ ...dataset, persons: [], edges: [] });
    render(<GenealogyPane panelId="genealogy_1" />);
    await waitFor(() => expect(screen.getByTestId('genealogy-empty')).toBeInTheDocument());
  });

  it('shows an error and retries the load', async () => {
    mockGetDataset.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(dataset);
    render(<GenealogyPane panelId="genealogy_1" />);
    await waitFor(() => expect(screen.getByTestId('genealogy-error')).toHaveTextContent(enT('genealogyPane.error')));
    await userEvent.click(screen.getByRole('button', { name: enT('genealogyPane.retry') }));
    await waitFor(() => expect(screen.getByTestId('genealogy-pane')).toBeInTheDocument());
    expect(mockGetDataset).toHaveBeenCalledTimes(2);
  });

  it('switches to the Family view when another pane asks for a person', async () => {
    mockGetDataset.mockResolvedValue(dataset);
    render(<GenealogyPane panelId="genealogy_1" />);
    await waitFor(() => expect(screen.getByTestId('genealogy-pane')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: enT('genealogyPane.line') })).toHaveAttribute('aria-selected', 'true');

    act(() => { useGenealogyFocusStore.getState().requestFocus('genealogy_1', 'isaac'); });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: enT('genealogyPane.family') })).toHaveAttribute('aria-selected', 'true'));
  });

  it('applies a request that arrived before the dataset finished loading', async () => {
    let resolve: (d: GenealogyDatasetDto) => void = () => {};
    mockGetDataset.mockReturnValue(new Promise<GenealogyDatasetDto>((r) => { resolve = r; }));
    useGenealogyFocusStore.getState().requestFocus('genealogy_1', 'abraham');
    render(<GenealogyPane panelId="genealogy_1" />);
    await act(async () => { resolve(dataset); });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: enT('genealogyPane.family') })).toHaveAttribute('aria-selected', 'true'));
  });

  it('ignores a request for a person that is not in the dataset', async () => {
    mockGetDataset.mockResolvedValue(dataset);
    render(<GenealogyPane panelId="genealogy_1" />);
    await waitFor(() => expect(screen.getByTestId('genealogy-pane')).toBeInTheDocument());
    act(() => { useGenealogyFocusStore.getState().requestFocus('genealogy_1', 'nobody'); });
    expect(screen.getByRole('tab', { name: enT('genealogyPane.line') })).toHaveAttribute('aria-selected', 'true');
  });
});
