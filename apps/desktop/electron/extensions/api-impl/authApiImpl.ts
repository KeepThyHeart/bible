/**
 * Host-side implementation of `IAuthApi` for one extension worker.
 *
 * Builds on `NetworkApiImpl` (token exchange goes back
 * through the network gateway so the manifest allowlist applies to the
 * provider's `tokenUrl` host) and an injected `IExtensionAuthBroker` that
 * owns the `BrowserWindow` half of the OAuth dance.
 *
 * The api-impl handles every step that does NOT need a window:
 *
 *   1. Permission gate (`network` for `startOAuth`/`refreshOAuth`,
 *      `network:oauth` for `openExternal`).
 *   2. PKCE (S256) code-verifier + code-challenge generation.
 *   3. Authorize URL construction with `state` + `code_challenge`.
 *   4. Hand the URL to the broker, await `{ code, state }` from the
 *      redirect intercept.
 *   5. State validation (constant-time string compare).
 *   6. POST to `tokenUrl` via the network gateway.
 *   7. Map the JSON response to an `OAuthResult` (computing `expiresAt`
 *      from `expires_in`).
 *
 * Tokens never persist on the host side - extensions must call
 * `api.storage.setSecret(...)` if they want refresh tokens to survive a
 * restart. The api-impl explicitly does NOT keep them in memory beyond
 * the resolved promise.
 */

import { createHash, randomBytes } from 'crypto';

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { NetworkApiImpl } from './networkApiImpl';

const { ExtensionNotActiveError, RpcProtocolError } = Extensions;

type StartOAuthOpts = Extensions.StartOAuthOpts;
type RefreshOAuthOpts = Extensions.RefreshOAuthOpts;
type OAuthResult = Extensions.OAuthResult;

/** Pluggable opener for `api.auth.openExternal`. Production wraps `shell.openExternal`. */
export type ExternalUrlOpener = (url: string) => Promise<void>;

/** Result returned by the broker after the user finishes (or aborts) the flow. */
export interface AuthBrokerResult {
  ok: true;
  code: string;
  state: string;
}

export interface AuthBrokerError {
  ok: false;
  code: 'OAuthCancelled' | 'OAuthBrokerError';
  message: string;
}

/**
 * Renderer-facing broker interface. The production impl opens an
 * Electron `BrowserWindow` pointing at `authorizeUrl`, intercepts the
 * `ext-ui://<extId>/<redirectPath>?code=...&state=...` redirect, captures
 * the query params, and resolves. Tests inject a fake.
 */
export interface IExtensionAuthBroker {
  runAuthCodeFlow(opts: {
    extensionId: string;
    authorizeUrl: string;
    expectedRedirectPrefix: string;
    state: string;
    windowTitle?: Extensions.LocalizedString;
  }): Promise<AuthBrokerResult | AuthBrokerError>;
}

export interface AuthApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  grant: ExtensionPermissionGrant;
  /**
   * Network api-impl for this same extension. Token exchange (and refresh)
   * goes through it so the host applies the manifest allowlist + private-IP
   * defenses to the provider host as well as to user-issued fetches.
   */
  network: NetworkApiImpl;
  /** OAuth broker - production opens a BrowserWindow; tests inject a fake. */
  broker: IExtensionAuthBroker;
  /** External URL opener - production wraps `shell.openExternal`. */
  openExternal: ExternalUrlOpener;
  /** Override the secure RNG for PKCE tests. Returns N random bytes. */
  randomBytesFn?: (n: number) => Buffer;
  /** Override the clock used to compute `expiresAt`. */
  clock?: () => number;
}

