// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { loadUiKit } from '../loadUiKit';

const bundled = existsSync(resolve(__dirname, '../../../dist/kit/kth-kit.js'));

afterEach(() => {
  delete (globalThis as { KthKit?: unknown }).KthKit;
});

describe('loadUiKit', () => {
  it('evaluates a bundle in the current realm and returns KthKit', async () => {
    const kit = await loadUiKit({ code: 'globalThis.KthKit = { version: "1", tags: [] };' });
    expect(kit).toEqual({ version: '1', tags: [] });
    expect((globalThis as { KthKit?: unknown }).KthKit).toBe(kit);
  });

  it('throws a clear error when the bundle defines no KthKit', async () => {
    await expect(loadUiKit({ code: 'void 0;' })).rejects.toThrow(/did not define globalThis\.KthKit/);
  });

  // Only meaningful after `npm run build` (dist/kit is gitignored build output).
  it.skipIf(!bundled)('loads the bundled kit and renders a real element', async () => {
    const kit = (await loadUiKit()) as { version: string; init(o: object): Promise<void> };
    expect(kit.version).toBe('1');
    await kit.init({ locale: 'en', components: ['kth-reference-picker'] });
    const el = document.createElement('kth-reference-picker');
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 10));
    expect(el.querySelector('[role=combobox]')).not.toBeNull();
    el.remove();
  });
});
