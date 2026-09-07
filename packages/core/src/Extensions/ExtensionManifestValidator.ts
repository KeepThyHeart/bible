/**
 * Hand-written validator for `extension.json`.
 *
 * Spec A section "Manifest" + section "Manifest validation rules" + Implementation Chunk 1.
 *
 * Mirrors `ExtensionManifestSchema.json` (the canonical authoring schema) but
 * does the work in TypeScript so `@bible/core` does not need to pull in AJV
 * (which would add a runtime dependency to a package that has none today).
 *
 * Output:
 *   - On success: a typed `ExtensionManifest` with auto-prefixed contribution
 *     IDs (`ext.<id>.foo` is left alone; `foo` becomes `ext.<id>.foo`).
 *   - On failure: a list of `ManifestValidationError`s, each pointing at the
 *     offending field via a JSON-pointer-like `path` so the loader can render
 *     a useful error toast.
 *
 * Rules enforced beyond pure schema:
 *   - `permissions` containing `network` requires `network.allowedHosts`
 *     non-empty.
 *   - `permissions` containing `network:oauth` requires `network`.
 *   - Command / panel / provider / display-mode / file-importer / theme /
 *     font / icon / api-export IDs must start with `ext.<id>.` or be
 *     unprefixed (validator auto-prepends).
 *   - `apiExports[*].method` must be a valid JS identifier.
 *   - `webviews.csp` URL sources (anything with `://` or `*.host`) must
 *     reference a host in `network.allowedHosts`. CSP keyword tokens
 *     (`self`, `data:`, `blob:`, `none`, `unsafe-inline`, `unsafe-eval`)
 *     are allowed.
 *   - Font/style/icon/theme `path` entries must not contain `..` segments
 *     and must not start with `/` (must resolve under the package root).
 */

import type {
  AllowedNetworkHost,
  ContributedApiExport,
  ContributedCommand,
  ContributedFileImporter,
  ContributedFont,
  ContributedIcon,
  ContributedMenuItem,
  ContributedStyle,
  ContributedTheme,
  ExtensionContributes,
  ExtensionManifest,
  ExtensionNetworkConfig,
  ExtensionPrivacyConfig,
  DataCollectionCategory,
  ExtensionRuntimeConfig,
  ExtensionWebviewCsp,
  ExtensionWebviewsConfig,
  PricingTier,
} from './ExtensionManifest';
import type { ExtensionPermission } from './Permissions';
import type {
  BookProviderDescriptor,
  CommentaryProviderDescriptor,
  DictionaryProviderDescriptor,
  DisplayModeDescriptor,
  ExtensionPanelTypeDef,
  KeybindingDescriptor,
  LocalizedString,
} from './ExtensionApiDtos';

// --- Result shape ----------------------------------------------------------

export interface ManifestValidationError {
  /** JSON-pointer-style path to the offending value, e.g. `/contributes/commands/0/id`. */
  path: string;
  /** Stable, machine-readable error code. */
  code: string;
  /** Human-readable message. Safe to surface in a toast. */
  message: string;
}

export type ManifestValidationResult =
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; errors: ManifestValidationError[] };

// --- Constants mirrored from the JSON Schema -------------------------------

const ID_PATTERN = /^ext\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PUBLISHER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const ALLOWED_PERMISSIONS: readonly ExtensionPermission[] = [
  'bible:read',
  'commentary:read',
  'dictionary:read',
  'book:read',
  'notes:read',
  'notes:write',
  'highlights:read',
  'highlights:write',
  'bookmarks:read',
  'bookmarks:write',
  'commentary:provide',
  'dictionary:provide',
  'book:provide',
  'search:provide',
  'display-mode:provide',
  'import:provide',
  'ai:provide',
  'tts:provide',
  'storage',
  'storage:secrets',
  'storage:database',
  'ui:contribute-pane',
  'ui:verse-decorator',
  'ui:verse-hover',
  'ui:context-menu',
  'ui:notification',
  'ui:status-bar',
  'commands:register',
  'tasks',
  'network',
  'network:oauth',
  'extensions:call',
  'fs:read-user',
  'fs:write-user',
  'fs:managed-folder',
];

const ALLOWED_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
const ALLOWED_PRICING: readonly PricingTier[] = ['free', 'freemium', 'paid'];
const ALLOWED_DISPLAY_MODE_KINDS = ['overlay', 'replace'] as const;
const ALLOWED_STYLE_SCOPES = ['verse', 'panel', 'global'] as const;
const ALLOWED_PANEL_BUCKETS = ['left', 'right', 'bottom', 'unknown'] as const;
const ALLOWED_COMMENTARY_CAPABILITIES = [
  'lookup',
  'range',
  'iterate',
  'similarity',
  'remote',
] as const;
const ALLOWED_DICTIONARY_CAPABILITIES = [
  'lookup',
  'search',
  'iterate',
  'strongs',
  'lemma',
  'morphology',
  'remote',
] as const;
const ALLOWED_BOOK_CAPABILITIES = ['lookup', 'iterate', 'remote'] as const;

const CSP_KEYWORD_TOKENS = new Set([
  'self',
  'none',
  'data:',
  'blob:',
  'unsafe-inline',
  'unsafe-eval',
]);

/** Top-level keys the schema declares - anything else triggers `additionalProperty`. */
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  '$schema',
  'id',
  'name',
  'displayName',
  'version',
  'publisher',
  'description',
  'categories',
  'keywords',
  'homepage',
  'repository',
  'bugs',
  'license',
  'pricing',
  'icon',
  'preview',
  'engines',
  'main',
  'permissions',
  'network',
  'privacy',
  'webviews',
  'activationEvents',
  'contributes',
  'runtime',
  'l10n',
]);

const ALLOWED_CONTRIBUTES_KEYS = new Set([
  'commands',
  'panelTypes',
  'menus',
  'configuration',
  'providers',
  'displayModes',
  'themes',
  'fonts',
  'icons',
  'styles',
  'fileImporters',
  'apiExports',
  'commentaryProviders',
  'dictionaryProviders',
  'bookProviders',
]);

// --- Validator core --------------------------------------------------------

class Validator {
  readonly errors: ManifestValidationError[] = [];

  add(path: string, code: string, message: string): void {
    this.errors.push({ path, code, message });
  }

  /** Returns true iff `v` is a non-null, non-array object. */
  isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  requireString(path: string, v: unknown): v is string {
    if (typeof v !== 'string') {
      this.add(path, 'type', `expected string, got ${typeName(v)}`);
      return false;
    }
    return true;
  }

