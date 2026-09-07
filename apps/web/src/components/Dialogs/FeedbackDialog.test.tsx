/**
 * Component tests for FeedbackDialog.
 *
 * i18n is mocked to return translation keys as-is, so assertions match on keys
 * rather than English copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

import { FeedbackDialog } from './FeedbackDialog';

describe('FeedbackDialog', () => {
  const onClose = vi.fn();

  function stubFetch(impl: () => Promise<Response>): ReturnType<typeof vi.fn> {
    const spy = vi.fn(impl);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  function type(testId: string, value: string): void {
    const el = screen.getByTestId(testId) as HTMLTextAreaElement | HTMLInputElement;
    el.value = value;
    fireEvent.input(el, { target: el });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // console.error is expected on the failure path; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<FeedbackDialog isOpen={false} onClose={onClose} />);
    expect(container.querySelector('.feedback-dialog')).toBeNull();
  });

  it('disables submit until a message is entered', () => {
    render(<FeedbackDialog isOpen={true} onClose={onClose} />);
    const submit = screen.getByTestId('feedback-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type('feedback-message', 'Something to say');
    expect((screen.getByTestId('feedback-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('posts the message, category and contact, then shows the success state', async () => {
    const spy = stubFetch(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ ok: true }) } as Response));
    render(<FeedbackDialog isOpen={true} onClose={onClose} />);

    type('feedback-message', '  Chapter navigation is great.  ');
    type('feedback-contact', 'reader@example.com');
    const select = screen.getByTestId('feedback-category') as HTMLSelectElement;
    select.value = 'idea';
    fireEvent.change(select, { target: select });

    fireEvent.click(screen.getByTestId('feedback-submit'));

    await screen.findByTestId('feedback-success');

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/feedback');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string);
    expect(sent.message).toBe('Chapter navigation is great.');
    expect(sent.category).toBe('idea');
    expect(sent.contact).toBe('reader@example.com');
  });

  it('omits a blank contact from the payload', async () => {
    const spy = stubFetch(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ ok: true }) } as Response));
    render(<FeedbackDialog isOpen={true} onClose={onClose} />);
    type('feedback-message', 'Anonymous note');
    fireEvent.click(screen.getByTestId('feedback-submit'));
    await screen.findByTestId('feedback-success');
    expect(JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string)).not.toHaveProperty('contact');
  });

  it('keeps the user text when the submit fails', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));
    render(<FeedbackDialog isOpen={true} onClose={onClose} />);

    type('feedback-message', 'This must survive the failure');
    fireEvent.click(screen.getByTestId('feedback-submit'));

    await screen.findByTestId('feedback-error');
    expect((screen.getByTestId('feedback-message') as HTMLTextAreaElement).value)
      .toBe('This must survive the failure');
    expect(screen.queryByTestId('feedback-success')).toBeNull();
  });

  it('treats a non-2xx response as a failure and keeps the text', async () => {
    stubFetch(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) } as Response));
    render(<FeedbackDialog isOpen={true} onClose={onClose} />);
    type('feedback-message', 'still here');
    fireEvent.click(screen.getByTestId('feedback-submit'));
    await screen.findByTestId('feedback-error');
    expect((screen.getByTestId('feedback-message') as HTMLTextAreaElement).value).toBe('still here');
  });

  it('lets the user retry after a failure', async () => {
    let attempt = 0;
    const spy = stubFetch(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ ok: true }) } as Response);
    });
    render(<FeedbackDialog isOpen={true} onClose={onClose} />);
    type('feedback-message', 'retry me');
    fireEvent.click(screen.getByTestId('feedback-submit'));
    await screen.findByTestId('feedback-error');

    fireEvent.click(screen.getByTestId('feedback-submit'));
    await screen.findByTestId('feedback-success');
    expect(spy).toHaveBeenCalledTimes(2);
    // The retry resent the preserved text rather than an empty message.
    expect(JSON.parse((spy.mock.calls[1] as [string, RequestInit])[1].body as string).message).toBe('retry me');
  });

  it('disables submit while a send is in flight', async () => {
    let resolveFetch: (r: Response) => void = () => {};
    stubFetch(() => new Promise<Response>(resolve => { resolveFetch = resolve; }));
    render(<FeedbackDialog isOpen={true} onClose={onClose} />);
    type('feedback-message', 'slow network');
    fireEvent.click(screen.getByTestId('feedback-submit'));

    await waitFor(() => {
      expect((screen.getByTestId('feedback-submit') as HTMLButtonElement).disabled).toBe(true);
    });

    resolveFetch({ ok: true, status: 201, json: () => Promise.resolve({ ok: true }) } as Response);
    await screen.findByTestId('feedback-success');
  });

  it('closes on Escape', () => {
    render(<FeedbackDialog isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
