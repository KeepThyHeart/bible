import { describe, it, expect, vi } from 'vitest';
import { runOnce } from '../runOnce';

describe('runOnce', () => {
  it('runs the function a single time however often it is called', () => {
    const fn = vi.fn();
    const once = runOnce(fn);
    once();
    once();
    once();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('makes IPC handler registration safe to repeat', () => {
    const handlers = new Set<string>();
    const handle = (ch: string): void => {
      if (handlers.has(ch)) throw new Error(`duplicate ${ch}`);
      handlers.add(ch);
    };
    const register = runOnce(() => handle('a:b'));
    expect(() => {
      register();
      register();
    }).not.toThrow();
  });
});
