import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { MeasureOccurrence } from '@bible/core/browser';

const loadMock = vi.hoisted(() => vi.fn());
vi.mock('@bible/core/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bible/core/browser')>()),
  loadChapterOccurrences: loadMock,
}));
vi.mock('../../stores/helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));
vi.mock('../../services/electronAPI', () => ({ bibleAPI: {} }));
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: 'en-US' }),
}));
vi.mock('../../contexts/useDirection', () => ({ useDirection: () => 'ltr' }));

import MeasuresStudySection from './MeasuresStudySection';
import { useMeasureStore } from '../../stores/useMeasureStore';

const V = 1006015; // Gen 6:15
const occ: MeasureOccurrence = {
  id: `${V}.1`, verseId: V, parts: [{ unit: 'cubit', quantity: { value: 300 } }], usage: 'literal', review: { status: 'reviewed' },
};

describe('MeasuresStudySection', () => {
  beforeEach(() => {
    loadMock.mockReset();
    loadMock.mockResolvedValue([occ]);
    useMeasureStore.setState({ values: {} });
  });

  it('lists the verse measures under the translated heading', async () => {
    useMeasureStore.setState({ values: { measuresSystem: 'metric' } });
    render(<MeasuresStudySection verseId={V} collapsed={false} onToggle={() => {}} />);
    expect(await screen.findByText(/measures\.study\.title/)).toBeTruthy();
    expect(screen.getByText('300 cubits')).toBeTruthy();
    expect(screen.getByText(/≈ 140 m/)).toBeTruthy();
  });

  it('renders nothing when the verse has no measures', async () => {
    loadMock.mockResolvedValue([]);
    const { container } = render(<MeasuresStudySection verseId={V} collapsed={false} onToggle={() => {}} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the load fails or measures are disabled', async () => {
    loadMock.mockRejectedValue(new Error('boom'));
    const a = render(<MeasuresStudySection verseId={V} collapsed={false} onToggle={() => {}} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(a.container.innerHTML).toBe('');
    a.unmount();

    loadMock.mockResolvedValue([occ]);
    useMeasureStore.setState({ values: { measuresEnabled: false } });
    const b = render(<MeasuresStudySection verseId={V} collapsed={false} onToggle={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(b.container.innerHTML).toBe('');
  });

  it('follows the unit system setting', async () => {
    useMeasureStore.setState({ values: { measuresSystem: 'us' } });
    render(<MeasuresStudySection verseId={V} collapsed={false} onToggle={() => {}} />);
    expect(await screen.findByText(/≈ 450 ft/)).toBeTruthy();
    expect(screen.queryByText(/≈ 140 m/)).toBeNull();
    act(() => { useMeasureStore.getState().setValue('measuresSystem', 'metric'); });
    expect(await screen.findByText(/≈ 140 m/)).toBeTruthy();
  });
});
