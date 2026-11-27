import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k), i18n: { language: 'en' } }),
}));

import { audioStore } from '../audioStore';
import { buildUiRig, flush, openChapter } from '../lib/uiRig';
import { useSourceChip } from './useSourceChip';

function Chip() { return <span data-testid="chip">{useSourceChip('KJV')}</span>; }

afterEach(() => { cleanup(); audioStore.reset(); });

describe('useSourceChip', () => {
  it('shows a voice picked in the settings at once, before it plays', async () => {
    const rig = buildUiRig({ recordings: false });
    rig.tts.voiceList = [
      { id: 'amy', label: 'Amy', language: 'en-US' },
      { id: 'ben', label: 'Ben', language: 'en-US' },
    ];
    await openChapter();
    await flush();
    audioStore.setPrefs({ source: 'tts:fake' });
    audioStore.invalidateSources('KJV');
    render(<Chip />);
    await waitFor(() => expect(screen.getByTestId('chip').textContent).toContain('Amy'));
    audioStore.setEngineVoice('fake', 'en', 'ben');
    await waitFor(() => expect(screen.getByTestId('chip').textContent).toContain('Ben'));
  });
});
