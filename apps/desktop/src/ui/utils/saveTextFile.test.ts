import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveTextFile } from './saveTextFile';

describe('saveTextFile (B-078)', () => {
  const original = (window as unknown as { electron?: unknown }).electron;
  afterEach(() => { (window as unknown as { electron?: unknown }).electron = original; });

  it('asks main for a native save dialog instead of clicking a hidden link', async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true, filePath: '/x/plan.ics' });
    (window as unknown as { electron: unknown }).electron = { ipcRenderer: { invoke } };
    await expect(saveTextFile('plan.ics', 'BEGIN:VCALENDAR', 'text/calendar')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('app:save-text-file', 'plan.ics', 'BEGIN:VCALENDAR');
  });

  it('reports a cancelled dialog as false and a failure as an error', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ success: false, canceled: true }).mockResolvedValueOnce({ success: false, error: 'disk full' });
    (window as unknown as { electron: unknown }).electron = { ipcRenderer: { invoke } };
    await expect(saveTextFile('a.json', '{}', 'application/json')).resolves.toBe(false);
    await expect(saveTextFile('a.json', '{}', 'application/json')).rejects.toThrow('disk full');
  });
});
