import { describe, it, expect, beforeEach } from 'vitest';
import { setClientConfig } from './clientConfig';
import { isEnabled } from './featureFlags';

beforeEach(() => {
  setClientConfig({});
});

describe('web feature flags', () => {
  it('falls back to declared defaults with no config', () => {
    expect(isEnabled('pwa')).toBe(true);
    expect(isEnabled('audio')).toBe(false);
  });

  it('reads the server-resolved features map', () => {
    setClientConfig({ features: { audio: true, pwa: false } });
    expect(isEnabled('audio')).toBe(true);
    expect(isEnabled('pwa')).toBe(false);
  });

  it('understands an older server that only sends the individual keys', () => {
    setClientConfig({ pwaEnabled: false, showTagGraph: true, offlineDownloads: true });
    expect(isEnabled('pwa')).toBe(false);
    expect(isEnabled('tagGraph')).toBe(true);
    expect(isEnabled('offlineDownloads')).toBe(true);
  });

  it('applies requires: genealogy needs tagGraph', () => {
    setClientConfig({ features: { genealogy: true, tagGraph: false } });
    expect(isEnabled('genealogy')).toBe(false);
  });

  it('honours the dev override in development builds', () => {
    localStorage.setItem('kth.flags', 'audio,-pwa');
    try {
      expect(import.meta.env.DEV).toBe(true);
      expect(isEnabled('audio')).toBe(true);
      expect(isEnabled('pwa')).toBe(false);
    } finally {
      localStorage.removeItem('kth.flags');
    }
  });
});