export class AuthApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly grant: ExtensionPermissionGrant;
  private readonly network: NetworkApiImpl;
  private readonly broker: IExtensionAuthBroker;
  private readonly openExternalFn: ExternalUrlOpener;
  private readonly randomBytesFn: (n: number) => Buffer;
  private readonly clock: () => number;
  private disposed = false;

  constructor(opts: AuthApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.grant = opts.grant;
    this.network = opts.network;
    this.broker = opts.broker;
    this.openExternalFn = opts.openExternal;
    this.randomBytesFn = opts.randomBytesFn ?? randomBytes;
    this.clock = opts.clock ?? Date.now;
  }

  attach(): void {
    this.router.registerNamespace('auth', {
      startOAuth: (args) => this.handleStartOAuth(args),
      refreshOAuth: (args) => this.handleRefreshOAuth(args),
      openExternal: (args) => this.handleOpenExternal(args),
    });
  }

  dispose(): void {
    this.disposed = true;
  }

  // --- Handlers ---------------------------------------------------------

  private async handleStartOAuth(args: unknown[]): Promise<OAuthResult> {
    this.assertActive();
    requirePermission(this.grant, 'network');
    const opts = parseStartOAuthOpts(args[0]);

    const usePkce = opts.pkce !== false;
    const codeVerifier = usePkce ? this.generateCodeVerifier() : undefined;
    const codeChallenge = codeVerifier ? sha256Base64Url(codeVerifier) : undefined;
    const state = this.generateState();
    const redirectPath = opts.redirectPath ?? 'oauth/callback';
    const redirectUri = `ext-ui://${this.extensionId}/${redirectPath.replace(/^\/+/, '')}`;

    const authorizeUrl = buildAuthorizeUrl(opts, {
      redirectUri,
      state,
      codeChallenge,
    });

    const brokerOpts: Parameters<IExtensionAuthBroker['runAuthCodeFlow']>[0] = {
      extensionId: this.extensionId,
      authorizeUrl,
      expectedRedirectPrefix: redirectUri,
      state,
    };
    if (opts.windowTitle !== undefined) brokerOpts.windowTitle = opts.windowTitle;
    const brokerResult = await this.broker.runAuthCodeFlow(brokerOpts);
    if (!brokerResult.ok) {
      throw new RpcProtocolError(`auth.startOAuth: ${brokerResult.message}`, {
        extensionId: this.extensionId,
        brokerCode: brokerResult.code,
      });
    }
    if (!constantTimeEquals(brokerResult.state, state)) {
      throw new RpcProtocolError('auth.startOAuth: state mismatch (possible CSRF)');
    }

    const tokenForm: Record<string, string> = {
      grant_type: 'authorization_code',
      code: brokerResult.code,
      client_id: opts.clientId,
      redirect_uri: redirectUri,
    };
    if (opts.clientSecret) tokenForm.client_secret = opts.clientSecret;
    if (codeVerifier) tokenForm.code_verifier = codeVerifier;
    if (opts.audience) tokenForm.audience = opts.audience;
    if (opts.extraTokenParams) Object.assign(tokenForm, opts.extraTokenParams);

    const tokenResponse = await this.network.fetchInternal(opts.tokenUrl, {
      method: 'POST',
      body: { form: tokenForm },
      responseType: 'json',
      headers: { accept: 'application/json' },
    });

    if (!tokenResponse.ok) {
      throw new RpcProtocolError(
        `auth.startOAuth: token endpoint returned ${tokenResponse.status} ${tokenResponse.statusText}`,
        { extensionId: this.extensionId, status: tokenResponse.status },
      );
    }

    return mapTokenResponse(tokenResponse.body, this.clock());
  }

  private async handleRefreshOAuth(args: unknown[]): Promise<OAuthResult> {
    this.assertActive();
    requirePermission(this.grant, 'network');
    const opts = parseRefreshOAuthOpts(args[0]);

    const tokenForm: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
    };
    if (opts.clientSecret) tokenForm.client_secret = opts.clientSecret;
    if (opts.scopes && opts.scopes.length > 0) tokenForm.scope = opts.scopes.join(' ');

    const tokenResponse = await this.network.fetchInternal(opts.tokenUrl, {
      method: 'POST',
      body: { form: tokenForm },
      responseType: 'json',
      headers: { accept: 'application/json' },
    });

    if (!tokenResponse.ok) {
      throw new RpcProtocolError(
        `auth.refreshOAuth: token endpoint returned ${tokenResponse.status} ${tokenResponse.statusText}`,
        { extensionId: this.extensionId, status: tokenResponse.status },
      );
    }

    return mapTokenResponse(tokenResponse.body, this.clock());
  }

  private async handleOpenExternal(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'network:oauth');
    const url = args[0];
    if (typeof url !== 'string' || url.length === 0) {
      throw new RpcProtocolError('auth.openExternal: url must be a non-empty string');
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new RpcProtocolError(`auth.openExternal: invalid URL '${url}'`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new RpcProtocolError(
        `auth.openExternal: only http(s): URLs are allowed (got '${parsed.protocol}')`,
      );
    }
    await this.openExternalFn(parsed.toString());
  }

  // --- Helpers ----------------------------------------------------------

  private assertActive(): void {
    if (this.disposed) {
      throw new ExtensionNotActiveError(`authApiImpl for ${this.extensionId} is disposed`);
    }
  }

  /** RFC 7636 section 4.1 - 32 random bytes, base64url-encoded => 43 chars. */
  private generateCodeVerifier(): string {
    return base64UrlEncode(this.randomBytesFn(32));
  }

  /** 16 random bytes is plenty for the OAuth `state` parameter. */
  private generateState(): string {
    return base64UrlEncode(this.randomBytesFn(16));
  }
}

// --- Pure helpers (exported for tests) ------------------------------------

