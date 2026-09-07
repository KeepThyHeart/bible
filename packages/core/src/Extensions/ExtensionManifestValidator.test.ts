/**
 * Tests for `validateManifest`. Spec A Implementation Chunk 1.
 *
 * Coverage:
 *   - Happy path: the canonical example from section "Manifest" parses cleanly.
 *   - One failing case per beyond-schema rule from section "Manifest validation rules".
 *   - Round-trip auto-prefix behavior for unprefixed contribution IDs.
 */

import { describe, expect, it } from 'vitest';

import { validateManifest } from './ExtensionManifestValidator';
import type { ExtensionManifest } from './ExtensionManifest';

// A trimmed-but-realistic manifest used as the baseline for happy-path tests.
// Each failing test starts from a structuredClone of this and breaks one rule.
function baseManifest(): Record<string, unknown> {
  return {
    id: 'ext.example.greek-tools',
    name: { key: 'extension.name' },
    version: '1.2.0',
    publisher: 'example',
    engines: { bibleApp: '^1.0.0' },
    main: 'dist/extension.js',
    permissions: ['bible:read', 'dictionary:read'],
    activationEvents: ['onView:bible'],
    contributes: {
      commands: [
        { id: 'ext.example.greek-tools.openLexicon', title: { key: 'cmd.openLexicon' } },
      ],
    },
  };
}

describe('validateManifest - happy path', () => {
  it('accepts the canonical example from spec section Manifest', () => {
    const result = validateManifest(baseManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe('ext.example.greek-tools');
      expect(result.manifest.version).toBe('1.2.0');
      expect(result.manifest.engines.bibleApp).toBe('^1.0.0');
      expect(result.manifest.contributes?.commands?.[0]?.id).toBe(
        'ext.example.greek-tools.openLexicon',
      );
    }
  });

  it('accepts the full network + webviews + contributes example', () => {
    const m = {
      ...baseManifest(),
      permissions: [
        'bible:read',
        'dictionary:read',
        'ui:contribute-pane',
        'network',
        'network:oauth',
      ],
      network: {
        allowedHosts: [
          {
            host: 'api.example.com',
            purpose: { key: 'net.purpose.lookup' },
            methods: ['GET', 'POST'],
          },
          {
            host: '*.cdn.example.com',
            purpose: { key: 'net.purpose.assets' },
          },
        ],
      },
      webviews: {
        csp: {
          'img-src': ['self', 'data:', 'https://*.cdn.example.com'],
          'connect-src': ['self', 'https://api.example.com'],
        },
      },
      contributes: {
        commands: [{ id: 'openLexicon', title: { key: 'cmd.openLexicon' } }],
        panelTypes: [
          {
            id: 'lexicon',
            title: { key: 'panel.lexicon' },
            uiEntry: 'ui/lexicon.html',
          },
        ],
        fonts: [
          {
            id: 'sblgreek',
            family: 'SBL Greek',
            files: ['fonts/SBLGreek.woff2'],
          },
        ],
        styles: [{ path: 'styles/decorations.css', scope: 'verse' }],
      },
    };
    const result = validateManifest(m);
    if (!result.ok) {
      // Surface errors so a failure prints something useful
      throw new Error(JSON.stringify(result.errors, null, 2));
    }
    expect(result.manifest.network?.allowedHosts).toHaveLength(2);
    expect(result.manifest.webviews?.csp?.['img-src']).toContain('https://*.cdn.example.com');
  });
});

describe('validateManifest - schema-level failures', () => {
  it('rejects a non-object', () => {
    const r = validateManifest('not an object');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('type');
  });

  it('rejects missing required fields', () => {
    const r = validateManifest({ name: 'foo' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const codes = r.errors.map((e) => e.path);
      expect(codes).toContain('/id');
      expect(codes).toContain('/version');
      expect(codes).toContain('/publisher');
      expect(codes).toContain('/engines');
    }
  });

  it('rejects an id that violates the pattern', () => {
    const m = baseManifest();
    m.id = 'NotKebabCase';
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.find((e) => e.path === '/id')?.code).toBe('pattern');
  });

  it('rejects a non-semver version', () => {
    const m = baseManifest();
    m.version = 'one-point-two';
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.find((e) => e.path === '/version')?.code).toBe('pattern');
  });

  it('rejects unknown top-level properties', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).bogus = 'nope';
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'additionalProperty')).toBe(true);
  });

  it('rejects an unknown permission', () => {
    const m = baseManifest();
    (m as { permissions: unknown[] }).permissions = ['bible:read', 'not-a-real-perm'];
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === '/permissions/1')).toBe(true);
  });
});

