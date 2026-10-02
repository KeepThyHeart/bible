import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetState = vi.fn();
vi.mock('../stores/useLayoutStore', () => ({
  useLayoutStore: { getState: () => mockGetState() },
}));

import { openFamilyTree } from './openFamilyTree';
import { useGenealogyFocusStore } from '../stores/useGenealogyFocusStore';

function fakePanel(id: string, contentType: string) {
  return { id, params: { contentType }, api: { setActive: vi.fn() } };
}

describe('openFamilyTree', () => {
  beforeEach(() => {
    mockGetState.mockReset();
    useGenealogyFocusStore.setState({ requests: {} });
  });

  it('returns false when there is no dockview', () => {
    mockGetState.mockReturnValue({ dockviewApi: null });
    expect(openFamilyTree('abraham')).toBe(false);
  });

  it('reuses an existing genealogy pane, focuses the person and activates it', () => {
    const existing = fakePanel('genealogy_9', 'genealogy');
    const addPanel = vi.fn();
    mockGetState.mockReturnValue({ dockviewApi: { panels: [fakePanel('topics_1', 'topics'), existing], addPanel } });
    expect(openFamilyTree('abraham')).toBe(true);
    expect(addPanel).not.toHaveBeenCalled();
    expect(useGenealogyFocusStore.getState().requests['genealogy_9']?.personId).toBe('abraham');
    expect(existing.api.setActive).toHaveBeenCalled();
  });

  it('creates a genealogy pane when none is open', () => {
    const created = fakePanel('genealogy_new', 'genealogy');
    const addPanel = vi.fn().mockReturnValue(created);
    mockGetState.mockReturnValue({ dockviewApi: { panels: [], addPanel } });
    expect(openFamilyTree('david')).toBe(true);
    expect(addPanel).toHaveBeenCalledWith(expect.objectContaining({
      component: 'panelContent',
      params: { contentType: 'genealogy' },
    }));
    expect(useGenealogyFocusStore.getState().requests['genealogy_new']?.personId).toBe('david');
  });
});