  requireBool(path: string, v: unknown): v is boolean {
    if (typeof v !== 'boolean') {
      this.add(path, 'type', `expected boolean, got ${typeName(v)}`);
      return false;
    }
    return true;
  }

  requireArray(path: string, v: unknown): v is unknown[] {
    if (!Array.isArray(v)) {
      this.add(path, 'type', `expected array, got ${typeName(v)}`);
      return false;
    }
    return true;
  }

  requireRecord(path: string, v: unknown): v is Record<string, unknown> {
    if (!this.isRecord(v)) {
      this.add(path, 'type', `expected object, got ${typeName(v)}`);
      return false;
    }
    return true;
  }

  pattern(path: string, v: string, re: RegExp, code: string, message: string): boolean {
    if (!re.test(v)) {
      this.add(path, code, message);
      return false;
    }
    return true;
  }

  enum<T extends string>(
    path: string,
    v: unknown,
    allowed: readonly T[],
    code = 'enum',
  ): v is T {
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      this.add(
        path,
        code,
        `expected one of [${allowed.join(', ')}], got ${JSON.stringify(v)}`,
      );
      return false;
    }
    return true;
  }

  noAdditionalProperties(
    path: string,
    obj: Record<string, unknown>,
    allowed: ReadonlySet<string>,
  ): void {
    for (const key of Object.keys(obj)) {
      if (!allowed.has(key)) {
        this.add(`${path}/${key}`, 'additionalProperty', `unknown property "${key}"`);
      }
    }
  }
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// --- LocalizedString -------------------------------------------------------

function validateLocalizedString(
  v: Validator,
  path: string,
  value: unknown,
): LocalizedString | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (!v.requireRecord(path, value)) return undefined;
  if (!('key' in value) || typeof value.key !== 'string') {
    v.add(`${path}/key`, 'required', 'LocalizedString object must have a string `key`');
    return undefined;
  }
  const allowed = new Set(['key', 'params']);
  v.noAdditionalProperties(path, value, allowed);
  if ('params' in value && !v.isRecord(value.params)) {
    v.add(`${path}/params`, 'type', 'LocalizedString.params must be an object');
  }
  return value as LocalizedString;
}

// --- Identity / marketplace ------------------------------------------------

function validateIdentity(
  v: Validator,
  m: Record<string, unknown>,
): { id?: string } {
  // id
  let id: string | undefined;
  if (!('id' in m)) {
    v.add('/id', 'required', '`id` is required');
  } else if (v.requireString('/id', m.id)) {
    if (v.pattern('/id', m.id, ID_PATTERN, 'pattern',
      '`id` must match `ext.<publisher>.<name>` (lowercase, kebab-case)')) {
      id = m.id;
    }
  }

  // name (required)
  if (!('name' in m)) {
    v.add('/name', 'required', '`name` is required');
  } else {
    validateLocalizedString(v, '/name', m.name);
  }

  // displayName, description (optional)
  if ('displayName' in m) validateLocalizedString(v, '/displayName', m.displayName);
  if ('description' in m) validateLocalizedString(v, '/description', m.description);

  // version
  if (!('version' in m)) {
    v.add('/version', 'required', '`version` is required');
  } else if (v.requireString('/version', m.version)) {
    v.pattern('/version', m.version, SEMVER_PATTERN, 'pattern',
      '`version` must be a valid semver string');
  }

  // publisher
  if (!('publisher' in m)) {
    v.add('/publisher', 'required', '`publisher` is required');
  } else if (v.requireString('/publisher', m.publisher)) {
    v.pattern('/publisher', m.publisher, PUBLISHER_PATTERN, 'pattern',
      '`publisher` must be lowercase kebab-case');
  }

  // Marketplace metadata - all optional
  if ('categories' in m) validateStringArray(v, '/categories', m.categories);
  if ('keywords' in m) validateStringArray(v, '/keywords', m.keywords);
  if ('homepage' in m) v.requireString('/homepage', m.homepage);
  if ('repository' in m) v.requireString('/repository', m.repository);
  if ('bugs' in m) v.requireString('/bugs', m.bugs);
  if ('license' in m) v.requireString('/license', m.license);
  if ('pricing' in m) v.enum('/pricing', m.pricing, ALLOWED_PRICING, 'enum');
  if ('icon' in m) {
    if (v.requireString('/icon', m.icon)) validatePackagePath(v, '/icon', m.icon);
  }
  if ('preview' in m) v.requireBool('/preview', m.preview);
  if ('$schema' in m) v.requireString('/$schema', m['$schema']);

  return { id };
}

function validateStringArray(v: Validator, path: string, value: unknown): void {
  if (!v.requireArray(path, value)) return;
  value.forEach((entry, i) => {
    v.requireString(`${path}/${i}`, entry);
  });
}

// Path containment: no `..` segments, no absolute paths.
function validatePackagePath(v: Validator, path: string, value: string): boolean {
  if (value.length === 0) {
    v.add(path, 'path.empty', 'path must be non-empty');
    return false;
  }
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    v.add(path, 'path.absolute', 'path must be relative to the extension package root');
    return false;
  }
  const segments = value.split(/[\\/]+/);
  if (segments.some((s) => s === '..')) {
    v.add(path, 'path.escape', 'path must not contain `..` segments');
    return false;
  }
  return true;
}

// --- Engines ---------------------------------------------------------------

function validateEngines(v: Validator, m: Record<string, unknown>): void {
  if (!('engines' in m)) {
    v.add('/engines', 'required', '`engines` is required');
    return;
  }
  if (!v.requireRecord('/engines', m.engines)) return;
  v.noAdditionalProperties('/engines', m.engines, new Set(['bibleApp']));
  if (!('bibleApp' in m.engines)) {
    v.add('/engines/bibleApp', 'required', '`engines.bibleApp` is required');
  } else {
    v.requireString('/engines/bibleApp', m.engines.bibleApp);
  }
}

// --- Permissions -----------------------------------------------------------

function validatePermissions(v: Validator, value: unknown): ExtensionPermission[] | undefined {
  if (!v.requireArray('/permissions', value)) return undefined;
  const out: ExtensionPermission[] = [];
  const seen = new Set<string>();
  value.forEach((perm, i) => {
    const path = `/permissions/${i}`;
    if (typeof perm !== 'string') {
      v.add(path, 'type', `expected string, got ${typeName(perm)}`);
      return;
    }
    if (!(ALLOWED_PERMISSIONS as readonly string[]).includes(perm)) {
      v.add(path, 'enum', `unknown permission "${perm}"`);
      return;
    }
    if (seen.has(perm)) {
      v.add(path, 'unique', `duplicate permission "${perm}"`);
      return;
    }
    seen.add(perm);
    out.push(perm as ExtensionPermission);
  });
  return out;
}

