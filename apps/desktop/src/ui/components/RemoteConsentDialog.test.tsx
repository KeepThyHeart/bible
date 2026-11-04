import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RemoteConsentDialog } from './RemoteConsentDialog';

const answer = vi.fn();
let open = true;

vi.mock('../contexts/useI18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock('../utils/focusTrap', () => ({ activateFocusTrap: () => ({ release: vi.fn() }) }));
vi.mock('../stores/useSearchStore', () => ({
  useSearchStore: (sel: (s: unknown) => unknown) => sel({ consentDialogOpen: open, answerRemoteConsent: answer }),
}));

beforeEach(() => {
  answer.mockReset();
  open = true;
});

describe('RemoteConsentDialog', () => {
  it('renders nothing when closed', () => {
    open = false;
    render(<RemoteConsentDialog />);
    expect(screen.queryByTestId('remote-consent-dialog')).toBeNull();
  });

  it('shows the notice and Agree grants', async () => {
    render(<RemoteConsentDialog />);
    expect(screen.getByTestId('remote-consent-dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('remote-consent-agree'));
    expect(answer).toHaveBeenCalledWith('granted');
  });

  it('Not now declines', async () => {
    render(<RemoteConsentDialog />);
    await userEvent.click(screen.getByTestId('remote-consent-decline'));
    expect(answer).toHaveBeenCalledWith('declined');
  });

  it('Escape is Not now', () => {
    render(<RemoteConsentDialog />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(answer).toHaveBeenCalledWith('declined');
  });
});

describe('RemoteConsentDialog local meaning pack option (B-003)', () => {
  it('mentions the local pack and Get opens Module Manager > Features, declining online', async () => {
    const seen: Array<CustomEvent> = [];
    const onOpen = (e: Event) => seen.push(e as CustomEvent);
    window.addEventListener('command:module:openManager', onOpen);
    try {
      render(<RemoteConsentDialog />);
      expect(screen.getByTestId('remote-consent-local')).toBeInTheDocument();
      await userEvent.click(screen.getByTestId('remote-consent-get-pack'));
      expect(answer).toHaveBeenCalledWith('declined');
      expect(seen[0]?.detail).toEqual({ moduleType: 'features' });
    } finally {
      window.removeEventListener('command:module:openManager', onOpen);
    }
  });
});
