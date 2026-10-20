import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

import { RemoteConsentDialog } from './RemoteConsentDialog';
import { remoteConsentStore } from '../../search/remote/consentStore';

describe('RemoteConsentDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    remoteConsentStore.configure({ via: 'server', noticeVersion: 1 });
  });

  it('renders nothing until a decision is requested', () => {
    render(<RemoteConsentDialog />);
    expect(screen.queryByTestId('remote-consent-dialog')).toBeNull();
  });

  it('opens as a modal dialog, without the IP sentence for via server', async () => {
    render(<RemoteConsentDialog />);
    let answer!: Promise<string>;
    act(() => { answer = remoteConsentStore.request(); });
    const dlg = await screen.findByTestId('remote-consent-dialog');
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.textContent).not.toContain('remoteSemantic.consent.ipNotice');
    fireEvent.click(screen.getByTestId('remote-consent-agree'));
    await expect(answer).resolves.toBe('granted');
    expect(screen.queryByTestId('remote-consent-dialog')).toBeNull();
  });

  it('adds the IP sentence for via browser, and Escape means Not now', async () => {
    remoteConsentStore.configure({ via: 'browser', noticeVersion: 1 });
    render(<RemoteConsentDialog />);
    let answer!: Promise<string>;
    act(() => { answer = remoteConsentStore.request(); });
    const dlg = await screen.findByTestId('remote-consent-dialog');
    expect(dlg.textContent).toContain('remoteSemantic.consent.ipNotice');
    fireEvent.keyDown(window, { key: 'Escape' });
    await expect(answer).resolves.toBe('declined');
    expect(remoteConsentStore.status).toBe('declined');
  });

  it('Not now button declines', async () => {
    render(<RemoteConsentDialog />);
    let answer!: Promise<string>;
    act(() => { answer = remoteConsentStore.request(); });
    fireEvent.click(await screen.findByTestId('remote-consent-decline'));
    await expect(answer).resolves.toBe('declined');
  });
});