// --- Network ---------------------------------------------------------------

function validateNetwork(v: Validator, value: unknown): ExtensionNetworkConfig | undefined {
  if (!v.requireRecord('/network', value)) return undefined;
  v.noAdditionalProperties('/network', value, new Set(['allowedHosts']));
  if (!('allowedHosts' in value)) {
    v.add('/network/allowedHosts', 'required', '`network.allowedHosts` is required');
    return undefined;
  }
  if (!v.requireArray('/network/allowedHosts', value.allowedHosts)) return undefined;
  if (value.allowedHosts.length === 0) {
    v.add('/network/allowedHosts', 'minItems', '`network.allowedHosts` must be non-empty');
  }
  const hosts: AllowedNetworkHost[] = [];
  value.allowedHosts.forEach((host, i) => {
    const path = `/network/allowedHosts/${i}`;
    const validated = validateAllowedHost(v, path, host);
    if (validated) hosts.push(validated);
  });
  return { allowedHosts: hosts };
}

function validateAllowedHost(
  v: Validator,
  path: string,
  value: unknown,
): AllowedNetworkHost | undefined {
  if (!v.requireRecord(path, value)) return undefined;
  v.noAdditionalProperties(path, value, new Set(['host', 'purpose', 'methods']));
  if (!('host' in value) || typeof value.host !== 'string' || value.host.length === 0) {
    v.add(`${path}/host`, 'required', '`host` is required and must be a non-empty string');
    return undefined;
  }
  if (!('purpose' in value)) {
    v.add(`${path}/purpose`, 'required', '`purpose` is required');
    return undefined;
  }
  const purpose = validateLocalizedString(v, `${path}/purpose`, value.purpose);
  let methods: AllowedNetworkHost['methods'];
  if ('methods' in value) {
    if (v.requireArray(`${path}/methods`, value.methods)) {
      const out: NonNullable<AllowedNetworkHost['methods']> = [];
      const seen = new Set<string>();
      value.methods.forEach((method, i) => {
        const mp = `${path}/methods/${i}`;
        if (v.enum(mp, method, ALLOWED_HTTP_METHODS, 'enum')) {
          if (seen.has(method)) {
            v.add(mp, 'unique', `duplicate method "${method}"`);
          } else {
            seen.add(method);
            out.push(method);
          }
        }
      });
      methods = out;
    }
  }
  if (!purpose) return undefined;
  return methods === undefined
    ? { host: value.host, purpose }
    : { host: value.host, purpose, methods };
}

// --- Webviews / CSP --------------------------------------------------------

function validateWebviews(
  v: Validator,
  value: unknown,
  allowedHosts: AllowedNetworkHost[] | undefined,
): ExtensionWebviewsConfig | undefined {
  if (!v.requireRecord('/webviews', value)) return undefined;
  v.noAdditionalProperties('/webviews', value, new Set(['csp']));
  if (!('csp' in value)) return {};
  if (!v.requireRecord('/webviews/csp', value.csp)) return undefined;
  const directives = ['img-src', 'font-src', 'style-src', 'connect-src', 'media-src', 'frame-src'];
  v.noAdditionalProperties('/webviews/csp', value.csp, new Set(directives));
  const csp: ExtensionWebviewCsp = {};
  for (const directive of directives) {
    if (!(directive in value.csp)) continue;
    const sources = (value.csp as Record<string, unknown>)[directive];
    const path = `/webviews/csp/${directive}`;
    if (!v.requireArray(path, sources)) continue;
    const out: string[] = [];
    sources.forEach((src, i) => {
      const sp = `${path}/${i}`;
      if (typeof src !== 'string') {
        v.add(sp, 'type', `expected string, got ${typeName(src)}`);
        return;
      }
      if (!isCspSourceAllowed(src, allowedHosts)) {
        v.add(
          sp,
          'csp.host-not-allowlisted',
          `CSP source "${src}" must be a keyword token, a literal asset path, or a host present in network.allowedHosts`,
        );
        return;
      }
      out.push(src);
    });
    (csp as Record<string, string[]>)[directive] = out;
  }
  return { csp };
}

function isCspSourceAllowed(
  src: string,
  allowedHosts: AllowedNetworkHost[] | undefined,
): boolean {
  if (CSP_KEYWORD_TOKENS.has(src)) return true;
  // URL form: scheme://host[/path]
  const urlMatch = /^[a-z]+:\/\/([^/]+)/i.exec(src);
  if (urlMatch) {
    const host = urlMatch[1];
    return hostMatchesAny(host, allowedHosts);
  }
  // Wildcard host without scheme, e.g. *.cdn.example.com
  if (src.startsWith('*.') || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(src)) {
    return hostMatchesAny(src, allowedHosts);
  }
  // Otherwise treated as a literal asset path (relative to ext-ui://) - fine.
  return true;
}

function hostMatchesAny(
  candidate: string,
  allowedHosts: AllowedNetworkHost[] | undefined,
): boolean {
  if (!allowedHosts) return false;
  return allowedHosts.some((entry) => hostMatches(candidate, entry.host));
}

function hostMatches(candidate: string, allowedPattern: string): boolean {
  if (candidate === allowedPattern) return true;
  if (allowedPattern.startsWith('*.')) {
    const suffix = allowedPattern.slice(2); // strip leading "*."
    if (candidate === suffix) return true;
    return candidate.endsWith('.' + suffix);
  }
  // candidate is a wildcard, allowed is a bare host - only matches if literal
  return false;
}

// --- Activation events -----------------------------------------------------

function validateActivationEvents(v: Validator, value: unknown): string[] | undefined {
  if (!v.requireArray('/activationEvents', value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, i) => {
    const path = `/activationEvents/${i}`;
    if (typeof entry !== 'string' || entry.length === 0) {
      v.add(path, 'type', 'activation event must be a non-empty string');
      return;
    }
    if (seen.has(entry)) {
      v.add(path, 'unique', `duplicate activation event "${entry}"`);
      return;
    }
    seen.add(entry);
    out.push(entry);
  });
  return out;
}

// --- Runtime config -------------------------------------------------------

