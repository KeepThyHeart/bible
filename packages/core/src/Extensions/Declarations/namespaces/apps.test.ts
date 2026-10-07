/** `api.apps` and `contributes.apps` (task 0080, row 10). */

import { describe, expect, it } from 'vitest';

import { ACTIVATION_EVENT_PREFIXES, FIRED_ACTIVATION_EVENTS, isKnownActivationEvent, isFiredActivationEvent } from '../../ActivationEvents';
import { validateManifest } from '../../ExtensionManifestValidator';
import { EXTENSION_API_REGISTRY, checkMethodGate } from '../registry';

const manifest = (apps: unknown, permissions: string[] = ['ui:contribute-app']): Record<string, unknown> => ({
  id: 'ext.acme.word-count',
  name: 'Word count',
  version: '1.0.0',
  publisher: 'acme',
  engines: { bibleApp: '^0.2.0' },
  main: './main.js',
  permissions,
  contributes: { apps },
});

const good = { id: 'counts', title: 'Counts', uiEntry: 'ui/counts.html' };

function run(apps: unknown, permissions?: string[]) {
  return validateManifest(manifest(apps, permissions));
}
function errorCodes(apps: unknown): string[] {
  const r = run(apps);
  return r.ok ? [] : r.errors.map((e) => e.code);
}

describe('contributes.apps validator', () => {
  it('accepts a valid app and qualifies its id', () => {
    const r = run([
      { ...good, shortTitle: '%short%', icon: 'img/i.svg', order: 5, keepAlive: 'never', mobile: 'sheet' },
      { id: 'ext.acme.word-count.other', title: { key: 'other.title' }, uiEntry: 'o.html' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.contributes?.apps).toEqual([
      {
        id: 'ext.acme.word-count.counts',
        title: 'Counts',
        shortTitle: '%short%',
        icon: 'img/i.svg',
        uiEntry: 'ui/counts.html',
        order: 5,
        keepAlive: 'never',
        mobile: 'sheet',
      },
      { id: 'ext.acme.word-count.other', title: { key: 'other.title' }, uiEntry: 'o.html' },
    ]);
  });

  it('requires ui:contribute-app', () => {
    const r = run([good], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain('permissions.contributes-requires-permission');
  });

  it('rejects a bad id', () => {
    for (const id of ['Counts', '1x', 'a_b', '', 'a'.repeat(41), 3, undefined, 'ext.other.pub.x', 'ext.acme.word-count.Foo Bar/x:y', 'ext.acme.word-count.1x']) {
      expect(errorCodes([{ ...good, id }]).length, String(id)).toBeGreaterThan(0);
    }
  });

  it('requires title and uiEntry', () => {
    expect(errorCodes([{ id: 'a', uiEntry: 'a.html' }])).toContain('apps.title');
    expect(errorCodes([{ id: 'a', title: 'A' }])).toContain('apps.uiEntry');
    expect(errorCodes([{ ...good, title: '' }])).toContain('apps.title');
  });

  it('limits title and shortTitle length unless a %key% reference', () => {
    expect(errorCodes([{ ...good, title: 'x'.repeat(61) }])).toContain('apps.title');
    expect(errorCodes([{ ...good, title: `%${'x'.repeat(80)}%` }])).toEqual([]);
    expect(errorCodes([{ ...good, shortTitle: 'x'.repeat(25) }])).toContain('apps.title');
  });

  it('rejects unsafe or mistyped paths', () => {
    for (const uiEntry of ['../x.html', 'a/../x.html', '/abs.html', 'C:/x.html', 'https://x/y.html', 'a\\b.html', 'x.js']) {
      expect(errorCodes([{ ...good, uiEntry }]), uiEntry).toContain('apps.uiEntry');
    }
    for (const icon of ['../i.svg', '/i.svg', 'data:image/png;base64,AA.png', 'i.gif', 'i.svg.exe']) {
      expect(errorCodes([{ ...good, icon }]), icon).toContain('apps.icon');
    }
  });

  it("rejects keepAlive other than 'never'", () => {
    expect(errorCodes([{ ...good, keepAlive: 'always' }])).toContain('apps.keepAlive');
    expect(errorCodes([{ ...good, keepAlive: 'while-busy' }])).toContain('apps.keepAlive');
  });

  it('rejects out-of-range order and unknown mobile', () => {
    expect(errorCodes([{ ...good, order: 901 }])).toContain('apps.order');
    expect(errorCodes([{ ...good, order: 1.5 }])).toContain('apps.order');
    expect(errorCodes([{ ...good, mobile: 'tab' }])).toContain('apps.mobile');
  });

  it('warns about an unknown key and drops it', () => {
    const r = run([{ ...good, route: '/x' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings?.map((w) => w.code)).toContain('apps.unknownKey');
    expect(r.manifest.contributes?.apps?.[0]).not.toHaveProperty('route');
  });

  it('allows 8 apps and rejects 9', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ ...good, id: `a${i}` }));
    expect(run(mk(8)).ok).toBe(true);
    expect(errorCodes(mk(9))).toContain('apps.count');
  });

  it('rejects duplicate ids (declared and qualified forms collide)', () => {
    expect(errorCodes([good, good])).toContain('apps.duplicateId');
    expect(errorCodes([good, { ...good, id: 'ext.acme.word-count.counts' }])).toContain('apps.duplicateId');
  });

  it('rejects a non-array', () => {
    expect(run({}).ok).toBe(false);
  });
});

describe('api.apps registry wiring', () => {
  it('knows and fires onApp:<id>', () => {
    expect(ACTIVATION_EVENT_PREFIXES).toContain('onApp:');
    expect(FIRED_ACTIVATION_EVENTS).toContain('onApp:');
    expect(isKnownActivationEvent('onApp:counts')).toBe(true);
    expect(isFiredActivationEvent('onApp:counts')).toBe(true);
    const r = validateManifest({ ...manifest([good]), activationEvents: ['onApp:counts'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.activationEvents).toContain('onApp:counts');
  });

  it('gates setBadge/open on ui:contribute-app; onVisibilityChanged is local', () => {
    for (const m of ['apps.setBadge', 'apps.open', 'apps.onVisibilityChanged']) {
      const g = EXTENSION_API_REGISTRY.methodGate(m);
      expect(g?.gate, m).toBe('ui:contribute-app');
      expect(checkMethodGate(g!.gate, new Set()).ok).toBe(false);
      expect(checkMethodGate(g!.gate, new Set(['ui:contribute-app'])).ok).toBe(true);
    }
    expect(EXTENSION_API_REGISTRY.methodGate('apps.onVisibilityChanged')?.local).toBe(true);
  });

  it('is available only when granted', () => {
    expect(EXTENSION_API_REGISTRY.isNamespaceAvailable('apps', [])).toBe(false);
    expect(EXTENSION_API_REGISTRY.isNamespaceAvailable('apps', ['ui:contribute-pane'])).toBe(false);
    expect(EXTENSION_API_REGISTRY.isNamespaceAvailable('apps', ['ui:contribute-app'])).toBe(true);
  });

  it('declares the permission as prompted with consent text, and the event channel', () => {
    const p = EXTENSION_API_REGISTRY.permission('ui:contribute-app');
    expect(p?.grant).toBe('prompt');
    expect(p?.consent.key).toBe('extensionConsent.permission.uiContributeApp');
    expect(p?.consent.text).toBe('Add its own app to the app switcher, with a status badge.');
    const ch = EXTENSION_API_REGISTRY.eventChannel('app.visibilityChanged');
    expect(ch?.kind).toBe('event');
    expect(ch?.permission).toBe('ui:contribute-app');
  });
});