describe('validateManifest - beyond-schema rules', () => {
  it('rejects `permissions: [network]` without a network block', () => {
    const m = baseManifest();
    (m as { permissions: string[] }).permissions = ['bible:read', 'network'];
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.code === 'permissions.network-requires-hosts'),
      ).toBe(true);
    }
  });

  it('rejects `network` block with empty allowedHosts', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).permissions = ['bible:read', 'network'];
    (m as Record<string, unknown>).network = { allowedHosts: [] };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
  });

  it('rejects `network:oauth` without a network block', () => {
    const m = baseManifest();
    (m as { permissions: string[] }).permissions = ['bible:read', 'network:oauth'];
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.code === 'permissions.oauth-requires-network'),
      ).toBe(true);
    }
  });

  it('rejects an apiExports method that is not a valid identifier', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).contributes = {
      apiExports: [
        { method: 'has-dash', handlerEndpoint: 'h.x' },
      ],
    };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.path === '/contributes/apiExports/0/method' && e.code === 'pattern'),
      ).toBe(true);
    }
  });

  it('rejects a CSP host that is not in network.allowedHosts', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).permissions = ['bible:read', 'network'];
    (m as Record<string, unknown>).network = {
      allowedHosts: [{ host: 'api.example.com', purpose: 'lookup' }],
    };
    (m as Record<string, unknown>).webviews = {
      csp: { 'img-src': ['https://evil.example.com'] },
    };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.code === 'csp.host-not-allowlisted'),
      ).toBe(true);
    }
  });

  it('accepts a CSP host that matches a wildcard in allowedHosts', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).permissions = ['bible:read', 'network'];
    (m as Record<string, unknown>).network = {
      allowedHosts: [{ host: '*.cdn.example.com', purpose: 'assets' }],
    };
    (m as Record<string, unknown>).webviews = {
      csp: { 'img-src': ['https://images.cdn.example.com'] },
    };
    const r = validateManifest(m);
    expect(r.ok).toBe(true);
  });

  it('rejects a font path that contains `..`', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).contributes = {
      fonts: [
        { id: 'evil', family: 'Evil', files: ['../../etc/passwd'] },
      ],
    };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === 'path.escape')).toBe(true);
    }
  });

  it('rejects an absolute style path', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).contributes = {
      styles: [{ path: '/etc/passwd', scope: 'verse' }],
    };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === 'path.absolute')).toBe(true);
    }
  });
});

describe('validateManifest - auto-prefix round-trip', () => {
  it('auto-prepends `ext.<id>.` to unprefixed command IDs', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).contributes = {
      commands: [{ id: 'openLexicon', title: 'Open Lexicon' }],
    };
    const r = validateManifest(m);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.contributes?.commands?.[0]?.id).toBe(
        'ext.example.greek-tools.openLexicon',
      );
    }
  });

  it('leaves a correctly-prefixed ID untouched', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).contributes = {
      commands: [
        { id: 'ext.example.greek-tools.openLexicon', title: 'Open Lexicon' },
      ],
    };
    const r = validateManifest(m);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.contributes?.commands?.[0]?.id).toBe(
        'ext.example.greek-tools.openLexicon',
      );
    }
  });

  it('rejects an ID that is prefixed with a foreign extension namespace', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).contributes = {
      commands: [
        { id: 'ext.other.evil.steal', title: 'Steal' },
      ],
    };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === 'id.foreign-prefix')).toBe(true);
    }
  });

  it('auto-prefixes panel type, font, icon, and theme IDs together', () => {
    const m = baseManifest();
    (m as Record<string, unknown>).contributes = {
      panelTypes: [{ id: 'lexicon', title: 'Lexicon', uiEntry: 'ui/x.html' }],
      fonts: [{ id: 'sblgreek', family: 'SBL Greek', files: ['fonts/x.woff2'] }],
      icons: [{ id: 'lexicon-icon', path: 'icons/x.svg' }],
      themes: [{ id: 'papyrus', label: 'Papyrus', path: 'themes/p.json' }],
    };
    const r = validateManifest(m);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = r.manifest.contributes!;
      expect(c.panelTypes?.[0]?.id).toBe('ext.example.greek-tools.lexicon');
      expect(c.fonts?.[0]?.id).toBe('ext.example.greek-tools.sblgreek');
      expect(c.icons?.[0]?.id).toBe('ext.example.greek-tools.lexicon-icon');
      expect(c.themes?.[0]?.id).toBe('ext.example.greek-tools.papyrus');
    }
  });
});

describe('validateManifest - typed result', () => {
  it('returns a value that satisfies ExtensionManifest', () => {
    const r = validateManifest(baseManifest());
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Compile-time assertion: this assignment must type-check.
      const m: ExtensionManifest = r.manifest;
      expect(m.id).toBe('ext.example.greek-tools');
    }
  });
});