const ALLOWED_DATA_COLLECTION: readonly string[] = [
  'analytics',
  'crash-reports',
  'user-content',
  'personalization',
  'none',
];

function validatePrivacy(
  v: Validator,
  value: unknown,
): ExtensionPrivacyConfig | undefined {
  if (!v.requireRecord('/privacy', value)) return undefined;
  v.noAdditionalProperties('/privacy', value, new Set(['dataCollection', 'privacyPolicyUrl']));

  if (!('dataCollection' in value)) {
    v.add('/privacy/dataCollection', 'required', '`privacy.dataCollection` is required');
    return undefined;
  }
  if (!v.requireArray('/privacy/dataCollection', value.dataCollection)) return undefined;
  if (value.dataCollection.length === 0) {
    v.add('/privacy/dataCollection', 'minItems', '`privacy.dataCollection` must be non-empty');
  }
  const categories: DataCollectionCategory[] = [];
  const seen = new Set<string>();
  value.dataCollection.forEach((cat: unknown, i: number) => {
    const path = `/privacy/dataCollection/${i}`;
    if (v.enum(path, cat, ALLOWED_DATA_COLLECTION, 'enum')) {
      if (seen.has(cat as string)) {
        v.add(path, 'unique', `duplicate category "${cat as string}"`);
      } else {
        seen.add(cat as string);
        categories.push(cat as DataCollectionCategory);
      }
    }
  });

  const out: ExtensionPrivacyConfig = { dataCollection: categories };
  if ('privacyPolicyUrl' in value) {
    if (v.requireString('/privacy/privacyPolicyUrl', value.privacyPolicyUrl)) {
      out.privacyPolicyUrl = value.privacyPolicyUrl;
    }
  }
  return out;
}

function validateRuntime(
  v: Validator,
  value: unknown,
): ExtensionRuntimeConfig | undefined {
  if (!v.requireRecord('/runtime', value)) return undefined;
  v.noAdditionalProperties('/runtime', value, new Set(['maxMemoryMB']));

  const out: ExtensionRuntimeConfig = {};

  if ('maxMemoryMB' in value) {
    const raw = value.maxMemoryMB;
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      v.add('/runtime/maxMemoryMB', 'type', '`runtime.maxMemoryMB` must be an integer');
    } else if (raw < 256 || raw > 1024) {
      v.add(
        '/runtime/maxMemoryMB',
        'range',
        '`runtime.maxMemoryMB` must be between 256 and 1024',
      );
    } else {
      out.maxMemoryMB = raw;
    }
  }

  return out;
}

// --- Contributions ---------------------------------------------------------

interface ContributionContext {
  /** The validated extension id used to auto-prefix contribution ids. */
  extId: string | undefined;
}

function validateContributes(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): ExtensionContributes | undefined {
  if (!v.requireRecord('/contributes', value)) return undefined;
  v.noAdditionalProperties('/contributes', value, ALLOWED_CONTRIBUTES_KEYS);
  const out: ExtensionContributes = {};

  if ('commands' in value) {
    out.commands = validateContributedCommands(v, value.commands, ctx);
  }
  if ('panelTypes' in value) {
    out.panelTypes = validatePanelTypes(v, value.panelTypes, ctx);
  }
  if ('menus' in value) {
    out.menus = validateMenus(v, value.menus);
  }
  if ('configuration' in value) {
    out.configuration = validateConfiguration(v, value.configuration);
  }
  if ('providers' in value) {
    out.providers = validateProviderRoles(v, value.providers);
  }
  if ('displayModes' in value) {
    out.displayModes = validateDisplayModes(v, value.displayModes, ctx);
  }
  if ('themes' in value) {
    out.themes = validateThemes(v, value.themes, ctx);
  }
  if ('fonts' in value) {
    out.fonts = validateFonts(v, value.fonts, ctx);
  }
  if ('icons' in value) {
    out.icons = validateIcons(v, value.icons, ctx);
  }
  if ('styles' in value) {
    out.styles = validateStyles(v, value.styles);
  }
  if ('fileImporters' in value) {
    out.fileImporters = validateFileImporters(v, value.fileImporters, ctx);
  }
  if ('apiExports' in value) {
    out.apiExports = validateApiExports(v, value.apiExports);
  }
  if ('commentaryProviders' in value) {
    out.commentaryProviders = validateCommentaryProviders(v, value.commentaryProviders, ctx);
  }
  if ('dictionaryProviders' in value) {
    out.dictionaryProviders = validateDictionaryProviders(v, value.dictionaryProviders, ctx);
  }
  if ('bookProviders' in value) {
    out.bookProviders = validateBookProviders(v, value.bookProviders, ctx);
  }

  return out;
}

/**
 * Auto-prefix a contribution id with `ext.<id>.` if not already prefixed.
 * Returns the (possibly transformed) id, or `undefined` if validation fails.
 */
function normalizeId(
  v: Validator,
  path: string,
  rawId: unknown,
  ctx: ContributionContext,
): string | undefined {
  if (typeof rawId !== 'string' || rawId.length === 0) {
    v.add(path, 'type', '`id` must be a non-empty string');
    return undefined;
  }
  if (!ctx.extId) {
    // Cannot auto-prefix without a valid extension id; the top-level id error
    // is already reported, so just pass the value through.
    return rawId;
  }
  const requiredPrefix = `ext.${stripExtPrefix(ctx.extId)}.`;
  if (rawId.startsWith('ext.')) {
    if (!rawId.startsWith(requiredPrefix)) {
      v.add(
        path,
        'id.foreign-prefix',
        `id "${rawId}" is prefixed but does not start with "${requiredPrefix}"`,
      );
      return undefined;
    }
    return rawId;
  }
  return requiredPrefix + rawId;
}

function stripExtPrefix(extId: string): string {
  // extId looks like "ext.publisher.name" - return the "publisher.name" portion.
  return extId.startsWith('ext.') ? extId.slice(4) : extId;
}

