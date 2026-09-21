import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useModuleStore } from '../useModuleStore';
import { moduleAPI } from '../moduleAPI';
import type { ModuleMetadata } from '../types';

vi.mock('../moduleAPI', () => ({
  moduleAPI: { getModuleDetails: vi.fn() },
}));

const getModuleDetails = vi.mocked(moduleAPI.getModuleDetails);

function meta(id: number): ModuleMetadata {
  return {
    module_id: id,
    module_type: 'bible',
    abbreviation: `M${id}`,
    name: `Module ${id}`,
    language_code: 'en',
    version: '1.0',
    database_path: `/m${id}.db`,
    is_indexed: false,
    update_available: false,
    usage_count: id,
    user_hidden: false,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('detailsSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModuleStore.getState().clearSelection();
    useModuleStore.setState({ error: null });
  });

  it('loads details for a module', async () => {
    getModuleDetails.mockResolvedValue(meta(1));
    await useModuleStore.getState().loadModuleDetails(1);
    expect(useModuleStore.getState().selectedModuleDetails).toEqual(meta(1));
    expect(useModuleStore.getState().loadingDetails).toBe(false);
  });

  it('drops the previous module details as soon as another one is requested', async () => {
    getModuleDetails.mockResolvedValueOnce(meta(1));
    await useModuleStore.getState().loadModuleDetails(1);

    const d = deferred<ModuleMetadata>();
    getModuleDetails.mockReturnValueOnce(d.promise as never);
    const pending = useModuleStore.getState().loadModuleDetails(2);
    expect(useModuleStore.getState().selectedModuleDetails).toBeNull();
    expect(useModuleStore.getState().loadingDetails).toBe(true);
    d.resolve(meta(2));
    await pending;
    expect(useModuleStore.getState().selectedModuleDetails).toEqual(meta(2));
  });

  it('ignores an older response that arrives after a newer request', async () => {
    const slow = deferred<ModuleMetadata>();
    const fast = deferred<ModuleMetadata>();
    getModuleDetails.mockReturnValueOnce(slow.promise as never).mockReturnValueOnce(fast.promise as never);

    const first = useModuleStore.getState().loadModuleDetails(1);
    const second = useModuleStore.getState().loadModuleDetails(2);
    fast.resolve(meta(2));
    await second;
    slow.resolve(meta(1));
    await first;

    expect(useModuleStore.getState().selectedModuleDetails).toEqual(meta(2));
    expect(useModuleStore.getState().loadingDetails).toBe(false);
  });

  it('ignores an older failure that arrives after a newer request', async () => {
    const slow = deferred<ModuleMetadata>();
    getModuleDetails.mockReturnValueOnce(slow.promise as never).mockResolvedValueOnce(meta(2));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = useModuleStore.getState().loadModuleDetails(1);
    await useModuleStore.getState().loadModuleDetails(2);
    slow.reject(new Error('boom'));
    await first;

    expect(useModuleStore.getState().selectedModuleDetails).toEqual(meta(2));
    expect(useModuleStore.getState().error).toBeNull();
  });

  it('clearDetails discards an in-flight response', async () => {
    const d = deferred<ModuleMetadata>();
    getModuleDetails.mockReturnValueOnce(d.promise as never);
    const pending = useModuleStore.getState().loadModuleDetails(1);
    useModuleStore.getState().clearDetails();
    d.resolve(meta(1));
    await pending;
    expect(useModuleStore.getState().selectedModuleDetails).toBeNull();
    expect(useModuleStore.getState().loadingDetails).toBe(false);
  });

  it('records an error and clears details when the load fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getModuleDetails.mockRejectedValue(new Error('nope'));
    await useModuleStore.getState().loadModuleDetails(1);
    expect(useModuleStore.getState().selectedModuleDetails).toBeNull();
    expect(useModuleStore.getState().error).toBe('nope');
    expect(useModuleStore.getState().loadingDetails).toBe(false);
  });

  it('selectModule with a catalog module clears leftover details', async () => {
    getModuleDetails.mockResolvedValue(meta(1));
    await useModuleStore.getState().loadModuleDetails(1);
    useModuleStore.getState().selectModule({
      module_id: 'cat-1',
      module_type: 'bible',
      name: 'Cat',
      abbreviation: 'CAT',
      language_code: 'en',
      version: '1',
      description: '',
      license: '',
      download_url: '',
      download_size_bytes: 0,
      installed_size_bytes: 0,
      checksum: '',
      features: [],
      tags: [],
      recommended: false,
      created_date: '',
      updated_date: '',
    });
    expect(useModuleStore.getState().selectedModuleDetails).toBeNull();
  });
});
