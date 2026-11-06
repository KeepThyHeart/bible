import { describe, it, expect } from 'vitest';
import { isPageLeaving } from './pageLeaving';

describe('isPageLeaving', () => {
  it('is false until the page hides, and again after it is shown from the cache', () => {
    expect(isPageLeaving()).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    expect(isPageLeaving()).toBe(true);
    window.dispatchEvent(new Event('pageshow'));
    expect(isPageLeaving()).toBe(false);
  });

  it('handles a lazy-chunk rejection as handled only while leaving', () => {
    const rejection = (message: string) => {
      const event = new Event('unhandledrejection', { cancelable: true }) as Event & { reason: unknown };
      event.reason = new Error(message);
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(rejection('Unable to preload CSS for /assets/x.css')).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    expect(rejection('Unable to preload CSS for /assets/x.css')).toBe(true);
    expect(rejection('Something unrelated broke')).toBe(false);
    window.dispatchEvent(new Event('pageshow'));
  });
});