function validateContributedCommands(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): ContributedCommand[] | undefined {
  if (!v.requireArray('/contributes/commands', value)) return undefined;
  const out: ContributedCommand[] = [];
  value.forEach((cmd, i) => {
    const path = `/contributes/commands/${i}`;
    if (!v.requireRecord(path, cmd)) return;
    v.noAdditionalProperties(
      path,
      cmd,
      new Set(['id', 'title', 'category', 'shortcut', 'when', 'handlerEndpoint', 'order', 'hidden']),
    );
    if (!('id' in cmd)) {
      v.add(`${path}/id`, 'required', '`id` is required');
      return;
    }
    const id = normalizeId(v, `${path}/id`, cmd.id, ctx);
    if (!id) return;
    if (!('title' in cmd)) {
      v.add(`${path}/title`, 'required', '`title` is required');
      return;
    }
    const title = validateLocalizedString(v, `${path}/title`, cmd.title);
    if (!title) return;
    const command: ContributedCommand = { id, title };
    if ('category' in cmd) {
      const cat = validateLocalizedString(v, `${path}/category`, cmd.category);
      if (cat) command.category = cat;
    }
    if ('shortcut' in cmd) {
      const sc = validateShortcut(v, `${path}/shortcut`, cmd.shortcut);
      if (sc) command.shortcut = sc;
    }
    if ('when' in cmd && v.requireString(`${path}/when`, cmd.when)) command.when = cmd.when;
    if ('handlerEndpoint' in cmd && v.requireString(`${path}/handlerEndpoint`, cmd.handlerEndpoint)) {
      command.handlerEndpoint = cmd.handlerEndpoint;
    }
    if ('order' in cmd) {
      if (typeof cmd.order !== 'number' || !Number.isInteger(cmd.order)) {
        v.add(`${path}/order`, 'type', 'order must be an integer');
      } else {
        command.order = cmd.order;
      }
    }
    if ('hidden' in cmd && v.requireBool(`${path}/hidden`, cmd.hidden)) command.hidden = cmd.hidden;
    out.push(command);
  });
  return out;
}

function validateShortcut(
  v: Validator,
  path: string,
  value: unknown,
): KeybindingDescriptor | KeybindingDescriptor[] | undefined {
  if (Array.isArray(value)) {
    const out: KeybindingDescriptor[] = [];
    value.forEach((kb, i) => {
      const item = validateKeybinding(v, `${path}/${i}`, kb);
      if (item) out.push(item);
    });
    return out;
  }
  return validateKeybinding(v, path, value);
}

function validateKeybinding(
  v: Validator,
  path: string,
  value: unknown,
): KeybindingDescriptor | undefined {
  if (!v.requireRecord(path, value)) return undefined;
  v.noAdditionalProperties(path, value, new Set(['key', 'mac', 'when']));
  if (!('key' in value) || typeof value.key !== 'string') {
    v.add(`${path}/key`, 'required', '`key` is required');
    return undefined;
  }
  const out: KeybindingDescriptor = { key: value.key };
  if ('mac' in value && v.requireString(`${path}/mac`, value.mac)) out.mac = value.mac;
  if ('when' in value && v.requireString(`${path}/when`, value.when)) out.when = value.when;
  return out;
}

function validatePanelTypes(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): ExtensionPanelTypeDef[] | undefined {
  if (!v.requireArray('/contributes/panelTypes', value)) return undefined;
  const out: ExtensionPanelTypeDef[] = [];
  value.forEach((panel, i) => {
    const path = `/contributes/panelTypes/${i}`;
    if (!v.requireRecord(path, panel)) return;
    v.noAdditionalProperties(
      path,
      panel,
      new Set(['id', 'title', 'icon', 'uiEntry', 'defaultBucket', 'writingPane']),
    );
    if (!('id' in panel)) {
      v.add(`${path}/id`, 'required', '`id` is required');
      return;
    }
    const id = normalizeId(v, `${path}/id`, panel.id, ctx);
    if (!id) return;
    if (!('title' in panel)) {
      v.add(`${path}/title`, 'required', '`title` is required');
      return;
    }
    const title = validateLocalizedString(v, `${path}/title`, panel.title);
    if (!title) return;
    if (!('uiEntry' in panel) || typeof panel.uiEntry !== 'string') {
      v.add(`${path}/uiEntry`, 'required', '`uiEntry` is required and must be a string');
      return;
    }
    validatePackagePath(v, `${path}/uiEntry`, panel.uiEntry);
    const def: ExtensionPanelTypeDef = { id, title, uiEntry: panel.uiEntry };
    if ('icon' in panel && v.requireString(`${path}/icon`, panel.icon)) def.icon = panel.icon;
    if ('defaultBucket' in panel) {
      if (v.enum(`${path}/defaultBucket`, panel.defaultBucket, ALLOWED_PANEL_BUCKETS, 'enum')) {
        def.defaultBucket = panel.defaultBucket;
      }
    }
    if ('writingPane' in panel && v.requireBool(`${path}/writingPane`, panel.writingPane)) {
      def.writingPane = panel.writingPane;
    }
    out.push(def);
  });
  return out;
}

function validateMenus(
  v: Validator,
  value: unknown,
): Record<string, ContributedMenuItem[]> | undefined {
  if (!v.requireRecord('/contributes/menus', value)) return undefined;
  const out: Record<string, ContributedMenuItem[]> = {};
  for (const [target, items] of Object.entries(value)) {
    const path = `/contributes/menus/${target}`;
    if (!v.requireArray(path, items)) continue;
    const list: ContributedMenuItem[] = [];
    items.forEach((item, i) => {
      const ip = `${path}/${i}`;
      if (!v.requireRecord(ip, item)) return;
      v.noAdditionalProperties(
        ip,
        item,
        new Set(['id', 'label', 'icon', 'command', 'args', 'when', 'order', 'separatorBefore', 'separatorAfter']),
      );
      if (!('command' in item) || typeof item.command !== 'string') {
        v.add(`${ip}/command`, 'required', '`command` is required and must be a string');
        return;
      }
      if (!('label' in item)) {
        v.add(`${ip}/label`, 'required', '`label` is required');
        return;
      }
      const label = validateLocalizedString(v, `${ip}/label`, item.label);
      if (!label) return;
      const menuItem: ContributedMenuItem = { command: item.command, label };
      if ('id' in item && v.requireString(`${ip}/id`, item.id)) menuItem.id = item.id;
      if ('icon' in item && v.requireString(`${ip}/icon`, item.icon)) menuItem.icon = item.icon;
      if ('args' in item) menuItem.args = item.args;
      if ('when' in item && v.requireString(`${ip}/when`, item.when)) menuItem.when = item.when;
      if ('order' in item) {
        if (typeof item.order !== 'number' || !Number.isInteger(item.order)) {
          v.add(`${ip}/order`, 'type', 'order must be an integer');
        } else {
          menuItem.order = item.order;
        }
      }
      if ('separatorBefore' in item && v.requireBool(`${ip}/separatorBefore`, item.separatorBefore)) {
        menuItem.separatorBefore = item.separatorBefore;
      }
      if ('separatorAfter' in item && v.requireBool(`${ip}/separatorAfter`, item.separatorAfter)) {
        menuItem.separatorAfter = item.separatorAfter;
      }
      list.push(menuItem);
    });
    out[target] = list;
  }
  return out;
}

