import './index';
import type { KthKitApi } from './index';

const KthKit = (globalThis as unknown as { KthKit: KthKitApi }).KthKit;

// task 0076: the kit mirrors the host locale onto the panel document and follows locale.changed.
describe('KthKit document direction', () => {
  it('sets <html dir lang> from ui.getLocale and follows onLocaleChanged', async () => {
    let push: ((l: { locale: string; direction: 'ltr' | 'rtl' }) => void) | undefined;
    await KthKit.init({
      components: [],
      rpc: {
        getLocale: () => Promise.resolve({ locale: 'ar', direction: 'rtl' }),
        onLocaleChanged: (cb) => {
          push = cb;
        },
      },
    });
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    push?.({ locale: 'en', direction: 'ltr' });
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('subscribes to onLocaleChanged only once across init calls', async () => {
    const onLocaleChanged = vi.fn();
    const rpc = { getLocale: () => Promise.resolve({ locale: 'en', direction: 'ltr' as const }), onLocaleChanged };
    await KthKit.init({ components: [], rpc });
    await KthKit.init({ components: [], rpc });
    expect(onLocaleChanged).not.toHaveBeenCalled(); // already subscribed by the earlier test's init
  });
});
