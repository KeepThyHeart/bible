/**
 * Guards loading the Node barrel (`@bible/core`) where Node built-ins are stubs.
 *
 * The desktop renderer imports `@bible/core` itself, not only
 * `@bible/core/browser`, so the whole Data layer lands in its bundle with
 * Vite's `__vite-browser-external` stubs (empty objects) in place of
 * `node:zlib`, `node:crypto` and friends. That is harmless as long as nothing
 * TOUCHES a built-in at module load. When something did (`zlib.constants` read
 * into a top-level constant in ZstdCodec), the renderer threw before React
 * mounted and every fresh install opened to a blank window.
 *
 * This loads the barrel with those built-ins mocked as empty objects, the same
 * shape the renderer sees, so the next top-level access fails here instead.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('node:zlib', () => ({}));
vi.mock('zlib', () => ({}));
vi.mock('node:crypto', () => ({}));
vi.mock('crypto', () => ({}));

describe('Node barrel with stubbed built-ins (Electron renderer)', () => {
  it('loads without touching node:zlib or node:crypto at module load', async () => {
    const core = await import('../index');
    expect(typeof core.ZstdCodec).toBe('function');
    expect(typeof core.computeContentSha256).toBe('function');
  });
});