function validateConfiguration(
  v: Validator,
  value: unknown,
): Record<string, unknown> | { $ref: string } | undefined {
  if (!v.requireRecord('/contributes/configuration', value)) return undefined;
  if ('$ref' in value) {
    if (typeof value.$ref !== 'string') {
      v.add('/contributes/configuration/$ref', 'type', '`$ref` must be a string');
      return undefined;
    }
    if (Object.keys(value).length !== 1) {
      v.add(
        '/contributes/configuration',
        'configuration.ref-only',
        'when `$ref` is set, no other properties are allowed',
      );
      return undefined;
    }
    return { $ref: value.$ref };
  }
  return value;
}

function validateProviderRoles(
  v: Validator,
  value: unknown,
): Record<string, string> | undefined {
  if (!v.requireRecord('/contributes/providers', value)) return undefined;
  const out: Record<string, string> = {};
  for (const [role, key] of Object.entries(value)) {
    if (typeof key !== 'string') {
      v.add(`/contributes/providers/${role}`, 'type', 'provider key must be a string');
      continue;
    }
    out[role] = key;
  }
  return out;
}

function validateDisplayModes(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): DisplayModeDescriptor[] | undefined {
  if (!v.requireArray('/contributes/displayModes', value)) return undefined;
  const out: DisplayModeDescriptor[] = [];
  value.forEach((mode, i) => {
    const path = `/contributes/displayModes/${i}`;
    if (!v.requireRecord(path, mode)) return;
    v.noAdditionalProperties(
      path,
      mode,
      new Set(['id', 'label', 'kind', 'renderEndpoint', 'applicableLanguages']),
    );
    if (!('id' in mode)) {
      v.add(`${path}/id`, 'required', '`id` is required');
      return;
    }
    const id = normalizeId(v, `${path}/id`, mode.id, ctx);
    if (!id) return;
    if (!('label' in mode)) {
      v.add(`${path}/label`, 'required', '`label` is required');
      return;
    }
    const label = validateLocalizedString(v, `${path}/label`, mode.label);
    if (!label) return;
    if (!('kind' in mode) || !v.enum(`${path}/kind`, mode.kind, ALLOWED_DISPLAY_MODE_KINDS, 'enum')) return;
    if (!('renderEndpoint' in mode) || !v.requireString(`${path}/renderEndpoint`, mode.renderEndpoint)) {
      v.add(`${path}/renderEndpoint`, 'required', '`renderEndpoint` is required');
      return;
    }
    const desc: DisplayModeDescriptor = {
      id,
      label,
      kind: mode.kind,
      renderEndpoint: mode.renderEndpoint,
    };
    if ('applicableLanguages' in mode) {
      validateStringArray(v, `${path}/applicableLanguages`, mode.applicableLanguages);
      if (Array.isArray(mode.applicableLanguages)) {
        desc.applicableLanguages = mode.applicableLanguages.filter(
          (l): l is string => typeof l === 'string',
        );
      }
    }
    out.push(desc);
  });
  return out;
}

function validateThemes(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): ContributedTheme[] | undefined {
  if (!v.requireArray('/contributes/themes', value)) return undefined;
  const out: ContributedTheme[] = [];
  value.forEach((theme, i) => {
    const path = `/contributes/themes/${i}`;
    if (!v.requireRecord(path, theme)) return;
    v.noAdditionalProperties(path, theme, new Set(['id', 'label', 'path']));
    if (!('id' in theme)) {
      v.add(`${path}/id`, 'required', '`id` is required');
      return;
    }
    const id = normalizeId(v, `${path}/id`, theme.id, ctx);
    if (!id) return;
    if (!('label' in theme)) {
      v.add(`${path}/label`, 'required', '`label` is required');
      return;
    }
    const label = validateLocalizedString(v, `${path}/label`, theme.label);
    if (!label) return;
    if (!('path' in theme) || !v.requireString(`${path}/path`, theme.path)) return;
    if (!validatePackagePath(v, `${path}/path`, theme.path)) return;
    out.push({ id, label, path: theme.path });
  });
  return out;
}

function validateFonts(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): ContributedFont[] | undefined {
  if (!v.requireArray('/contributes/fonts', value)) return undefined;
  const out: ContributedFont[] = [];
  value.forEach((font, i) => {
    const path = `/contributes/fonts/${i}`;
    if (!v.requireRecord(path, font)) return;
    v.noAdditionalProperties(path, font, new Set(['id', 'family', 'files', 'fallback']));
    if (!('id' in font)) {
      v.add(`${path}/id`, 'required', '`id` is required');
      return;
    }
    const id = normalizeId(v, `${path}/id`, font.id, ctx);
    if (!id) return;
    if (!('family' in font) || !v.requireString(`${path}/family`, font.family)) return;
    if (!('files' in font) || !v.requireArray(`${path}/files`, font.files)) return;
    if (font.files.length === 0) {
      v.add(`${path}/files`, 'minItems', '`files` must contain at least one entry');
      return;
    }
    let allOk = true;
    font.files.forEach((f, j) => {
      const fp = `${path}/files/${j}`;
      if (!v.requireString(fp, f)) {
        allOk = false;
        return;
      }
      if (!validatePackagePath(v, fp, f)) allOk = false;
    });
    if (!allOk) return;
    const fontDef: ContributedFont = { id, family: font.family, files: font.files as string[] };
    if ('fallback' in font && v.requireString(`${path}/fallback`, font.fallback)) {
      fontDef.fallback = font.fallback;
    }
    out.push(fontDef);
  });
  return out;
}

function validateIcons(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): ContributedIcon[] | undefined {
  if (!v.requireArray('/contributes/icons', value)) return undefined;
  const out: ContributedIcon[] = [];
  value.forEach((icon, i) => {
    const path = `/contributes/icons/${i}`;
    if (!v.requireRecord(path, icon)) return;
    v.noAdditionalProperties(path, icon, new Set(['id', 'path']));
    if (!('id' in icon)) {
      v.add(`${path}/id`, 'required', '`id` is required');
      return;
    }
    const id = normalizeId(v, `${path}/id`, icon.id, ctx);
    if (!id) return;
    if (!('path' in icon) || !v.requireString(`${path}/path`, icon.path)) return;
    if (!validatePackagePath(v, `${path}/path`, icon.path)) return;
    out.push({ id, path: icon.path });
  });
  return out;
}

