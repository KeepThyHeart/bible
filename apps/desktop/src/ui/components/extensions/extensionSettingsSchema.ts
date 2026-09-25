/**
 * Pure helpers for `ExtensionSettingsRenderer.tsx`.
 *
 * Keeping the schema -> flat-field walk in a standalone module lets the
 * renderer stay a thin React shell over plain data, and lets us unit-test the
 * logic without mounting React.
 *
 * Supported JSON Schema subset:
 *   - `type: object` with `properties` (root and nested via `x-bibleAppGroup`)
 *   - `type: string` (text input, password, secret, uri, email, textarea, enum)
 *   - `type: number` / `integer` (with min/max)
 *   - `type: boolean`
 *   - `type: array` with `items.type: string` (tag list)
 *   - Vendor extensions: `x-bibleAppRequired`, `x-bibleAppGroup`,
 *     `x-bibleAppHelpUrl`, `x-bibleAppDependsOn`
 *
 * Not supported yet:
 *   - `x-bibleAppCustomPanel` (needs a panel registry hook)
 *   - `x-bibleAppValidateEndpoint` (needs reverse-RPC plumbing into the
 *     extension worker)
 *   - `markdownDescription` markdown rendering (the renderer accepts the
 *     string as-is and shows it inline; markdown comes later)
 */

/**
 * The shape of one settings field after we've flattened the JSON Schema.
 * Each leaf is one row in the form. Nested objects become a "group" with
 * children - the renderer handles indentation.
 */
export interface SettingsField {
  /** Dot-separated path from the root, e.g. `advanced.endpoint`. */
  key: string;
  /** Direct property name within the parent object. */
  propertyName: string;
  /** JSON Schema `type` of the leaf (or `'group'` for nested objects). */
  kind:
    | 'string'
    | 'password'
    | 'secret'
    | 'enum'
    | 'uri'
    | 'email'
    | 'textarea'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'string-array'
    | 'group';
  /** Optional UI label (resolves through L10n at render time). */
  title?: string;
  /** Optional help text. */
  description?: string;
  /** Optional default value (only for leaves). */
  defaultValue?: unknown;
  /** True if `x-bibleAppRequired` is set. */
  required: boolean;
  /** Optional `x-bibleAppHelpUrl` external link. */
  helpUrl?: string;
  /** Optional `x-bibleAppDependsOn` mapping that must match for visibility. */
  dependsOn?: Record<string, unknown>;
  /** For `enum`, the list of allowed values. */
  enumValues?: string[];
  /** For numbers: bounds and step from the schema. */
  numberConstraints?: { minimum?: number; maximum?: number; multipleOf?: number };
  /** Children of a `group` field. */
  children?: SettingsField[];
}

interface RawSchema {
  type?: string;
  format?: string;
  enum?: unknown[];
  properties?: Record<string, RawSchema>;
  items?: RawSchema;
  title?: unknown;
  description?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  ['x-bibleAppRequired']?: boolean;
  ['x-bibleAppHelpUrl']?: string;
  ['x-bibleAppDependsOn']?: Record<string, unknown>;
  ['x-bibleAppGroup']?: unknown;
}

/**
 * Walk the schema and produce a flat list of `SettingsField` rows the
 * renderer can map over. Nested objects become `group` rows with children.
 */
export function extractFields(schema: unknown): SettingsField[] {
  if (!isPlainObject(schema)) return [];
  const root = schema as RawSchema;
  if (root.type !== 'object' || !isPlainObject(root.properties)) return [];
  return walkProperties(root.properties as Record<string, RawSchema>, '');
}

function walkProperties(
  properties: Record<string, RawSchema>,
  prefix: string,
): SettingsField[] {
  const fields: SettingsField[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (!isPlainObject(raw)) continue;
    const key = prefix ? `${prefix}.${name}` : name;
    const field = buildField(name, key, raw);
    if (field) fields.push(field);
  }
  return fields;
}

