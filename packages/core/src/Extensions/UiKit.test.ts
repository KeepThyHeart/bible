import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  UI_KIT_COMPONENTS,
  UI_KIT_VERSIONS,
  findUiKitComponent,
  isKnownUiKitComponent,
  isUiKitMethodAllowed,
  isUiKitVersion,
  validateUiKitDeclaration,
  type UiKitComponentSpec,
} from './UiKit';
import { validateManifest } from './ExtensionManifestValidator';

function baseManifest(): Record<string, unknown> {
  return {
    id: 'ext.example.kit-user',
    name: 'Kit user',
    version: '1.0.0',
    publisher: 'example',
    engines: { bibleApp: '^1.0.0' },
    permissions: ['bible:read', 'ui:contribute-pane'],
    uiKit: { version: '1', components: ['kth-book-chapter-picker', 'kth-reference-picker'] },
  };
}

describe('UiKit registry', () => {
  it('has specs for every declared version, with unique kth- tags', () => {
    for (const version of UI_KIT_VERSIONS) {
      const specs = UI_KIT_COMPONENTS[version];
      expect(specs.length).toBeGreaterThan(0);
      const tags = specs.map((s) => s.tag);
      expect(new Set(tags).size).toBe(tags.length);
      for (const s of specs) {
        expect(s.tag).toMatch(/^kth-[a-z0-9-]+$/);
        // ui.getLocale is a plain ui.* method, never a kit method.
        for (const m of s.hostMethods) expect(m.startsWith('uikit.')).toBe(true);
      }
    }
  });

  it('isUiKitVersion / isKnownUiKitComponent', () => {
    expect(isUiKitVersion('1')).toBe(true);
    expect(isUiKitVersion('2')).toBe(false);
    expect(isUiKitVersion(1)).toBe(false);
    expect(isKnownUiKitComponent('1', 'kth-reference-picker')).toBe(true);
    expect(isKnownUiKitComponent('1', 'kth-nope')).toBe(false);
    expect(isKnownUiKitComponent('__proto__', 'kth-reference-picker')).toBe(false);
    expect(findUiKitComponent('constructor', 'x')).toBeUndefined();
  });

  it('schema enums match the registry', () => {
    const schema = JSON.parse(readFileSync(join(__dirname, 'ExtensionManifestSchema.json'), 'utf8')) as {
      properties: { uiKit: { properties: { version: { enum: string[] }; components: { items: { enum: string[] } } } } };
    };
    const props = schema.properties.uiKit.properties;
    expect([...props.version.enum].sort()).toEqual([...UI_KIT_VERSIONS].sort());
    const tags = UI_KIT_VERSIONS.flatMap((v) => UI_KIT_COMPONENTS[v].map((c) => c.tag));
    expect([...props.components.items.enum].sort()).toEqual([...new Set(tags)].sort());
  });
});

describe('isUiKitMethodAllowed', () => {
  const specs: Record<string, readonly UiKitComponentSpec[]> = {
    '1': [
      { tag: 'kth-a', hostMethods: ['uikit.a'], requiresPermissions: [] },
      { tag: 'kth-b', hostMethods: ['uikit.b'], requiresPermissions: ['bible:read'] },
    ],
  };
  const decl = { version: '1', components: ['kth-a', 'kth-b'] };

  it('allows a listed method with satisfied permissions', () => {
    expect(isUiKitMethodAllowed(decl, 'uikit.a', [], specs)).toBe(true);
    expect(isUiKitMethodAllowed(decl, 'uikit.b', ['bible:read'], specs)).toBe(true);
  });

  it('denies missing permissions, unlisted components, unknown methods, unknown versions, no decl', () => {
    expect(isUiKitMethodAllowed(decl, 'uikit.b', [], specs)).toBe(false);
    expect(isUiKitMethodAllowed({ version: '1', components: ['kth-a'] }, 'uikit.b', ['bible:read'], specs)).toBe(false);
    expect(isUiKitMethodAllowed(decl, 'uikit.zzz', ['bible:read'], specs)).toBe(false);
    expect(isUiKitMethodAllowed({ version: '9', components: ['kth-a'] }, 'uikit.a', [], specs)).toBe(false);
    expect(isUiKitMethodAllowed(undefined, 'uikit.a', [], specs)).toBe(false);
    expect(isUiKitMethodAllowed(null, 'uikit.a', [], specs)).toBe(false);
  });

  it('denies everything with the real registry today (no host methods yet)', () => {
    expect(isUiKitMethodAllowed({ version: '1', components: ['kth-reference-picker'] }, 'uikit.anything', ['bible:read'])).toBe(false);
  });
});

