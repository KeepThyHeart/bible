/**
 * The extension panel iframe must have no direct egress.
 *
 * Before this change `connect-src` was built from the extension's
 * `network.allowedHosts` and emitted BOTH an `https://` and an `http://`
 * origin per host, so panel UI could `fetch()` off-box while skipping the
 * throttle, the bandwidth cap, private-IP checks, redirect re-validation, and
 * the master offline switch.
 *
 * These tests pin the replacement: a constant policy whose only connect
 * target is `'self'`.
 */

import { describe, it, expect } from 'vitest';

import { buildExtensionPanelCsp } from '../extUiProtocol';

function directive(csp: string, name: string): string | undefined {
  return csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

describe('buildExtensionPanelCsp', () => {
  const csp = buildExtensionPanelCsp();

  it("allows no connect target beyond 'self'", () => {
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
  });

  it('never emits a plaintext http: origin anywhere in the policy', () => {
    expect(csp).not.toMatch(/http:\/\//);
  });

  it('names no remote host at all', () => {
    // Any scheme-qualified origin would mean a direct-egress hole reopened.
    expect(csp).not.toMatch(/https:\/\//);
  });

  it('takes no per-extension input, so no manifest can widen it', () => {
    // A constant function cannot be steered by a hostile manifest. If this
    // ever needs a parameter again, that is the moment to re-check the
    // extension-UI egress lockdown.
    expect(buildExtensionPanelCsp.length).toBe(0);
    expect(buildExtensionPanelCsp()).toBe(csp);
  });

  it('keeps the surrounding lockdown intact', () => {
    expect(directive(csp, 'default-src')).toBe("default-src 'none'");
    expect(directive(csp, 'script-src')).toBe("script-src 'self'");
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(csp, 'form-action')).toBe("form-action 'none'");
  });
});
