/**
 * Acceptance check for task 0086: a namespace added through the declaration
 * layer gets its typings, consent text, manifest vocabulary (permission,
 * activation event, `contributes` key) and method gates with no edit outside
 * its declaration plus registration. `echoNamespace` below is the worked
 * example from `docs/features/extension-api-namespaces.md`, kept verbatim so
 * the doc cannot drift from code that compiles and passes.
 *
 * "Registration" here is `createApiRegistry([...API_NAMESPACES, echo])` - the
 * same list `registry.ts` builds the shared registry from - so the sample
 * never ships. The generated test fake is checked in
 * `@bible/extension-testing` (`createMockApi.declared.test.ts`), and the
 * desktop guard in `DeclaredApiGuard.test.ts`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import { validateManifest } from '../ExtensionManifestValidator';
import {
  defineApiNamespace,
  eventChannel,
  fakeReturns,
  type ExtensionApiOf,
} from './defineApiNamespace';
import { API_NAMESPACES, createApiRegistry } from './registry';

// --- The worked example (docs/features/extension-api-namespaces.md) --------

/** `api.echo` - repeats text back. A sample, not a shipped API. */
export interface IEchoApi {
  /** Repeat `text` back unchanged. Open to every extension. */
  say(text: string): Promise<string>;
  /** Repeat `text` back in capitals. Needs `echo:shout`. */
  shout(text: string): Promise<string>;
}

export const echoNamespace = defineApiNamespace<IEchoApi>()({
  name: 'echo',
  description: 'Repeats text back - the worked example for adding a namespace.',
  since: '0.1.1',
  optional: true,
  permissions: [
    {
      id: 'echo:shout',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.echoShout',
        text: 'Repeat things back to you in capitals.',
      },
      since: '0.1.1',
    },
  ],
  methods: {
    say: { permission: null, fake: fakeReturns('') },
    shout: { permission: 'echo:shout', fake: fakeReturns('') },
  },
  activationEvents: [
    {
      event: 'onEcho:',
      fired: false,
      description: 'Someone said the phrase after the colon.',
      since: '0.1.1',
    },
  ],
  contributes: [
    {
      key: 'echoes',
      description: 'Phrases the extension wants repeated.',
      since: '0.1.1',
      requiresPermission: 'echo:shout',
      validate: (value, path, ctx) => {
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && v.length > 0)) {
          ctx.error(path, 'type', 'expected an array of non-empty strings');
          return undefined;
        }
        return value as string[];
      },
      jsonSchema: { type: 'array', items: { type: 'string', minLength: 1 } },
    },
  ],
  events: {
    'echo.heard': eventChannel<{ text: string }>({
      kind: 'event',
      permission: 'echo:shout',
      description: 'The host repeated one of the contributed phrases.',
      since: '0.1.1',
    }),
  },
});

// --- Checks ----------------------------------------------------------------

const registry = createApiRegistry([...API_NAMESPACES, echoNamespace]);

const manifest = (extra: Record<string, unknown>): Record<string, unknown> => ({
  id: 'ext.acme.echo-demo',
  name: 'Echo demo',
  version: '1.0.0',
  publisher: 'acme',
  engines: { bibleApp: '^0.1.0' },
  main: './main.js',
  ...extra,
});

describe('a namespace added through the declaration layer', () => {
  it('gets typings: an optional member of the api object', () => {
    type Api = ExtensionApiOf<readonly [...typeof API_NAMESPACES, typeof echoNamespace]>;
    expectTypeOf<Api['echo']>().toEqualTypeOf<IEchoApi | undefined>();
    expectTypeOf<Api['notes']>().not.toEqualTypeOf<undefined>();
  });

  it('gets consent text and a grant policy', () => {
    const p = registry.permission('echo:shout');
    expect(p?.consent.text).toBe('Repeat things back to you in capitals.');
    expect(p?.grant).toBe('prompt');
    expect(p?.namespace).toBe('echo');
  });

  it('gets per-method gates', () => {
    expect(registry.methodGate('echo.shout')?.gate).toBe('echo:shout');
    expect(registry.methodGate('echo.say')?.gate).toBeNull();
    expect(registry.eventChannel('echo.heard')?.permission).toBe('echo:shout');
  });

  it('is accepted by the manifest validator of a host that knows it', () => {
    const r = validateManifest(
      manifest({
        permissions: ['echo:shout'],
        activationEvents: ['onEcho:hello'],
        contributes: { echoes: ['hello'] },
      }),
      { registry },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toBeUndefined();
    expect(r.manifest.permissions).toEqual(['echo:shout']);
    expect(r.manifest.activationEvents).toEqual(['onEcho:hello']);
    expect(r.manifest.contributes?.['echoes']).toEqual(['hello']);
  });

  it("runs the key's validator and its permission requirement", () => {
    const bad = validateManifest(manifest({ permissions: ['echo:shout'], contributes: { echoes: [3] } }), {
      registry,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.path)).toContain('/contributes/echoes');

    const noPerm = validateManifest(manifest({ contributes: { echoes: ['hi'] } }), { registry });
    expect(noPerm.ok).toBe(false);
    if (!noPerm.ok) {
      expect(noPerm.errors.map((e) => e.code)).toContain('permissions.contributes-requires-permission');
    }
  });

  it('degrades on a host that predates it: loads, with warnings, without the unknown parts', () => {
    const r = validateManifest(
      manifest({
        permissions: ['echo:shout', 'notes:read'],
        activationEvents: ['onEcho:hello', 'onStartupFinished'],
        contributes: { echoes: ['hello'] },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.permissions).toEqual(['notes:read']);
    expect(r.manifest.activationEvents).toEqual(['onStartupFinished']);
    expect(r.manifest.contributes?.['echoes']).toBeUndefined();
    expect(r.warnings?.map((w) => w.code).sort()).toEqual(
      ['activation.unknown', 'contributes.unknown', 'permission.unknown'].sort(),
    );
  });
});
