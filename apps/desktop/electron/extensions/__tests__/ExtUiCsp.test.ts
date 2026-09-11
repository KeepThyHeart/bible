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
 *
 * ============================================================================
 * WHY `ext-ui://host` IS NOW NAMED IN `style-src` AND `script-src`
 * ============================================================================
 *
 * That is a loosening of a policy that was tightened on purpose, so the
 * argument for it belongs here, next to the assertions, rather than only in a
 * commit message nobody will find again.
 *
 * The before/after:
 *
 *     script-src 'self'                          ->  script-src 'self' ext-ui://host
 *     style-src  'self' 'unsafe-inline'          ->  style-src  'self' ext-ui://host 'unsafe-inline'
 *
 * Nothing else moved. In particular `connect-src` is still exactly `'self'`.
 *
 * What `ext-ui://host` is:
 *
 *   - A hostname RESERVED by `extUiProtocol.ts` and matched before the
 *     extension-registry lookup, so no extension can shadow it. It is also
 *     unreachable as an extension id in the first place: manifest validation
 *     requires every id to match `^ext\.<seg>\.<seg>$`, and the bare string
 *     `host` cannot. `ExtUiProtocolHost.test.ts` pins both halves of that.
 *   - Served from this same main process, from content this process
 *     synthesizes in memory (the app's own `--theme-*` design tokens). There is
 *     no filesystem behind it, no extension input reaches it, and its response
 *     is `Cache-Control: no-store` + `X-Content-Type-Options: nosniff` under
 *     this same policy.
 *
 * So the origin admitted here is the host itself. Widening `script-src` and
 * `style-src` to it says "a panel may load code and styles from the
 * application", which was already true of `'self'` - the panel's own bundle -
 * and adds no third party, no remote host, and no attacker-controllable
 * content. That is a categorically different thing from what the `connect-src`
 * lockdown above is defending against, which is a panel talking to the
 * INTERNET behind the network gateway's back.
 *
 * Why it is needed at all: a panel cannot `<link rel="stylesheet">` the host
 * token sheet under `style-src 'self'`, because the sheet is on a different
 * origin (`ext-ui://host`) from the panel (`ext-ui://<extensionId>`). Without
 * this, serving tokens is pointless - every panel goes back to hand-guessing
 * the app's palette and drifting out of step with it, which is the exact
 * problem the token sheet exists to end.
 *
 * `script-src` is widened alongside it so a future host-owned helper script
 * (the one plausible follow-on: a tiny shim that mirrors theme changes into an
 * already-open panel) does not require re-opening this argument. If that never
 * ships, dropping `ext-ui://host` from `script-src` costs nothing and is the
 * safer default - it is listed here because the host origin is trusted, not
 * because anything currently loads from it.
 *
 * WHAT MUST NOT HAPPEN NEXT: this is a one-origin exception for the host's own
 * synthesized content. It is not a precedent for naming an EXTENSION origin
 * (`ext-ui://ext.foo.bar`) in any directive - that would let one extension
 * inject script into another's panel - and it is emphatically not a precedent
 * for `connect-src`. The tests below fail if either happens.
 */

import { describe, it, expect } from 'vitest';

import { buildExtensionPanelCsp, EXT_UI_HOST_HOSTNAME } from '../extUiProtocol';

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
    // `ext-ui://host` is not one: it is this process serving itself, and it is
    // asserted explicitly below rather than being let through by a loose regex.
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
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'");
    // Only the host renderer may frame a panel. `'none'` refused the host too,
    // which blocked every panel iframe.
    expect(directive(csp, 'frame-ancestors')).toBe('frame-ancestors file:');
    expect(directive(csp, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(csp, 'form-action')).toBe("form-action 'none'");
  });

  it('admits the reserved host origin - and only it - for styles', () => {
    // Panels `<link>` ext-ui://host/theme.css. See the module header for the
    // full justification of this widening.
    expect(directive(csp, 'style-src')).toBe("style-src 'self' ext-ui://host 'unsafe-inline'");
  });

  it('admits the reserved host origin - and only it - for scripts', () => {
    expect(directive(csp, 'script-src')).toBe("script-src 'self' ext-ui://host");
  });

  it('spells the host origin with the reserved hostname, not a literal', () => {
    // If the reservation in extUiProtocol.ts is ever renamed, the policy must
    // move with it or panels silently lose their token sheet.
    expect(csp).toContain(`ext-ui://${EXT_UI_HOST_HOSTNAME}`);
  });

  it('admits no extension origin in any directive', () => {
    // The whole point of one origin per extension is that a panel cannot pull
    // code or styles out of another extension. `ext-ui://ext.` is what such a
    // hole would look like.
    expect(csp).not.toMatch(/ext-ui:\/\/ext\./);
  });

  it('keeps the widening out of the egress-bearing directives', () => {
    // The token sheet is <link>ed, never fetch()ed. Naming the host origin in
    // connect-src (or letting it drift into img/font/media) would widen the
    // panel's reach for no gain.
    for (const name of ['connect-src', 'img-src', 'font-src', 'media-src']) {
      expect(directive(csp, name)).not.toContain('ext-ui://');
    }
  });
});
