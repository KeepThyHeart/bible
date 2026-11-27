import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import TodayReadingRow from './TodayReadingRow';
import { useActiveReadingStore } from '../useActiveReadingStore';
import * as appHost from '../../../apps/appHost';

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));

afterEach(() => { uninstallTestService(); vi.restoreAllMocks(); });

describe('TodayReadingRow', () => {
  it('renders nothing without plans', async () => {
    installTestService();
    const { container } = render(<TodayReadingRow onDone={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a button per plan (max 2) and opens the reading', async () => {
    const { service } = installTestService();
    const keys = ['stock:gospels-30', 'stock:psalms-30', 'stock:proverbs-31'];
    const lib = (await service.library()).map((p) => p.key);
    const enrolled = [];
    for (const k of keys.filter((k) => lib.includes(k)).concat(lib.filter((k) => !keys.includes(k))).slice(0, 3)) {
      enrolled.push(await service.startPlan(k, { startDate: '2026-10-01', pacing: 'flexible' }));
    }
    expect(enrolled.length).toBe(3);
    const activate = vi.spyOn(useActiveReadingStore.getState(), 'activate').mockResolvedValue();
    vi.spyOn(appHost, 'openApp').mockResolvedValue({} as never);
    const onDone = vi.fn();
    render(<TodayReadingRow onDone={onDone} />);
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    expect(screen.getAllByRole('button')[0]).toHaveTextContent(/^Today's reading: /);
    await userEvent.setup().click(screen.getAllByRole('button')[0]);
    expect(activate).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
