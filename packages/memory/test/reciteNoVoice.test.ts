/**
 * @vitest-environment jsdom
 */
// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';
import { startReciteRun } from '../src/ui/activities';

describe('hands-free refused (B-136)', () => {
  it('shows the refusal through the error channel, not only the quiet status', async () => {
    const host = {
      request: vi.fn().mockResolvedValue({ ok: false, error: 'Hands-free recitation needs the app to be able to speak, which is not available right now.' }),
      go: vi.fn(),
      announce: vi.fn(),
      fail: vi.fn(),
    };
    const out = await startReciteRun(host, { kind: 'due' }, 'handsfree');
    expect(out).toBeNull();
    expect(host.fail).toHaveBeenCalledWith(expect.stringContaining('needs the app to be able to speak'));
    expect(host.announce).not.toHaveBeenCalled();
    expect(host.go).not.toHaveBeenCalled();
  });
});
