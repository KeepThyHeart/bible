import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchSection } from './SearchSection';

let status: unknown = null;
const setConsent = vi.fn();
const refresh = vi.fn();

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (k: string, p?: Record<string, string>) => (p?.date !== undefined ? `${k}|${p.date}` : k),
    localizer: { formatDate: () => 'Oct 1, 2026' },
  }),
}));
vi.mock('../../stores/useSearchStore', () => ({
  useSearchStore: (sel: (s: unknown) => unknown) =>
    sel({ remoteSemanticStatus: status, refreshRemoteSemanticStatus: refresh, setRemoteSemanticConsent: setConsent }),
}));

const st = (consent: string, extra = {}) => ({ configured: true, consent, noticeVersion: 1, ...extra });

beforeEach(() => {
  setConsent.mockReset();
  refresh.mockReset();
});

describe('SearchSection', () => {
  it('renders nothing when not configured', () => {
    status = { configured: false, consent: 'unset', noticeVersion: 1 };
    const { container } = render(<SearchSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it('unset: checked, inactive note', () => {
    status = st('unset');
    render(<SearchSection />);
    expect(screen.getByTestId('remote-semantic-toggle')).toBeChecked();
    expect(screen.getByTestId('remote-semantic-status')).toHaveTextContent('remoteSemanticUnset');
  });

  it('granted: shows the date, and unchecking withdraws', async () => {
    status = st('granted', { consentedAt: '2026-10-01T10:00:00Z' });
    render(<SearchSection />);
    expect(screen.getByTestId('remote-semantic-status')).toHaveTextContent('remoteSemanticGranted|Oct 1, 2026');
    await userEvent.click(screen.getByTestId('remote-semantic-toggle'));
    expect(setConsent).toHaveBeenCalledWith('declined');
  });

  it('declined: unchecked, and checking clears the record', async () => {
    status = st('declined');
    render(<SearchSection />);
    expect(screen.getByTestId('remote-semantic-toggle')).not.toBeChecked();
    expect(screen.getByTestId('remote-semantic-status')).toHaveTextContent('remoteSemanticDeclined');
    await userEvent.click(screen.getByTestId('remote-semantic-toggle'));
    expect(setConsent).toHaveBeenCalledWith('reset');
  });
});
