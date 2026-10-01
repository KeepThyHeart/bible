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
});