function buildField(propertyName: string, key: string, raw: RawSchema): SettingsField | null {
  const kind = inferKind(raw);
  if (!kind) return null;

  const base: SettingsField = {
    key,
    propertyName,
    kind,
    required: raw['x-bibleAppRequired'] === true,
    title: stringFrom(raw.title),
    description: stringFrom(raw.description),
  };
  if (typeof raw['x-bibleAppHelpUrl'] === 'string') base.helpUrl = raw['x-bibleAppHelpUrl'];
  if (isPlainObject(raw['x-bibleAppDependsOn'])) {
    base.dependsOn = raw['x-bibleAppDependsOn'] as Record<string, unknown>;
  }

  if (kind === 'group') {
    base.children = walkProperties(
      (raw.properties ?? {}) as Record<string, RawSchema>,
      key,
    );
    return base;
  }
  if (kind === 'enum') {
    base.enumValues = (raw.enum ?? []).filter((v): v is string => typeof v === 'string');
  }
  if (kind === 'number' || kind === 'integer') {
    const c: SettingsField['numberConstraints'] = {};
    if (typeof raw.minimum === 'number') c.minimum = raw.minimum;
    if (typeof raw.maximum === 'number') c.maximum = raw.maximum;
    if (typeof raw.multipleOf === 'number') c.multipleOf = raw.multipleOf;
    base.numberConstraints = c;
  }
  if (raw.default !== undefined) base.defaultValue = raw.default;
  return base;
}

function inferKind(raw: RawSchema): SettingsField['kind'] | null {
  if (raw.type === 'object') return 'group';
  if (raw.type === 'string') {
    if (Array.isArray(raw.enum)) return 'enum';
    switch (raw.format) {
      case 'password':
        return 'password';
      case 'secret':
        return 'secret';
      case 'uri':
        return 'uri';
      case 'email':
        return 'email';
      case 'textarea':
        return 'textarea';
      default:
        return 'string';
    }
  }
  if (raw.type === 'number') return 'number';
  if (raw.type === 'integer') return 'integer';
  if (raw.type === 'boolean') return 'boolean';
  if (raw.type === 'array' && isPlainObject(raw.items) && (raw.items as RawSchema).type === 'string') {
    return 'string-array';
  }
  return null;
}

/**
 * Compute the union of `applyDefaults` for every field whose current value
 * is `undefined`. Used by the renderer when first opening the form so the
 * user sees the defaults pre-filled.
 */
export function applyDefaults(
  fields: SettingsField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...values };
  walkFields(fields, (field) => {
    if (field.kind === 'group') return;
    if (out[field.key] === undefined && field.defaultValue !== undefined) {
      out[field.key] = field.defaultValue;
    }
  });
  return out;
}

/**
 * Return the `key`s of every required (`x-bibleAppRequired`) field whose
 * current value is missing or empty. Used to gate extension activation on
 * required settings being filled in.
 */
export function getMissingRequired(
  fields: SettingsField[],
  values: Record<string, unknown>,
): string[] {
  const missing: string[] = [];
  walkFields(fields, (field) => {
    if (field.kind === 'group') return;
    if (!field.required) return;
    if (!isFieldVisible(field, values)) return;
    const v = values[field.key];
    if (v === undefined || v === null || v === '') missing.push(field.key);
  });
  return missing;
}

/**
 * Return true unless the field has an `x-bibleAppDependsOn` whose values
 * do not match the current form state. Hidden fields are skipped during
 * required-check and rendering alike.
 */
