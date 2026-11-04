import { describe, expect, it } from 'vitest';
import { chooseModel, detectDevice, wasmThreads } from './device';

const gpu = (features: string[] | null) => ({
  requestAdapter: async () => (features ? { features: new Set(features) } : null),
});

describe('detectDevice', () => {
  it('webgpu with shader-f16', async () => expect(await detectDevice({ gpu: gpu(['shader-f16']) })).toBe('webgpu'));
  it('wasm without f16', async () => expect(await detectDevice({ gpu: gpu([]) })).toBe('wasm'));
  it('wasm without adapter or gpu', async () => {
    expect(await detectDevice({ gpu: gpu(null) })).toBe('wasm');
    expect(await detectDevice({})).toBe('wasm');
  });
  it('wasm when requestAdapter throws', async () => {
    expect(await detectDevice({ gpu: { requestAdapter: async () => { throw new Error('x'); } } })).toBe('wasm');
  });
});

describe('chooseModel', () => {
  const auto = { model: 'auto', device: 'auto' } as const;
  it('webgpu -> base f16', () => {
    expect(chooseModel(auto, { device: 'webgpu', deviceMemory: 2 })).toEqual({ model: 'base', variant: 'f16', device: 'webgpu' });
  });
  it('wasm desktop -> base q8', () => {
    expect(chooseModel(auto, { device: 'wasm', deviceMemory: 8, hardwareConcurrency: 8 })).toEqual({ model: 'base', variant: 'q8', device: 'wasm' });
  });
  it('wasm low end -> tiny', () => {
    expect(chooseModel(auto, { device: 'wasm', deviceMemory: 4 }).model).toBe('tiny');
    expect(chooseModel(auto, { device: 'wasm', hardwareConcurrency: 4 }).model).toBe('tiny');
    expect(chooseModel(auto, { device: 'wasm', mobile: true }).model).toBe('tiny');
  });
  it('overrides', () => {
    expect(chooseModel({ model: 'base', device: 'wasm' }, { device: 'webgpu', mobile: true })).toEqual({ model: 'base', variant: 'q8', device: 'wasm' });
    expect(chooseModel({ model: 'tiny', device: 'webgpu' }, { device: 'wasm' })).toEqual({ model: 'tiny', variant: 'f16', device: 'webgpu' });
  });
});

describe('wasmThreads', () => {
  it('threads', () => {
    expect(wasmThreads(false, 8)).toBe(1);
    expect(wasmThreads(true, 8)).toBe(4);
    expect(wasmThreads(true, 2)).toBe(1);
  });
});
