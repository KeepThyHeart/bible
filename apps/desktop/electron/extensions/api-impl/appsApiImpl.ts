/**
 * Host-side implementation of `IAppsApi` for one extension worker.
 *
 * Every method needs `ui:contribute-app`. The api-impl is a thin gate between
 * the RPC wire and the UI bridge:
 *
 *   - `setBadge(appId, badge | null)` works on this extension's own declared
 *     apps only (`appId` as declared, or qualified). The badge is validated
 *     here (kind, tone, label 1..80 chars, text 1..4 chars, finite count) and
 *     forwarded; the renderer's `AppRegistry.setBadge` normalises it again.
 *   - `open(appId)` resolves true when the host asked the renderer to show the
 *     app, false when it declined: there was no user gesture in this
 *     extension's own UI in the last 5 s (`UserGestureTracker`), or the host
 *     has no app surface. A refusal is logged once to the extension's own
 *     lifecycle log. An id that is not one of its apps rejects.
 *   - `onVisibilityChanged` is worker-side sugar over the
 *     `app.visibilityChanged` channel (see `apiProxy.ts`).
 *   - `dispose()` clears the badges of the extension's apps, so a dead worker
 *     never leaves a stale badge behind.
 */

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionUiBridge } from './IExtensionDataBridges';
import { USER_GESTURE_WINDOW_MS, type UserGestureTracker } from '../UserGestureTracker';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

const PERM = 'ui:contribute-app' as Extensions.ExtensionPermission;
const MAX_LABEL_CHARS = 80;
const MAX_TEXT_CHARS = 4;
const KINDS = ['dot', 'count', 'text'] as const;
const TONES = ['neutral', 'live', 'attention'] as const;
/** Control characters and bidi overrides have no business in a badge or its label. */
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

export interface AppsApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  /** Needs `setAppBadge` and `requestOpenApp`; without them `setBadge` is a no-op and `open` resolves false. */
  bridge: IExtensionUiBridge;
  grant: ExtensionPermissionGrant;
  /** This extension's declared apps (ids stored qualified: `<extensionId>.<shortId>`). */
  apps: readonly Extensions.ContributedApp[];
  gestures: UserGestureTracker;
  /** Appends one line to this extension's own lifecycle log. */
  log: (level: 'info' | 'warn', message: string) => void;
  /** Gesture window, overridable for tests. */
  gestureWindowMs?: number;
}

export class AppsApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly bridge: IExtensionUiBridge;
  private readonly grant: ExtensionPermissionGrant;
  private readonly gestures: UserGestureTracker;
  private readonly log: AppsApiImplOptions['log'];
  private readonly windowMs: number;
  /** shortId -> qualified id. */
  private readonly shortToQualified = new Map<string, string>();
  private readonly badged = new Set<string>();
  private disposed = false;

  constructor(opts: AppsApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.bridge = opts.bridge;
    this.grant = opts.grant;
    this.gestures = opts.gestures;
    this.log = opts.log;
    this.windowMs = opts.gestureWindowMs ?? USER_GESTURE_WINDOW_MS;
    const prefix = `${opts.extensionId}.`;
    for (const app of opts.apps) {
      const shortId = app.id.startsWith(prefix) ? app.id.slice(prefix.length) : app.id;
      this.shortToQualified.set(shortId, `${prefix}${shortId}`);
    }
  }

  attach(): void {
    this.router.registerNamespace('apps', {
      setBadge: (args) => this.handleSetBadge(args),
      open: (args) => this.handleOpen(args),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const qualified of this.badged) {
      try {
        this.bridge.setAppBadge?.(this.extensionId, qualified, null);
      } catch {
        /* best-effort: the worker is already gone */
      }
    }
    this.badged.clear();
  }

  private guard(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`appsApiImpl for ${this.extensionId} is disposed`);
    }
    requirePermission(this.grant, PERM);
  }

  /** Accepts the id as declared or qualified; rejects anything that is not one of this extension's apps. */
  private resolve(method: string, raw: unknown): { shortId: string; qualified: string } {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new RpcProtocolError(`apps.${method}: appId must be a non-empty string`);
    }
    const prefix = `${this.extensionId}.`;
    const shortId = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    const qualified = this.shortToQualified.get(shortId);
    if (!qualified) {
      throw new RpcProtocolError(`apps.${method}: '${raw}' is not one of this extension's apps`);
    }
    return { shortId, qualified };
  }

  private async handleSetBadge(args: unknown[]): Promise<void> {
    this.guard();
    const { qualified } = this.resolve('setBadge', args[0]);
    const badge = args[1] === undefined || args[1] === null ? null : this.validateBadge(args[1]);
    if (!this.bridge.setAppBadge) return;
    this.bridge.setAppBadge(this.extensionId, qualified, badge);
    if (badge) this.badged.add(qualified);
    else this.badged.delete(qualified);
  }

  private validateBadge(raw: unknown): Extensions.AppBadgeDto {
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new RpcProtocolError('apps.setBadge: badge must be an object or null');
    }
    const b = raw as Record<string, unknown>;
    if (!KINDS.includes(b.kind as (typeof KINDS)[number])) {
      throw new RpcProtocolError("apps.setBadge: kind must be 'dot', 'count' or 'text'");
    }
    const tone = b.tone;
    if (tone !== undefined && !TONES.includes(tone as (typeof TONES)[number])) {
      throw new RpcProtocolError("apps.setBadge: tone must be 'neutral', 'live' or 'attention'");
    }
    if (typeof b.label !== 'string') {
      throw new RpcProtocolError('apps.setBadge: label must be a string');
    }
    const label = b.label.trim();
    if (label.length === 0 || [...label].length > MAX_LABEL_CHARS || FORBIDDEN_CHARS.test(label)) {
      throw new RpcProtocolError(`apps.setBadge: label must be 1..${MAX_LABEL_CHARS} printable characters`);
    }
    const out: Extensions.AppBadgeDto = { kind: b.kind as Extensions.AppBadgeDto['kind'], label };
    if (tone !== undefined) out.tone = tone as NonNullable<Extensions.AppBadgeDto['tone']>;
    if (b.kind === 'count') {
      if (typeof b.value !== 'number' || !Number.isFinite(b.value)) {
        throw new RpcProtocolError("apps.setBadge: a 'count' badge needs a finite numeric value");
      }
      out.value = b.value;
    } else if (b.kind === 'text') {
      if (typeof b.value !== 'string') {
        throw new RpcProtocolError("apps.setBadge: a 'text' badge needs a string value");
      }
      const text = b.value.trim();
      if (text.length === 0 || [...text].length > MAX_TEXT_CHARS || FORBIDDEN_CHARS.test(text)) {
        throw new RpcProtocolError(`apps.setBadge: badge text must be 1..${MAX_TEXT_CHARS} printable characters`);
      }
      out.value = text;
    }
    return out;
  }

  private async handleOpen(args: unknown[]): Promise<boolean> {
    this.guard();
    const { shortId, qualified } = this.resolve('open', args[0]);
    if (!this.gestures.hasRecent(this.extensionId, this.windowMs)) {
      this.log(
        'warn',
        `apps.open('${shortId}') declined: no user gesture in this extension's own UI in the last ` +
          `${Math.round(this.windowMs / 1000)} s (call it from a click, key press, command or notification action handler)`,
      );
      return false;
    }
    if (!this.bridge.requestOpenApp) return false;
    this.bridge.requestOpenApp(this.extensionId, qualified);
    return true;
  }
}
