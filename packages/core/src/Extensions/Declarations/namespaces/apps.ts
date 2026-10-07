/**
 * `api.apps` - apps an extension adds to the host's app switcher (task 0080, M3).
 *
 * The manifest declares them (`contributes.apps`); the API sets a status badge,
 * asks the host to show one, and reports when one is shown or hidden.
 */

import type { ContributedApp } from '../../ExtensionManifest';
import type { IAppsApi } from '../../ExtensionApiTypes';
import {
  defineApiNamespace,
  eventChannel,
  FAKE_DISPOSABLE,
  fakeReturns,
  type ContributesValidationContext,
} from '../defineApiNamespace';
import type { AppVisibilityEvent } from '../../ExtensionApiDtos';

const MAX_APPS = 8;
const SHORT_ID = /^[a-z][a-z0-9-]{0,39}$/;
const KEY_REF = /^%[^%\s]+%$/;
const ALLOWED_KEYS = new Set(['id', 'title', 'shortTitle', 'icon', 'uiEntry', 'order', 'keepAlive', 'mobile']);

/** A relative package path: no leading `/`, no `\`, no `..` segment, no scheme, one of `exts`. */
function checkRelativePath(
  value: unknown,
  path: string,
  exts: readonly string[],
  ctx: ContributesValidationContext,
  code: string,
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    ctx.error(path, code, 'expected a non-empty relative path');
    return undefined;
  }
  if (value.startsWith('/') || value.includes('\\') || value.includes(':') || value.split('/').includes('..')) {
    ctx.error(path, code, 'must be a relative path inside the package (no leading "/", "\\", "..", or scheme)');
    return undefined;
  }
  const lower = value.toLowerCase();
  if (!exts.some((e) => lower.endsWith(e))) {
    ctx.error(path, code, `must end with ${exts.join(', ')}`);
    return undefined;
  }
  return value;
}

/** A non-empty literal (<= max chars) or a `%key%` reference, or `{ key }`. */
function checkTitle(
  value: unknown,
  path: string,
  max: number,
  ctx: ContributesValidationContext,
): ContributedApp['title'] | undefined {
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      ctx.error(path, 'apps.title', 'must not be empty');
      return undefined;
    }
    if (!KEY_REF.test(value) && [...value].length > max) {
      ctx.error(path, 'apps.title', `must be at most ${max} characters`);
      return undefined;
    }
    return value;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const k = (value as { key?: unknown }).key;
    if (typeof k === 'string' && k.length > 0) return { key: k };
  }
  ctx.error(path, 'apps.title', 'expected a non-empty string or { key }');
  return undefined;
}

