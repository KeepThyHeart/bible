import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, p?: Record<string, string>) => (p?.word ? `${key}:${p.word}` : key), locale: 'en', i18n: {} }),
}));

const dict = vi.hoisted(() => ({
  setStudyPaneActiveTab: vi.fn(), openDictionary: vi.fn(), lookupEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../stores/useDictionaryStore', () => ({
  useDictionaryStore: Object.assign(() => ({}), { getState: () => dict }),
}));
vi.mock('../../services/electronAPI', () => ({ dictionaryAPI: { lookUp: vi.fn() } }));

import { LookUpResults } from './LookUpResults';
import { useLookUpStore } from '../../stores/useLookUpStore';

describe('LookUpResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLookUpStore.setState({
      query: { text: 'walking' },
      loading: false,
      groups: [
        { providerId: 'dictionary', sourceId: 'Easton', sourceName: 'Easton', entries: [{ key: 'WALK', title: 'WALK', snippet: 'to go' }] },
        { providerId: 'dictionary', sourceId: 'Smith', sourceName: 'Smith', entries: [{ key: 'WALKING', title: 'WALKING' }] },
      ],
    });
  });

  it('renders nothing without a query', () => {
    useLookUpStore.setState({ query: null });
    const { container } = render(<LookUpResults panelId="p1" />);
    expect(container.firstChild).toBeNull();
  });

  it('groups entries by dictionary', () => {
    render(<LookUpResults panelId="p1" />);
    expect(screen.getAllByTestId('lookup-group')).toHaveLength(2);
    expect(screen.getByText('WALK')).toBeInTheDocument();
  });

  it('opens the picked entry in its dictionary and dismisses the results', async () => {
    render(<LookUpResults panelId="p1" />);
    await act(async () => { fireEvent.click(screen.getAllByTestId('lookup-entry')[0]); });
    expect(dict.openDictionary).toHaveBeenCalledWith('p1', 'Easton', 'Easton');
    expect(dict.lookupEntry).toHaveBeenCalledWith('p1', 'Easton', 'WALK');
    expect(useLookUpStore.getState().query).toBeNull();
  });

  it('says so when no dictionary has an entry', () => {
    useLookUpStore.setState({ groups: [] });
    render(<LookUpResults panelId="p1" />);
    expect(screen.getByTestId('lookup-empty')).toBeInTheDocument();
  });
});
