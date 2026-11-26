import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, p?: Record<string, string>) => (p?.word ? `${key}:${p.word}` : key), locale: 'en', i18n: {} }),
}));

vi.mock('../../services/electronAPI', () => ({ dictionaryAPI: { lookUp: vi.fn() } }));

import { LookUpResults } from './LookUpResults';
import { useLookUpStore } from '../../stores/useLookUpStore';

const onOpenEntry = vi.fn();

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
    const { container } = render(<LookUpResults onOpenEntry={onOpenEntry} />);
    expect(container.firstChild).toBeNull();
  });

  it('groups entries by dictionary', () => {
    render(<LookUpResults onOpenEntry={onOpenEntry} />);
    expect(screen.getAllByTestId('lookup-group')).toHaveLength(2);
    expect(screen.getByText('WALK')).toBeInTheDocument();
  });

  it('hands the picked entry to the caller, and keeps the results for coming back', async () => {
    render(<LookUpResults onOpenEntry={onOpenEntry} />);
    await act(async () => { fireEvent.click(screen.getAllByTestId('lookup-entry')[0]); });
    expect(onOpenEntry).toHaveBeenCalledWith('Easton', 'Easton', 'WALK');
    expect(useLookUpStore.getState().query?.text).toBe('walking');
  });

  it('says so when no dictionary has an entry', () => {
    useLookUpStore.setState({ groups: [] });
    render(<LookUpResults onOpenEntry={onOpenEntry} />);
    expect(screen.getByTestId('lookup-empty')).toBeInTheDocument();
  });
});
