import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'es' } }),
}));

import { SiteBanners } from './SiteBanners';
import { setClientConfig } from '../utils/clientConfig';

describe('SiteBanners', () => {
  beforeEach(() => {
    localStorage.clear();
    setClientConfig({ banners: [] });
  });

  it('renders nothing without banners', () => {
    const { container } = render(<SiteBanners />);
    expect(container.querySelector('.site-banner')).toBeNull();
  });

  it('shows the UI-language message as text (no HTML), a link, and remembers a dismissal', () => {
    setClientConfig({
      banners: [{ id: 'beta', message: { en: 'Beta <b>x</b>', es: 'Prueba <b>x</b>' }, color: '#000', dismissible: true, link: { url: 'https://x.test', label: 'Feedback' } }],
    });
    const { container, rerender } = render(<SiteBanners />);
    expect(container.querySelector('.site-banner__message')!.textContent).toBe('Prueba <b>x</b>');
    expect(container.querySelector('.site-banner b')).toBeNull();
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://x.test');
    fireEvent.click(container.querySelector('.site-banner__dismiss')!);
    expect(container.querySelector('.site-banner')).toBeNull();
    rerender(<SiteBanners />);
    expect(container.querySelector('.site-banner')).toBeNull();
  });

  it('a non-dismissible banner has no close button', () => {
    setClientConfig({ banners: [{ id: 'n', message: 'Hi', dismissible: false }] });
    const { container } = render(<SiteBanners />);
    expect(container.querySelector('.site-banner__dismiss')).toBeNull();
  });
});
