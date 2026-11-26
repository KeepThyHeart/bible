import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadingPlans } from '@bible/core/browser';
import { enT, enLocalizer } from '../../../testing/enCatalog';
import { installTestService, uninstallTestService } from './testSupport';
import AddPlanView from './AddPlanView';
import type { ReadingPlanLabelSet } from './useReadingPlanLabels';

const saveTextFile = vi.fn().mockResolvedValue(true);
vi.mock('../../../utils/saveTextFile', () => ({ saveTextFile: (...a: unknown[]) => saveTextFile(...a) }));
vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, unknown>) => enT(k, p), locale: 'en', localizer: enLocalizer }),
}));

const labels = {
  library: {},
  todayCard: { cancel: 'Cancel' },
  stockName: (p: { name: string }) => p.name,
  stockDescription: () => undefined,
} as unknown as ReadingPlanLabelSet;

// jsdom's File has no text(); real browsers and Electron do.
if (!File.prototype.text) {
  File.prototype.text = function text(this: File) {
    return new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(this); });
  };
}

const day = { readings: [{ start: 43001001, end: 43001051 }] };

describe('AddPlanView import/export', () => {
  afterEach(() => { uninstallTestService(); saveTextFile.mockClear(); });

  it('exports a user plan through saveTextFile', async () => {
    const { service } = installTestService();
    const plan = await service.savePlan({ name: 'My plan', days: [day] });
    const summary = (await service.library()).find((p) => p.key === plan.key)!;
    render(<AddPlanView library={[summary]} labels={labels} onBack={vi.fn()} onEdit={vi.fn()} onStart={vi.fn()} onError={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export My plan' }));
    await waitFor(() => expect(saveTextFile).toHaveBeenCalled());
    const [name, text] = saveTextFile.mock.calls[0];
    expect(name).toBe(ReadingPlans.planFileName('My plan'));
    expect(JSON.parse(text as string).name).toBe('My plan');
  });

  it('imports a plan file and opens the start dialog for it', async () => {
    const { service } = installTestService();
    const onStart = vi.fn(); const onError = vi.fn();
    const text = ReadingPlans.serializePlanFile({ name: 'Imported', days: [day] } as never);
    render(<AddPlanView library={[]} labels={labels} onBack={vi.fn()} onEdit={vi.fn()} onStart={onStart} onError={onError} />);
    const file = new File([text], 'x.readingplan.json', { type: 'application/json' });
    await userEvent.setup().upload(screen.getByTestId('import-plan-input'), file);
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect((await service.library()).some((p) => p.name === 'Imported')).toBe(true);
  });

  it('reports a bad file through onError', async () => {
    installTestService();
    const onStart = vi.fn(); const onError = vi.fn();
    render(<AddPlanView library={[]} labels={labels} onBack={vi.fn()} onEdit={vi.fn()} onStart={onStart} onError={onError} />);
    await userEvent.setup({ applyAccept: false }).upload(screen.getByTestId('import-plan-input'), new File(['nope'], 'x.json'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining('not a reading plan')));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('refuses an oversized file by size before reading it', async () => {
    installTestService();
    const onStart = vi.fn(); const onError = vi.fn();
    render(<AddPlanView library={[]} labels={labels} onBack={vi.fn()} onEdit={vi.fn()} onStart={onStart} onError={onError} />);
    const file = new File(['x'], 'big.json');
    Object.defineProperty(file, 'size', { value: ReadingPlans.MAX_PLAN_FILE_BYTES + 1 });
    const textSpy = vi.spyOn(file, 'text');
    await userEvent.setup({ applyAccept: false }).upload(screen.getByTestId('import-plan-input'), file);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining('too large')));
    expect(textSpy).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });
});