function validateStyles(v: Validator, value: unknown): ContributedStyle[] | undefined {
  if (!v.requireArray('/contributes/styles', value)) return undefined;
  const out: ContributedStyle[] = [];
  value.forEach((style, i) => {
    const path = `/contributes/styles/${i}`;
    if (!v.requireRecord(path, style)) return;
    v.noAdditionalProperties(path, style, new Set(['path', 'scope']));
    if (!('path' in style) || !v.requireString(`${path}/path`, style.path)) return;
    if (!validatePackagePath(v, `${path}/path`, style.path)) return;
    if (!('scope' in style) || !v.enum(`${path}/scope`, style.scope, ALLOWED_STYLE_SCOPES, 'enum')) return;
    out.push({ path: style.path, scope: style.scope });
  });
  return out;
}

function validateFileImporters(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): ContributedFileImporter[] | undefined {
  if (!v.requireArray('/contributes/fileImporters', value)) return undefined;
  const out: ContributedFileImporter[] = [];
  value.forEach((imp, i) => {
    const path = `/contributes/fileImporters/${i}`;
    if (!v.requireRecord(path, imp)) return;
    v.noAdditionalProperties(
      path,
      imp,
      new Set(['id', 'label', 'extensions', 'handlerEndpoint']),
    );
    if (!('id' in imp)) {
      v.add(`${path}/id`, 'required', '`id` is required');
      return;
    }
    const id = normalizeId(v, `${path}/id`, imp.id, ctx);
    if (!id) return;
    if (!('label' in imp)) {
      v.add(`${path}/label`, 'required', '`label` is required');
      return;
    }
    const label = validateLocalizedString(v, `${path}/label`, imp.label);
    if (!label) return;
    if (!('extensions' in imp) || !v.requireArray(`${path}/extensions`, imp.extensions)) return;
    if (imp.extensions.length === 0) {
      v.add(`${path}/extensions`, 'minItems', '`extensions` must be non-empty');
      return;
    }
    let allOk = true;
    imp.extensions.forEach((ext, j) => {
      const ep = `${path}/extensions/${j}`;
      if (typeof ext !== 'string' || !ext.startsWith('.')) {
        v.add(ep, 'pattern', 'extension must be a string starting with `.`');
        allOk = false;
      }
    });
    if (!allOk) return;
    if (!('handlerEndpoint' in imp) || !v.requireString(`${path}/handlerEndpoint`, imp.handlerEndpoint)) {
      v.add(`${path}/handlerEndpoint`, 'required', '`handlerEndpoint` is required');
      return;
    }
    out.push({
      id,
      label,
      extensions: imp.extensions as string[],
      handlerEndpoint: imp.handlerEndpoint,
    });
  });
  return out;
}

function validateApiExports(
  v: Validator,
  value: unknown,
): ContributedApiExport[] | undefined {
  if (!v.requireArray('/contributes/apiExports', value)) return undefined;
  const out: ContributedApiExport[] = [];
  value.forEach((exp, i) => {
    const path = `/contributes/apiExports/${i}`;
    if (!v.requireRecord(path, exp)) return;
    v.noAdditionalProperties(path, exp, new Set(['method', 'description', 'handlerEndpoint']));
    if (!('method' in exp) || !v.requireString(`${path}/method`, exp.method)) {
      v.add(`${path}/method`, 'required', '`method` is required');
      return;
    }
    if (!v.pattern(`${path}/method`, exp.method, IDENTIFIER_PATTERN, 'pattern',
      '`method` must be a valid identifier ([A-Za-z_$][A-Za-z0-9_$]*)')) return;
    if (!('handlerEndpoint' in exp) || !v.requireString(`${path}/handlerEndpoint`, exp.handlerEndpoint)) {
      v.add(`${path}/handlerEndpoint`, 'required', '`handlerEndpoint` is required');
      return;
    }
    const def: ContributedApiExport = {
      method: exp.method,
      handlerEndpoint: exp.handlerEndpoint,
    };
    if ('description' in exp) {
      const desc = validateLocalizedString(v, `${path}/description`, exp.description);
      if (desc) def.description = desc;
    }
    out.push(def);
  });
  return out;
}

function validateProviderDescriptors<T>(
  v: Validator,
  basePath: string,
  value: unknown,
  ctx: ContributionContext,
  capabilityEnum: readonly string[],
  knownEndpointKeys: ReadonlySet<string>,
): T[] | undefined {
  if (!v.requireArray(basePath, value)) return undefined;
  const out: T[] = [];
  value.forEach((descriptor, i) => {
    const path = `${basePath}/${i}`;
    if (!v.requireRecord(path, descriptor)) return;
    const allowed = new Set([
      'id',
      'name',
      'abbreviation',
      'language',
      'capabilities',
      ...knownEndpointKeys,
    ]);
    v.noAdditionalProperties(path, descriptor, allowed);
    if (!('id' in descriptor)) {
      v.add(`${path}/id`, 'required', '`id` is required');
      return;
    }
    const id = normalizeId(v, `${path}/id`, descriptor.id, ctx);
    if (!id) return;
    if (!('name' in descriptor)) {
      v.add(`${path}/name`, 'required', '`name` is required');
      return;
    }
    const name = validateLocalizedString(v, `${path}/name`, descriptor.name);
    if (!name) return;
    if (!('abbreviation' in descriptor) ||
        !v.requireString(`${path}/abbreviation`, descriptor.abbreviation)) {
      v.add(`${path}/abbreviation`, 'required', '`abbreviation` is required');
      return;
    }
    if (!('capabilities' in descriptor) || !v.requireArray(`${path}/capabilities`, descriptor.capabilities)) {
      v.add(`${path}/capabilities`, 'required', '`capabilities` is required');
      return;
    }
    let capsOk = true;
    descriptor.capabilities.forEach((cap, j) => {
      const cp = `${path}/capabilities/${j}`;
      if (!v.enum(cp, cap, capabilityEnum, 'enum')) capsOk = false;
    });
    if (!capsOk) return;
    if (!('fetchEndpoint' in descriptor) ||
        !v.requireString(`${path}/fetchEndpoint`, descriptor.fetchEndpoint)) {
      v.add(`${path}/fetchEndpoint`, 'required', '`fetchEndpoint` is required');
      return;
    }
    const built: Record<string, unknown> = {
      id,
      name,
      abbreviation: descriptor.abbreviation,
      capabilities: descriptor.capabilities,
      fetchEndpoint: descriptor.fetchEndpoint,
    };
    if ('language' in descriptor && v.requireString(`${path}/language`, descriptor.language)) {
      built.language = descriptor.language;
    }
    for (const ek of knownEndpointKeys) {
      if (ek === 'fetchEndpoint') continue;
      if (ek in descriptor) {
        if (v.requireString(`${path}/${ek}`, (descriptor as Record<string, unknown>)[ek])) {
          built[ek] = (descriptor as Record<string, unknown>)[ek];
        }
      }
    }
    out.push(built as T);
  });
  return out;
}

