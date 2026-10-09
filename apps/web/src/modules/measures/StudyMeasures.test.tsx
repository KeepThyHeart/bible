/**
 * StudyMeasures: the Study panel's weights, measures and money list for one verse.
 * The chapter occurrence loader is faked; settings go through the real web settings store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/preact';
import type { MeasureOccurrence } from '@bible/core/browser';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}));

const loadMock = vi.fn();
vi.mock('@bible/core/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bible/core/browser')>()),
  loadChapterOccurrences: (...a: unknown[]) => loadMock(...a),
}));

import { StudyMeasures } from './StudyMeasures';
import { modulePoints } from '../moduleHost';
import { currentSettingsStore } from '../host/contributedSettings';
import { measuresManifest } from './manifest';

// The measure settings exist only while the module contributes them: register them as the host does.
const webSettings = {
  set: (key: string, value: string | boolean | number) => currentSettingsStore().set(key, value),
  reset: () => currentSettingsStore().reset(),
};
let settingHandles: { dispose(): void }[] = [];

const GEN_6_15 = 1006015;
const OCC: MeasureOccurrence = {
  id: `${GEN_6_15}.1`, verseId: GEN_6_15, parts: [{ unit: 'cubit', quantity: { value: 300 } }],
  usage: 'literal', review: { status: 'approved' },
};

beforeEach(() => {
  settingHandles = (measuresManifest.contributes.settings ?? []).map((g) => modulePoints.settings.register(g, { kind: 'builtin', moduleId: 'measures' }));
  webSettings.reset();
  loadMock.mockReset();
  loadMock.mockResolvedValue([OCC]);
  try { sessionStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => {
  webSettings.reset();
  for (const h of settingHandles) h.dispose();
});

describe('StudyMeasures', () => {
  it('lists the verse measures in a section even with in-text display off (the default)', async () => {
    render(<StudyMeasures verseId={GEN_6_15} />);
    await waitFor(() => expect(screen.getByText('measures.study.title')).toBeTruthy());
    expect(loadMock).toHaveBeenCalledWith(1, 6, expect.any(Object));
    expect(screen.getByRole('list')).toBeTruthy();
    expect(screen.getByText(/300/)).toBeTruthy();
  });

  it('renders nothing when the verse has no measures', async () => {
    const { container } = render(<StudyMeasures verseId={1006016} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('renders nothing when measures are disabled, and does not load', () => {
    webSettings.set('measuresEnabled', false);
    const { container } = render(<StudyMeasures verseId={GEN_6_15} />);
    expect(container.textContent).toBe('');
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('hides on a load failure', async () => {
    loadMock.mockRejectedValue(new Error('boom'));
    const { container } = render(<StudyMeasures verseId={GEN_6_15} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('follows the unit system setting', async () => {
    webSettings.set('measuresSystem', 'metric');
    const { container } = render(<StudyMeasures verseId={GEN_6_15} />);
    await waitFor(() => expect(container.textContent).toMatch(/\b(m|cm)\b/));
    const metric = container.textContent;
    expect(metric).not.toMatch(/\bft\b/);
    act(() => { webSettings.set('measuresSystem', 'us'); });
    await waitFor(() => expect(container.textContent).toMatch(/\b(ft|in)\b/));
    expect(container.textContent).not.toBe(metric);
  });

  it('shows the mobile frame and opens measure settings from the Units button', async () => {
    const onOpenSettings = vi.fn();
    render(<StudyMeasures variant="mobile" verseId={GEN_6_15} onOpenSettings={onOpenSettings} />);
    await waitFor(() => expect(screen.getByText(/measures\.study\.title/)).toBeTruthy());
    fireEvent.click(screen.getByText('measures.popup.units'));
    expect(onOpenSettings).toHaveBeenCalledWith('measures');
  });

  it('updates when the verse changes', async () => {
    const { container, rerender } = render(<StudyMeasures verseId={GEN_6_15} />);
    await waitFor(() => expect(container.textContent).toMatch(/300/));
    rerender(<StudyMeasures verseId={1006016} />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