export function base64UrlEncode(buf: Uint8Array | Buffer): string {
  const b64 = Buffer.from(buf).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function sha256Base64Url(input: string): string {
  return base64UrlEncode(createHash('sha256').update(input).digest());
}

export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function buildAuthorizeUrl(
  opts: StartOAuthOpts,
  meta: { redirectUri: string; state: string; codeChallenge: string | undefined },
): string {
  let url: URL;
  try {
    url = new URL(opts.authorizeUrl);
  } catch {
    throw new RpcProtocolError(`auth.startOAuth: invalid authorizeUrl '${opts.authorizeUrl}'`);
  }
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', meta.redirectUri);
  url.searchParams.set('state', meta.state);
  if (opts.scopes.length > 0) {
    url.searchParams.set('scope', opts.scopes.join(' '));
  }
  if (meta.codeChallenge) {
    url.searchParams.set('code_challenge', meta.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  if (opts.audience) url.searchParams.set('audience', opts.audience);
  if (opts.prompt) url.searchParams.set('prompt', opts.prompt);
  if (opts.extraAuthorizeParams) {
    for (const [k, v] of Object.entries(opts.extraAuthorizeParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

function mapTokenResponse(body: unknown, now: number): OAuthResult {
  if (typeof body !== 'object' || body === null) {
    throw new RpcProtocolError('auth: token endpoint returned a non-object body');
  }
  const raw = body as Record<string, unknown>;
  const accessToken = raw.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new RpcProtocolError('auth: token response missing access_token');
  }
  const result: OAuthResult = {
    accessToken,
    tokenType: typeof raw.token_type === 'string' ? raw.token_type : 'Bearer',
    raw,
  };
  if (typeof raw.expires_in === 'number' && Number.isFinite(raw.expires_in)) {
    result.expiresAt = now + raw.expires_in * 1000;
  }
  if (typeof raw.refresh_token === 'string') result.refreshToken = raw.refresh_token;
  if (typeof raw.scope === 'string') result.scope = raw.scope;
  return result;
}

function parseStartOAuthOpts(raw: unknown): StartOAuthOpts {
  if (typeof raw !== 'object' || raw === null) {
    throw new RpcProtocolError('auth.startOAuth: opts must be an object');
  }
  const o = raw as Record<string, unknown>;
  const requireString = (k: string): string => {
    const v = o[k];
    if (typeof v !== 'string' || v.length === 0) {
      throw new RpcProtocolError(`auth.startOAuth: opts.${k} must be a non-empty string`);
    }
    return v;
  };
  if (!Array.isArray(o.scopes)) {
    throw new RpcProtocolError('auth.startOAuth: opts.scopes must be an array');
  }
  for (const s of o.scopes) {
    if (typeof s !== 'string') {
      throw new RpcProtocolError('auth.startOAuth: opts.scopes must contain strings');
    }
  }
  const out: StartOAuthOpts = {
    providerId: requireString('providerId'),
    authorizeUrl: requireString('authorizeUrl'),
    tokenUrl: requireString('tokenUrl'),
    clientId: requireString('clientId'),
    scopes: o.scopes as string[],
  };
  if (typeof o.clientSecret === 'string') out.clientSecret = o.clientSecret;
  if (typeof o.pkce === 'boolean') out.pkce = o.pkce;
  if (typeof o.redirectPath === 'string') out.redirectPath = o.redirectPath;
  if (typeof o.audience === 'string') out.audience = o.audience;
  if (typeof o.extraAuthorizeParams === 'object' && o.extraAuthorizeParams !== null) {
    out.extraAuthorizeParams = o.extraAuthorizeParams as Record<string, string>;
  }
  if (typeof o.extraTokenParams === 'object' && o.extraTokenParams !== null) {
    out.extraTokenParams = o.extraTokenParams as Record<string, string>;
  }
  if (o.windowTitle !== undefined) {
    out.windowTitle = o.windowTitle as Extensions.LocalizedString;
  }
  if (typeof o.prompt === 'string') {
    out.prompt = o.prompt as StartOAuthOpts['prompt'];
  }
  return out;
}

function parseRefreshOAuthOpts(raw: unknown): RefreshOAuthOpts {
  if (typeof raw !== 'object' || raw === null) {
    throw new RpcProtocolError('auth.refreshOAuth: opts must be an object');
  }
  const o = raw as Record<string, unknown>;
  const requireString = (k: string): string => {
    const v = o[k];
    if (typeof v !== 'string' || v.length === 0) {
      throw new RpcProtocolError(`auth.refreshOAuth: opts.${k} must be a non-empty string`);
    }
    return v;
  };
  const out: RefreshOAuthOpts = {
    providerId: requireString('providerId'),
    tokenUrl: requireString('tokenUrl'),
    clientId: requireString('clientId'),
    refreshToken: requireString('refreshToken'),
  };
  if (typeof o.clientSecret === 'string') out.clientSecret = o.clientSecret;
  if (Array.isArray(o.scopes)) {
    for (const s of o.scopes) {
      if (typeof s !== 'string') {
        throw new RpcProtocolError('auth.refreshOAuth: opts.scopes must contain strings');
      }
    }
    out.scopes = o.scopes as string[];
  }
  return out;
}