function validateCommentaryProviders(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): CommentaryProviderDescriptor[] | undefined {
  return validateProviderDescriptors<CommentaryProviderDescriptor>(
    v,
    '/contributes/commentaryProviders',
    value,
    ctx,
    ALLOWED_COMMENTARY_CAPABILITIES,
    new Set(['fetchEndpoint', 'rangeEndpoint', 'iterateEndpoint', 'similarityEndpoint']),
  );
}

function validateDictionaryProviders(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): DictionaryProviderDescriptor[] | undefined {
  return validateProviderDescriptors<DictionaryProviderDescriptor>(
    v,
    '/contributes/dictionaryProviders',
    value,
    ctx,
    ALLOWED_DICTIONARY_CAPABILITIES,
    new Set(['fetchEndpoint', 'searchEndpoint', 'iterateEndpoint', 'morphologyEndpoint']),
  );
}

function validateBookProviders(
  v: Validator,
  value: unknown,
  ctx: ContributionContext,
): BookProviderDescriptor[] | undefined {
  return validateProviderDescriptors<BookProviderDescriptor>(
    v,
    '/contributes/bookProviders',
    value,
    ctx,
    ALLOWED_BOOK_CAPABILITIES,
    new Set(['fetchEndpoint', 'listEndpoint', 'iterateEndpoint']),
  );
}

// --- Top-level entry point -------------------------------------------------

/**
 * Validate an unknown JSON value (typically the parsed `extension.json`)
 * against the manifest schema and the cross-cutting rules from
 * section "Manifest validation rules".
 *
 * On success, returns a typed manifest with all contribution IDs auto-prefixed
 * to `ext.<id>.`. On failure, returns the full list of errors so the caller
 * can render them in one go rather than fixing them one by one.
 */
export function validateManifest(json: unknown): ManifestValidationResult {
  const v = new Validator();

  if (!v.requireRecord('', json)) {
    return { ok: false, errors: v.errors };
  }

  v.noAdditionalProperties('', json, ALLOWED_TOP_LEVEL_KEYS);

  const { id } = validateIdentity(v, json);
  validateEngines(v, json);

  let permissions: ExtensionPermission[] | undefined;
  if ('permissions' in json) {
    permissions = validatePermissions(v, json.permissions);
  }

  let network: ExtensionNetworkConfig | undefined;
  if ('network' in json) {
    network = validateNetwork(v, json.network);
  }

  let privacy: ExtensionPrivacyConfig | undefined;
  if ('privacy' in json) {
    privacy = validatePrivacy(v, json.privacy);
  }

  let webviews: ExtensionWebviewsConfig | undefined;
  if ('webviews' in json) {
    webviews = validateWebviews(v, json.webviews, network?.allowedHosts);
  }

  let activationEvents: string[] | undefined;
  if ('activationEvents' in json) {
    activationEvents = validateActivationEvents(v, json.activationEvents);
  }

  let main: string | undefined;
  if ('main' in json) {
    if (v.requireString('/main', json.main)) {
      validatePackagePath(v, '/main', json.main);
      main = json.main;
    }
  }

  let runtime: ExtensionRuntimeConfig | undefined;
  if ('runtime' in json) {
    runtime = validateRuntime(v, json.runtime);
  }

  let l10n: string | undefined;
  if ('l10n' in json) {
    if (v.requireString('/l10n', json.l10n)) {
      l10n = json.l10n;
    }
  }

  let contributes: ExtensionContributes | undefined;
  if ('contributes' in json) {
    contributes = validateContributes(v, json.contributes, { extId: id });
  }

  // -- Cross-cutting rules ------------------------------------------------
  if (permissions) {
    if (permissions.includes('network')) {
      if (!network || network.allowedHosts.length === 0) {
        v.add(
          '/network/allowedHosts',
          'permissions.network-requires-hosts',
          'permission `network` requires `network.allowedHosts` to be non-empty',
        );
      }
    }
    if (permissions.includes('network:oauth') && !network) {
      v.add(
        '/network',
        'permissions.oauth-requires-network',
        'permission `network:oauth` requires the `network` block to be present',
      );
    }
  }

  if (v.errors.length > 0) {
    return { ok: false, errors: v.errors };
  }

  // We've validated everything; assemble the typed result. The casts here are
  // safe because each branch above only sets the field after validation
  // succeeds (and we've returned early if any error was reported).
  const manifest: ExtensionManifest = {
    id: id as string,
    name: (json as { name: LocalizedString }).name,
    version: (json as { version: string }).version,
    publisher: (json as { publisher: string }).publisher,
    engines: (json as { engines: { bibleApp: string } }).engines,
  };

  // Optional identity / marketplace fields - copy through verbatim once
  // validated. We do not re-validate; we already accepted them above.
  const passthrough = [
    '$schema',
    'displayName',
    'description',
    'categories',
    'keywords',
    'homepage',
    'repository',
    'bugs',
    'license',
    'pricing',
    'icon',
    'preview',
  ] as const;
  for (const key of passthrough) {
    if (key in json) {
      (manifest as unknown as Record<string, unknown>)[key] = (json as Record<string, unknown>)[key];
    }
  }

  if (main !== undefined) manifest.main = main;
  if (permissions !== undefined) manifest.permissions = permissions;
  if (network !== undefined) manifest.network = network;
  if (privacy !== undefined) manifest.privacy = privacy;
  if (webviews !== undefined) manifest.webviews = webviews;
  if (activationEvents !== undefined) manifest.activationEvents = activationEvents;
  if (contributes !== undefined) manifest.contributes = contributes;
  if (runtime !== undefined) manifest.runtime = runtime;
  if (l10n !== undefined) manifest.l10n = l10n;

  return { ok: true, manifest };
}
