import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => (key === 'present.previewFrameTitle' ? 'Aperçu de l’écran' : (o?.defaultValue ?? key)) }),
}));

import { PresentPreview } from './PresentPreview';

// 0209 R2 W7 item 12: the preview frame's name comes from the locale file, not a hard-coded English string.
describe('PresentPreview', () => {
  it('uses the translated frame title', () => {
    const { container } = render(<PresentPreview joinCode="ABCD" />);
    expect(container.querySelector('iframe')!.getAttribute('title')).toBe('Aperçu de l’écran');
  });
});
