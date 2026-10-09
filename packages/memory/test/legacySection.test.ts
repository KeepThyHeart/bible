// @vitest-environment jsdom
/** Settings > "Import data from the old Scripture Memory extension" (task 0114 M2). */
import { describe, expect, it, vi } from 'vitest';
import { legacyImportSection, legacyResultText, legacyStatusText } from '../src/ui/settingsView';
import type { PanelHost } from '../src/ui/host';

const host = () => ({ announce: vi.fn(), reload: vi.fn() }) as unknown as PanelHost & { announce: ReturnType<typeof vi.fn>; reload: ReturnType<typeof vi.fn> };
const status = (s: string | null, sourceAvailable: boolean) => ({ status: s, recordedAt: null, counts: null, sourceAvailable });

describe('legacy import section', () => {
  it('is hidden when the old database is not on this computer', () => {
    expect(legacyImportSection(host(), null)).toBeNull();
    expect(legacyImportSection(host(), { status: status('imported', false), run: vi.fn() })).toBeNull();
  });

  it('explains a skipped import and runs the merge on click, then redraws', async () => {
    const h = host();
    const run = vi.fn(async () => ({ status: 'merged', added: { memory_passage: 2, memory_attempt: 5 }, matched: {}, revived: 1 }));
    const section = legacyImportSection(h, { status: status('skipped-not-empty', true), run })!;
    expect(section.textContent).toContain('was not brought over automatically');
    section.querySelector('button')!.click();
    await vi.waitFor(() => expect(h.reload).toHaveBeenCalled());
    expect(h.announce).toHaveBeenCalledWith('Imported 2 passages, 5 practice records, 1 removed passage restored.');
  });

  it('describes each outcome', () => {
    expect(legacyStatusText(status('imported', true))).toContain('brought over automatically');
    expect(legacyResultText({ status: 'merged', added: {}, matched: {}, revived: 0 })).toBe('Everything from the extension is already here.');
    expect(legacyResultText({ status: 'no-source', added: {}, matched: {}, revived: 0 })).toBe('There was nothing to import.');
  });
});
