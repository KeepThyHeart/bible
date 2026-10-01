import { describe, it, expect } from 'vitest';
import { Extensions } from '@bible/core';

import { createMockApi } from '../createMockApi';
import { installPermissionAndNetworkInterceptors } from '../smoke/interceptors';

describe('createMockApi (generated from declarations)', () => {
  it('has every registry namespace and every declared method as a function', () => {
    const api = createMockApi() as unknown as Record<string, Record<string, unknown>>;
    for (const decl of Extensions.EXTENSION_API_REGISTRY.namespaces) {
      expect(api[decl.name], decl.name).toBeDefined();
      for (const method of Object.keys(decl.methods)) {
        expect(typeof api[decl.name][method], `${decl.name}.${method}`).toBe('function');
      }
    }
  });

  it('takes defaults from the declarations', async () => {
    const api = createMockApi();
    expect(await api.notes.list()).toEqual([]);
    const hl = await api.highlights.create({} as never);
    expect(hl).toMatchObject({ id: 'mock-hl' });
    const handle = await api.ui.registerPanelType({} as never);
    expect(typeof handle.dispose).toBe('function');
  });

  it('keeps storage behavioural', async () => {
    const api = createMockApi();
    await api.storage.set('k', { a: 1 });
    expect(await api.storage.get('k')).toEqual({ a: 1 });
  });

  it('fakes extra namespaces', async () => {
    const sample = Extensions.defineApiNamespace<{ ping(): Promise<string> }>()({
      name: 'sample',
      description: 'x',
      since: '0.1.0',
      permissions: [],
      methods: { ping: { permission: null, fake: Extensions.fakeReturns('pong') } },
    });
    const api = createMockApi({}, { extraNamespaces: [sample] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (api as any).sample.ping()).toBe('pong');
  });
});

describe('interceptors derived from the registry', () => {
  const manifest = {
    id: 'ext.test.guard',
    name: { key: 'x' },
    version: '1.0.0',
    publisher: 'test',
    engines: { bibleApp: '^1.0.0' },
    permissions: [],
  } as unknown as Extensions.ExtensionManifest;

  it('denies notes.list without notes:read but not default-granted bible.getVerse', async () => {
    const api = createMockApi();
    const guard = installPermissionAndNetworkInterceptors(api, manifest);
    await expect(api.notes.list()).rejects.toBeInstanceOf(Extensions.PermissionDeniedError);
    await expect(api.bible.getVerse(1, undefined as never)).resolves.toBeDefined();
    expect(guard.snapshot().permissionDenials.length).toBe(1);
    guard.restore();
  });
});
