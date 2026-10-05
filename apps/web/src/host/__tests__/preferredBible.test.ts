import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreferredBible } from '../preferredBible';

vi.mock('../../stores/settingsStore', () => ({ settingsStore: { getDefaultBible: () => 'DEF' } }));

afterEach(() => localStorage.clear());

describe('PreferredBible', () => {
  it('defaults to the default Bible', () => {
    expect(new PreferredBible().module).toBe('DEF');
  });

  it('reads the saved session active tab without a source', () => {
    localStorage.setItem('bible-reader-session', JSON.stringify({ activeTabIndex: 1, tabs: [{ moduleAbbr: 'KJV' }, { moduleAbbr: 'ESV' }] }));
    expect(new PreferredBible().module).toBe('ESV');
  });

  it('ignores a corrupt session', () => {
    localStorage.setItem('bible-reader-session', '{nope');
    expect(new PreferredBible().module).toBe('DEF');
  });

  it('follows a source, forwards its notifications and unsubscribes on replace', () => {
    const pb = new PreferredBible();
    let module = 'KJV';
    const subs = new Set<() => void>();
    const src = { getActiveModule: () => module, subscribe: (fn: () => void) => (subs.add(fn), () => subs.delete(fn)) };
    const listener = vi.fn();
    pb.subscribe(listener);
    pb.setSource(src);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pb.module).toBe('KJV');
    module = 'ESV';
    subs.forEach(f => f());
    expect(listener).toHaveBeenCalledTimes(2);
    expect(pb.module).toBe('ESV');
    pb.setSource(null);
    expect(subs.size).toBe(0);
    expect(pb.module).toBe('DEF');
  });
});