describe('validateUiKitDeclaration', () => {
  it('accepts a valid declaration, including an empty component list', () => {
    expect(validateUiKitDeclaration({ version: '1', components: ['kth-highlight-swatch'] })).toEqual([]);
    expect(validateUiKitDeclaration({ version: '1', components: [] })).toEqual([]);
  });

  it('rejects wrong shapes', () => {
    expect(validateUiKitDeclaration(null)[0]?.code).toBe('type');
    expect(validateUiKitDeclaration([])[0]?.code).toBe('type');
    expect(validateUiKitDeclaration({ version: 1, components: [] })[0]?.path).toBe('/version');
    expect(validateUiKitDeclaration({ version: '1' })[0]?.path).toBe('/components');
    expect(validateUiKitDeclaration({ version: '1', components: [3] })[0]?.path).toBe('/components/0');
    expect(validateUiKitDeclaration({ version: '1', components: [], extra: 1 })[0]?.code).toBe('additionalProperty');
  });

  it('rejects unknown version, unknown tag and duplicates', () => {
    expect(validateUiKitDeclaration({ version: '2', components: [] })[0]?.code).toBe('uiKit.unknown-version');
    expect(validateUiKitDeclaration({ version: '1', components: ['kth-nope'] })[0]?.code).toBe('uiKit.unknown-component');
    const dup = validateUiKitDeclaration({ version: '1', components: ['kth-reference-picker', 'kth-reference-picker'] });
    expect(dup.map((i) => i.code)).toEqual(['uiKit.duplicate-component']);
    expect(dup[0]?.path).toBe('/components/1');
  });
});

describe('validateManifest - uiKit', () => {
  it('accepts and passes uiKit through', () => {
    const r = validateManifest(baseManifest());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.uiKit).toEqual({ version: '1', components: ['kth-book-chapter-picker', 'kth-reference-picker'] });
  });

  it('leaves uiKit undefined when absent', () => {
    const m = baseManifest();
    delete m.uiKit;
    const r = validateManifest(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.uiKit).toBeUndefined();
  });

  it('requires ui:contribute-pane', () => {
    const m = { ...baseManifest(), permissions: ['bible:read'] };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.code)).toContain('permissions.uikit-requires-pane');
    const noPerms = baseManifest();
    delete noPerms.permissions;
    expect(validateManifest(noPerms).ok).toBe(false);
  });

  it('rejects unknown major, unknown tag and duplicates with /uiKit paths', () => {
    const cases: Array<[unknown, string, string]> = [
      [{ version: '2', components: [] }, 'uiKit.unknown-version', '/uiKit/version'],
      [{ version: '1', components: ['kth-nope'] }, 'uiKit.unknown-component', '/uiKit/components/0'],
      [{ version: '1', components: ['kth-reference-picker', 'kth-reference-picker'] }, 'uiKit.duplicate-component', '/uiKit/components/1'],
      ['1', 'type', '/uiKit'],
    ];
    for (const [uiKit, code, path] of cases) {
      const r = validateManifest({ ...baseManifest(), uiKit });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors).toContainEqual(expect.objectContaining({ code, path }));
    }
  });
});
