/**
 * Extension UI kit: the host-served, framework-neutral custom elements
 * (`kth-*`) an extension panel may opt into through the manifest.
 *
 * ```json
 * "uiKit": { "version": "1", "components": ["kth-book-chapter-picker"] }
 * ```
 *
 * There is **no new permission**. A kit component adds no capability the
 * panel's own code lacks; any host call it makes (`uikit.*` bridge methods) is
 * gated exactly like the panel's own calls: the method must be listed in
 * `hostMethods` of a component the manifest declares, and the extension must
 * hold that component's `requiresPermissions`. The check runs in the iframe
 * RPC bridge (`IframeRpcBridge.ts`), not in file serving.
 *
 * `ui.getLocale` is a plain `ui.*` bridge method and is NOT a `uikit.*`
 * method, so it never appears in `hostMethods`.
 *
 * Versioning: the string is the kit's major version (path `kit/<major>/`).
 * Within a major, attributes, events and `hostMethods` are additive only.
 *
 * Pure and platform-free: safe in `@bible/core/browser`.
 */

import type { ExtensionPermission } from './Permissions';

/** Kit majors the host serves. Extend (never reorder/remove within a host minor). */
export const UI_KIT_VERSIONS = ['1'] as const;
export type UiKitVersion = (typeof UI_KIT_VERSIONS)[number];

export interface UiKitComponentSpec {
  /** Custom element tag, e.g. `kth-book-chapter-picker`. */
  tag: string;
  /** `uikit.*` bridge methods this component may call. Empty when it needs none. */
  hostMethods: string[];
  /** Existing permissions the extension must hold for the component's host calls. */
  requiresPermissions: ExtensionPermission[];
}

/** Manifest `uiKit` field. */
export interface UiKitDeclaration {
  /** Kit major version; must be one of {@link UI_KIT_VERSIONS}. */
  version: string;
  /** Tags of the components the panel intends to use. No duplicates. */
  components: string[];
}

/** First-cut component allowlist, by kit major. */
export const UI_KIT_COMPONENTS: Readonly<Record<UiKitVersion, readonly UiKitComponentSpec[]>> = {
  '1': [
    // Pure core logic (books, MAX_CHAPTERS) runs inside the iframe; locale via `ui.getLocale`.
    { tag: 'kth-book-chapter-picker', hostMethods: [], requiresPermissions: [] },
    { tag: 'kth-reference-picker', hostMethods: [], requiresPermissions: [] },
    { tag: 'kth-highlight-swatch', hostMethods: [], requiresPermissions: [] },
  ],
};

/** Prefix of every bridge method that belongs to the kit. */
export const UI_KIT_METHOD_PREFIX = 'uikit.';

/** The permission a manifest needs to use `uiKit` at all (it only applies to UI panels). */
export const UI_KIT_REQUIRED_PERMISSION: ExtensionPermission = 'ui:contribute-pane';

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

export function isUiKitVersion(version: unknown): version is UiKitVersion {
  return typeof version === 'string' && (UI_KIT_VERSIONS as readonly string[]).includes(version);
}

/** Specs of a known kit major, or `[]` for an unknown one. */
export function getUiKitComponents(
  version: string,
  specs: Readonly<Record<string, readonly UiKitComponentSpec[]>> = UI_KIT_COMPONENTS,
): readonly UiKitComponentSpec[] {
  return hasOwn(specs, version) ? specs[version] : [];
}

export function findUiKitComponent(
  version: string,
  tag: string,
  specs: Readonly<Record<string, readonly UiKitComponentSpec[]>> = UI_KIT_COMPONENTS,
): UiKitComponentSpec | undefined {
  return getUiKitComponents(version, specs).find((c) => c.tag === tag);
}

export function isKnownUiKitComponent(version: string, tag: string): boolean {
  return findUiKitComponent(version, tag) !== undefined;
}

/**
 * Is `method` (a `uikit.*` bridge method) reachable for a panel whose manifest
 * declares `uiKit` and whose extension holds `grants`? Deny by default: the
 * declaration must be present, its version known, and some declared component
 * must list the method in `hostMethods` with every `requiresPermissions`
 * granted.
 */
export function isUiKitMethodAllowed(
  uiKit: UiKitDeclaration | null | undefined,
  method: string,
  grants: readonly ExtensionPermission[],
  specs: Readonly<Record<string, readonly UiKitComponentSpec[]>> = UI_KIT_COMPONENTS,
): boolean {
  if (!uiKit || typeof uiKit.version !== 'string' || !Array.isArray(uiKit.components)) return false;
  if (!hasOwn(specs, uiKit.version)) return false;
  for (const tag of uiKit.components) {
    const spec = findUiKitComponent(uiKit.version, tag, specs);
    if (!spec || !spec.hostMethods.includes(method)) continue;
    if (spec.requiresPermissions.every((p) => grants.includes(p))) return true;
  }
  return false;
}

export interface UiKitDeclarationIssue {
  /** JSON-pointer-like path relative to the `uiKit` object, e.g. `/components/1`. */
  path: string;
  code: string;
  message: string;
}

/**
 * Structural + semantic validation of a `uiKit` value (unknown input). Returns
 * an empty array when valid. The manifest validator maps these onto absolute
 * `/uiKit...` paths and adds the permission cross-check.
 */
export function validateUiKitDeclaration(value: unknown): UiKitDeclarationIssue[] {
  const issues: UiKitDeclarationIssue[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({ path: '', code: 'type', message: 'expected object' });
    return issues;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== 'version' && key !== 'components') {
      issues.push({ path: `/${key}`, code: 'additionalProperty', message: `unknown property "${key}"` });
    }
  }

  let version: string | undefined;
  if (typeof obj.version !== 'string') {
    issues.push({ path: '/version', code: 'type', message: 'expected string' });
  } else if (!isUiKitVersion(obj.version)) {
    issues.push({
      path: '/version',
      code: 'uiKit.unknown-version',
      message: `unknown UI kit version "${obj.version}"; supported: [${UI_KIT_VERSIONS.join(', ')}]`,
    });
  } else {
    version = obj.version;
  }

  if (!Array.isArray(obj.components)) {
    issues.push({ path: '/components', code: 'type', message: 'expected array' });
    return issues;
  }
  const seen = new Set<string>();
  obj.components.forEach((tag: unknown, i) => {
    const path = `/components/${i}`;
    if (typeof tag !== 'string') {
      issues.push({ path, code: 'type', message: 'expected string' });
      return;
    }
    if (seen.has(tag)) {
      issues.push({ path, code: 'uiKit.duplicate-component', message: `duplicate component "${tag}"` });
    }
    seen.add(tag);
    if (version !== undefined && !isKnownUiKitComponent(version, tag)) {
      issues.push({
        path,
        code: 'uiKit.unknown-component',
        message: `unknown component "${tag}" in UI kit version ${version}`,
      });
    }
  });
  return issues;
}