export const appsNamespace = defineApiNamespace<IAppsApi>()({
  name: 'apps',
  description: "Add the extension's own app to the host's app switcher, with a status badge.",
  since: '0.2.1',
  optional: true,
  availability: { whenGranted: 'ui:contribute-app' },
  permissions: [
    {
      id: 'ui:contribute-app',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.uiContributeApp',
        text: 'Add its own app to the app switcher, with a status badge.',
      },
      since: '0.2.1',
    },
  ],
  methods: {
    setBadge: { permission: 'ui:contribute-app' },
    open: { permission: 'ui:contribute-app', fake: fakeReturns(true) },
    // Worker-side sugar over the `app.visibilityChanged` channel.
    onVisibilityChanged: { permission: 'ui:contribute-app', local: true, fake: FAKE_DISPOSABLE },
  },
  activationEvents: [
    {
      event: 'onApp:',
      fired: true,
      description:
        "Activate when the user opens one of this extension's apps (onApp:<app id as declared>). Matched against the owning extension only.",
      since: '0.2.1',
    },
  ],
  contributes: [
    {
      key: 'apps',
      description: "Apps shown in the host's app switcher (at most 8 per extension).",
      since: '0.2.1',
      requiresPermission: 'ui:contribute-app',
      validate: (value, path, ctx) => {
        if (!Array.isArray(value)) {
          ctx.error(path, 'type', 'expected an array of apps');
          return undefined;
        }
        if (value.length > MAX_APPS) {
          ctx.error(path, 'apps.count', `at most ${MAX_APPS} apps per extension`);
          return undefined;
        }
        const out: ContributedApp[] = [];
        const seen = new Set<string>();
        let ok = true;
        value.forEach((raw, i) => {
          const p = `${path}/${i}`;
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
            ctx.error(p, 'type', 'expected an object');
            ok = false;
            return;
          }
          const r = raw as Record<string, unknown>;
          for (const k of Object.keys(r)) {
            if (!ALLOWED_KEYS.has(k)) ctx.warn(`${p}/${k}`, 'apps.unknownKey', `unknown key "${k}" ignored`);
          }

          let id: string | undefined;
          const rawId = r['id'];
          if (typeof rawId !== 'string' || (!rawId.startsWith('ext.') && !SHORT_ID.test(rawId))) {
            ctx.error(`${p}/id`, 'apps.id', 'required; lowercase letters, digits and "-", starting with a letter, at most 40 characters');
          } else {
            id = ctx.qualifyId(`${p}/id`, rawId);
          }
          if (id !== undefined) {
            if (seen.has(id)) {
              ctx.error(`${p}/id`, 'apps.duplicateId', `duplicate app id "${rawId as string}"`);
              id = undefined;
            } else seen.add(id);
          }

          const title = checkTitle(r['title'], `${p}/title`, 60, ctx);
          let shortTitle: ContributedApp['shortTitle'];
          if (r['shortTitle'] !== undefined) {
            shortTitle = checkTitle(r['shortTitle'], `${p}/shortTitle`, 24, ctx);
            if (shortTitle === undefined) ok = false;
          }
          let icon: string | undefined;
          if (r['icon'] !== undefined) {
            icon = checkRelativePath(r['icon'], `${p}/icon`, ['.svg', '.png', '.webp'], ctx, 'apps.icon');
            if (icon === undefined) ok = false;
          }
          const uiEntry = checkRelativePath(r['uiEntry'], `${p}/uiEntry`, ['.html'], ctx, 'apps.uiEntry');
          let order: number | undefined;
          if (r['order'] !== undefined) {
            const o = r['order'];
            if (typeof o !== 'number' || !Number.isInteger(o) || o < 0 || o > 900) {
              ctx.error(`${p}/order`, 'apps.order', 'expected an integer from 0 to 900');
              ok = false;
            } else order = o;
          }
          let keepAlive: 'never' | undefined;
          if (r['keepAlive'] !== undefined) {
            if (r['keepAlive'] === 'never') keepAlive = 'never';
            else {
              ctx.error(`${p}/keepAlive`, 'apps.keepAlive', "extension apps may only use 'never' in this version");
              ok = false;
            }
          }
          let mobile: 'sheet' | 'hidden' | undefined;
          if (r['mobile'] !== undefined) {
            if (r['mobile'] === 'sheet' || r['mobile'] === 'hidden') mobile = r['mobile'];
            else {
              ctx.error(`${p}/mobile`, 'apps.mobile', "expected 'sheet' or 'hidden'");
              ok = false;
            }
          }

          if (id === undefined || title === undefined || uiEntry === undefined) {
            ok = false;
            return;
          }
          const app: ContributedApp = { id, title, uiEntry };
          if (shortTitle !== undefined) app.shortTitle = shortTitle;
          if (icon !== undefined) app.icon = icon;
          if (order !== undefined) app.order = order;
          if (keepAlive !== undefined) app.keepAlive = keepAlive;
          if (mobile !== undefined) app.mobile = mobile;
          out.push(app);
        });
        return ok ? out : undefined;
      },
      jsonSchema: {
        type: 'array',
        maxItems: MAX_APPS,
        items: {
          type: 'object',
          required: ['id', 'title', 'uiEntry'],
          properties: {
            id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' },
            title: {
              oneOf: [
                { type: 'string', minLength: 1 },
                { type: 'object', required: ['key'], properties: { key: { type: 'string', minLength: 1 } } },
              ],
            },
            shortTitle: {
              oneOf: [
                { type: 'string', minLength: 1 },
                { type: 'object', required: ['key'], properties: { key: { type: 'string', minLength: 1 } } },
              ],
            },
            icon: { type: 'string', pattern: '^[^/\\\\:][^\\\\:]*\\.(svg|png|webp)$' },
            uiEntry: { type: 'string', pattern: '^[^/\\\\:][^\\\\:]*\\.html$' },
            order: { type: 'integer', minimum: 0, maximum: 900 },
            keepAlive: { type: 'string', enum: ['never'] },
            mobile: { type: 'string', enum: ['sheet', 'hidden'] },
          },
        },
      },
    },
  ],
  events: {
    'app.visibilityChanged': eventChannel<AppVisibilityEvent>({
      kind: 'event',
      permission: 'ui:contribute-app',
      description: "One of this extension's apps was shown or hidden.",
      since: '0.2.1',
    }),
  },
});
