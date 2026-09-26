// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useHostStyles, HOST_THEME_CSS, HOST_KIT_CSS, type ThemeSource } from './hostStyles';

class FakeSource implements ThemeSource {
  listeners = new Set<(t: { mode: string }) => void>();
  theme: () => Promise<{ mode: string }> = () => Promise.resolve({ mode: 'light' });
  getTheme(): Promise<{ mode: string }> {
    return this.theme();
  }
  onThemeChanged(cb: (t: { mode: string }) => void): { dispose(): void } {
    this.listeners.add(cb);
    return { dispose: () => void this.listeners.delete(cb) };
  }
  emit(mode: unknown): void {
    for (const l of [...this.listeners]) l({ mode } as { mode: string });
  }
}

const links = (): HTMLLinkElement[] => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
const hrefs = (): string[] => links().map((l) => l.getAttribute('href') ?? '');
const themeLinks = (): HTMLLinkElement[] => links().filter((l) => l.getAttribute('href')!.startsWith(HOST_THEME_CSS));

beforeEach(() => {
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useHostStyles: initial links', () => {
  it('appends theme.css then kth.css when absent', () => {
    useHostStyles(new FakeSource());
    expect(hrefs()).toEqual([HOST_THEME_CSS, HOST_KIT_CSS]);
  });

  it('adopts an existing static theme link without duplicating it', () => {
    const existing = document.createElement('link');
    existing.rel = 'stylesheet';
    existing.setAttribute('href', HOST_THEME_CSS);
    document.head.appendChild(existing);
    const other = document.createElement('link');
    other.rel = 'stylesheet';
    other.setAttribute('href', 'styles.css');
    document.head.appendChild(other);
    useHostStyles(new FakeSource());
    expect(hrefs()).toEqual([HOST_THEME_CSS, HOST_KIT_CSS, 'styles.css']);
    expect(links()[0]).toBe(existing);
  });

  it('does not add kth.css twice when already linked', () => {
    const kth = document.createElement('link');
    kth.rel = 'stylesheet';
    kth.setAttribute('href', HOST_KIT_CSS);
    document.head.appendChild(kth);
    useHostStyles(new FakeSource());
    expect(hrefs().filter((h) => h === HOST_KIT_CSS)).toHaveLength(1);
  });

  it('skips kth.css with kthCss:false', () => {
    useHostStyles(new FakeSource(), { kthCss: false });
    expect(hrefs()).toEqual([HOST_THEME_CSS]);
  });

  it('sets data-theme from the initial getTheme and swallows a rejection', async () => {
    const src = new FakeSource();
    src.theme = () => Promise.resolve({ mode: 'sepia' });
    useHostStyles(src);
    await Promise.resolve();
    expect(document.documentElement.getAttribute('data-theme')).toBe('sepia');

    document.documentElement.removeAttribute('data-theme');
    const bad = new FakeSource();
    bad.theme = () => Promise.reject(new Error('nope'));
    expect(() => useHostStyles(bad)).not.toThrow();
    await Promise.resolve();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('useHostStyles: theme.changed', () => {
  it('links the new sheet after the old one and keeps the old until load', () => {
    const src = new FakeSource();
    useHostStyles(src);
    const old = themeLinks()[0];
    src.emit('midnight');
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
    expect(hrefs()).toEqual([HOST_THEME_CSS, `${HOST_THEME_CSS}?theme=midnight`, HOST_KIT_CSS]);
    expect(old.isConnected).toBe(true);

    themeLinks()[1].dispatchEvent(new Event('load'));
    expect(old.isConnected).toBe(false);
    expect(hrefs()).toEqual([`${HOST_THEME_CSS}?theme=midnight`, HOST_KIT_CSS]);
  });

  it('swaps on error too', () => {
    const src = new FakeSource();
    useHostStyles(src);
    src.emit('dark');
    themeLinks()[1].dispatchEvent(new Event('error'));
    expect(hrefs()).toEqual([`${HOST_THEME_CSS}?theme=dark`, HOST_KIT_CSS]);
  });

  it('swaps after the fallback timeout', () => {
    vi.useFakeTimers();
    const src = new FakeSource();
    useHostStyles(src);
    src.emit('dark');
    vi.advanceTimersByTime(2999);
    expect(themeLinks()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(hrefs()).toEqual([`${HOST_THEME_CSS}?theme=dark`, HOST_KIT_CSS]);
  });

  it('a rapid second switch drops the pending sheet; a late load on it does nothing', () => {
    const src = new FakeSource();
    useHostStyles(src);
    src.emit('a');
    const a = themeLinks()[1];
    src.emit('b');
    expect(a.isConnected).toBe(false);
    const b = themeLinks().find((l) => l.getAttribute('href')!.endsWith('theme=b'))!;
    b.dispatchEvent(new Event('load'));
    a.dispatchEvent(new Event('load'));
    expect(hrefs()).toEqual([`${HOST_THEME_CSS}?theme=b`, HOST_KIT_CSS]);
    expect(document.documentElement.getAttribute('data-theme')).toBe('b');
  });

  it.each(['x" onload="', '../x', '', 'A', 'a'.repeat(41), {}, null, 5])('ignores invalid mode %j', (bad) => {
    const src = new FakeSource();
    useHostStyles(src);
    src.emit(bad);
    expect(hrefs()).toEqual([HOST_THEME_CSS, HOST_KIT_CSS]);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('ignores events and clears the timer after dispose', () => {
    vi.useFakeTimers();
    const src = new FakeSource();
    const h = useHostStyles(src);
    src.emit('dark');
    h.dispose();
    expect(src.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    src.emit('sepia');
    expect(hrefs()).toContain(`${HOST_THEME_CSS}?theme=dark`);
    expect(hrefs().some((x) => x.endsWith('theme=sepia'))).toBe(false);
  });
});