export function isFieldVisible(field: SettingsField, values: Record<string, unknown>): boolean {
  if (!field.dependsOn) return true;
  for (const [key, expected] of Object.entries(field.dependsOn)) {
    // dependsOn keys are interpreted relative to the field's parent group:
    // an entry like `{ lookupLanguage: 'greek' }` on `advanced.showMorphology`
    // means "show me only when the sibling `advanced.lookupLanguage` is
    // 'greek'". We resolve siblings first, then fall back to the root.
    const parent = field.key.includes('.')
      ? field.key.slice(0, field.key.lastIndexOf('.'))
      : '';
    const siblingKey = parent ? `${parent}.${key}` : key;
    const actual = values[siblingKey] ?? values[key];
    if (actual !== expected) return false;
  }
  return true;
}

function walkFields(fields: SettingsField[], visit: (f: SettingsField) => void): void {
  for (const field of fields) {
    visit(field);
    if (field.children) walkFields(field.children, visit);
  }
}

/**
 * Find the flattened leaf field for `key` (a dot-separated path, exactly as
 * `extractFields` produces it), or `null` if no field declares it.
 *
 * Used by `storage.setSetting` (host-side, `storageApiImpl.ts`) to check an
 * extension-initiated write against the extension's own declared schema -
 * the same flattening this file already does for the form, so the API and
 * the form can never disagree about which keys exist.
 */
export function findField(fields: SettingsField[], key: string): SettingsField | null {
  for (const field of fields) {
    if (field.kind === 'group') {
      const found = findField(field.children ?? [], key);
      if (found) return found;
      continue;
    }
    if (field.key === key) return field;
  }
  return null;
}

/**
 * Type-check `value` against `field`'s declared JSON Schema kind (and, for
 * numbers, its declared min/max). Used by `storage.setSetting` so an
 * extension-initiated write is held to the same rule the settings form's
 * inputs already enforce structurally (a `<select>` can't submit a value
 * outside `enumValues`, a checkbox can't submit a string, etc.) - this is
 * that same rule, applied to a value that arrived over RPC instead of a DOM
 * event.
 */
export function validateSettingValue(
  field: SettingsField,
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  switch (field.kind) {
    case 'string':
    case 'password':
    case 'secret':
    case 'uri':
    case 'email':
    case 'textarea':
      if (typeof value !== 'string') {
        return { ok: false, error: `'${field.key}' must be a string` };
      }
      return { ok: true };
    case 'enum':
      if (typeof value !== 'string' || !(field.enumValues ?? []).includes(value)) {
        return {
          ok: false,
          error: `'${field.key}' must be one of: ${(field.enumValues ?? []).join(', ')}`,
        };
      }
      return { ok: true };
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return { ok: false, error: `'${field.key}' must be a number` };
      }
      return checkNumberRange(field, value);
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { ok: false, error: `'${field.key}' must be an integer` };
      }
      return checkNumberRange(field, value);
    case 'boolean':
      if (typeof value !== 'boolean') {
        return { ok: false, error: `'${field.key}' must be a boolean` };
      }
      return { ok: true };
    case 'string-array':
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
        return { ok: false, error: `'${field.key}' must be an array of strings` };
      }
      return { ok: true };
    case 'group':
      return { ok: false, error: `'${field.key}' is a settings group, not a leaf value` };
    default:
      return { ok: false, error: `'${field.key}' has an unsupported settings type` };
  }
}

function checkNumberRange(
  field: SettingsField,
  value: number,
): { ok: true } | { ok: false; error: string } {
  const c = field.numberConstraints;
  if (!c) return { ok: true };
  if (c.minimum !== undefined && value < c.minimum) {
    return { ok: false, error: `'${field.key}' must be >= ${c.minimum}` };
  }
  if (c.maximum !== undefined && value > c.maximum) {
    return { ok: false, error: `'${field.key}' must be <= ${c.maximum}` };
  }
  return { ok: true };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  // `LocalizedString` form: `{ key: 'foo' }` - pass the key through unchanged
  // for now. The renderer wraps this in the L10n bridge once one is wired.
  if (isPlainObject(value) && typeof (value as Record<string, unknown>).key === 'string') {
    return (value as Record<string, unknown>).key as string;
  }
  return undefined;
}
