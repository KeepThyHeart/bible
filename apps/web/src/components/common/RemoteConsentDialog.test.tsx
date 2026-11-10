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

  it('tells the user a local meaning pack is the offline alternative (B-003)', async () => {
    render(<RemoteConsentDialog />);
    act(() => { void remoteConsentStore.request(); });
    const dlg = await screen.findByTestId('remote-consent-dialog');
    expect(dlg.textContent).toContain('remoteSemantic.consent.localOption');
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
  // W-029 / W-036
  describe('keyboard and backdrop behaviour', () => {
    it('focuses "Not now" first, not the consenting button', async () => {
      render(<RemoteConsentDialog />);
      act(() => { void remoteConsentStore.request(); });
      const decline = await screen.findByTestId('remote-consent-decline');
      await vi.waitFor(() => expect(document.activeElement).toBe(decline));
      act(() => { remoteConsentStore.decline(); });
    });

    it('traps Tab inside the dialog', async () => {
      render(<RemoteConsentDialog />);
      act(() => { void remoteConsentStore.request(); });
      const decline = await screen.findByTestId('remote-consent-decline');
      const agree = screen.getByTestId('remote-consent-agree');
      await vi.waitFor(() => expect(document.activeElement).toBe(decline));
      // Last control + Tab wraps to the first instead of leaving the dialog.
      agree.focus();
      fireEvent.keyDown(agree, { key: 'Tab' });
      expect(document.activeElement).toBe(decline);
      fireEvent.keyDown(decline, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(agree);
      act(() => { remoteConsentStore.decline(); });
    });

    it('a backdrop click means Not now; a click inside the dialog does not', async () => {
      render(<RemoteConsentDialog />);
      let answer!: Promise<string>;
      act(() => { answer = remoteConsentStore.request(); });
      const dlg = await screen.findByTestId('remote-consent-dialog');
      fireEvent.click(dlg);
      expect(remoteConsentStore.status).not.toBe('declined');
      fireEvent.click(dlg.parentElement as HTMLElement);
      await expect(answer).resolves.toBe('declined');
    });

    it('gives focus back to the opener on close', async () => {
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      opener.focus();
      render(<RemoteConsentDialog />);
      act(() => { void remoteConsentStore.request(); });
      fireEvent.click(await screen.findByTestId('remote-consent-decline'));
      await vi.waitFor(() => expect(document.activeElement).toBe(opener));
      opener.remove();
    });
  });
});
