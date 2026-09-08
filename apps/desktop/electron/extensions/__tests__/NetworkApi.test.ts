/**
 * Network gateway + INetworkApi + IAuthApi tests.
 *
 * The tests use the same `pairedTransports` / `workerCall` helpers as the
 * other api-impl test files (paired transport gives a real router on each
 * side so the tests exercise the wire format, not just the handler in
 * isolation).
 *
 * Three groups:
 *
 *   1. Gateway-side defenses (allowlist, scheme, private IPs, throttle,
 *      response cap) using a fake `IExtensionNetworkGateway`.
 *   2. Pure helpers (host pattern matcher, IP classification, base64url,
 *      authorize URL builder, constant-time compare).
 *   3. End-to-end OAuth code flow with a fake broker + fake gateway,
 *      including state-mismatch + refresh flow.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import {
  AuthApiImpl,
  NetworkApiImpl,
  matchesHostPattern,
  isLiteralIp,
  isPrivateAddress,
  base64UrlEncode,
  sha256Base64Url,
  constantTimeEquals,
  buildAuthorizeUrl,
  type IExtensionAuthBroker,
  type AuthBrokerResult,
  type AuthBrokerError,
  type DnsResolver,
} from '../api-impl';
import type {
  GatewayRequest,
  GatewayResponse,
  GatewayError,
  IExtensionNetworkGateway,
} from '../gateways/ExtensionNetworkGateway';
import { ElectronNetworkGateway } from '../gateways/ExtensionNetworkGateway';
import type { INetworkGateway } from '../../services/NetworkGateway';
import { attachApiImpls } from '../ExtensionHostRpc';
import { ContributionRegistry } from '../ContributionRegistry';
import type { ActiveWorker, ExtensionHostContext } from '../ExtensionHostTypes';
import { FakeSql } from './fakeSql';

type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;
type AllowedNetworkHost = Extensions.AllowedNetworkHost;

// --- Test helpers (paired transports + workerCall) ------------------------

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
} {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
  const hostSide: IRpcTransport = {
    send(env) {
      hostSent.push(env);
      workerHandler?.(env);
    },
    onMessage(h) {
      hostHandler = h;
    },
    close() {
      hostHandler = null;
    },
  };
  const workerSide: IRpcTransport = {
    send(env) {
      hostHandler?.(env);
    },
    onMessage(h) {
      workerHandler = h;
    },
    close() {
      workerHandler = null;
    },
  };
  return { hostSide, workerSide, hostSent };
}

let nextWorkerReqId = 1;
async function workerCall(
  workerSide: IRpcTransport,
  hostSent: unknown[],
  method: string,
  args: unknown[],
): Promise<RpcResponse> {
  const startLen = hostSent.length;
  const id = `w-${nextWorkerReqId++}`;
  const req: RpcRequest = { kind: 'request', id, method, args };
  workerSide.send(req);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setImmediate(r));
    for (let j = startLen; j < hostSent.length; j++) {
      const env = hostSent[j];
      if (
        env &&
        typeof env === 'object' &&
        (env as RpcResponse).kind === 'response' &&
        (env as RpcResponse).id === id
      ) {
        return env as RpcResponse;
      }
    }
  }
  throw new Error(`workerCall: no response received for ${method}`);
}

// --- Fake gateway ---------------------------------------------------------

class FakeGateway implements IExtensionNetworkGateway {
  readonly calls: GatewayRequest[] = [];
  nextResult: GatewayResponse | GatewayError | undefined;

  async fetch(req: GatewayRequest): Promise<GatewayResponse | GatewayError> {
    this.calls.push(req);
    if (!this.nextResult) {
      // Default: 200 OK with empty body so tests that don't care about
      // the response can ignore it.
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {},
        url: req.url,
        body: new Uint8Array(),
      };
    }
    return this.nextResult;
  }

  reply(body: string, status = 200): void {
    this.nextResult = {
      ok: true,
      status,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      url: 'https://api.example.com/',
      body: new TextEncoder().encode(body),
    };
  }
}

// --- Helpers --------------------------------------------------------------

function publicHosts(...hosts: string[]): AllowedNetworkHost[] {
  return hosts.map((host) => ({ host, purpose: 'test' }));
}

const publicDns: DnsResolver = async () => [{ address: '93.184.216.34', family: 4 }];
const localDns: DnsResolver = async () => [{ address: '127.0.0.1', family: 4 }];

function attachNetwork(opts: {
  extensionId?: string;
  perms?: string[];
  allowedHosts?: AllowedNetworkHost[];
  gateway?: FakeGateway;
  dns?: DnsResolver;
  throttle?: number;
  clock?: () => number;
}): {
  pair: ReturnType<typeof pairedTransports>;
  api: NetworkApiImpl;
  gateway: FakeGateway;
} {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);
  const gateway = opts.gateway ?? new FakeGateway();
  const extensionId = opts.extensionId ?? 'ext.test.network';
  const apiOpts: ConstructorParameters<typeof NetworkApiImpl>[0] = {
    extensionId,
    router,
    grant: buildGrant(extensionId, opts.perms ?? ['network']),
    allowedHosts: opts.allowedHosts ?? publicHosts('api.example.com'),
    gateway,
    dnsResolver: opts.dns ?? publicDns,
  };
  if (opts.throttle !== undefined) apiOpts.throttleRequestsPerMinute = opts.throttle;
  if (opts.clock !== undefined) apiOpts.clock = opts.clock;
  const api = new NetworkApiImpl(apiOpts);
  api.attach();
  return { pair, api, gateway };
}

// --- 1. Network defenses --------------------------------------------------

describe('NetworkApiImpl — defenses', () => {
  beforeEach(() => {
    nextWorkerReqId = 1;
  });

  it('rejects calls without the network permission', async () => {
    const { pair } = attachNetwork({ perms: [] });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/data',
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('rejects non-http(s) URLs', async () => {
    const { pair } = attachNetwork({});
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'file:///etc/passwd',
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error?.message).toContain('http(s)');
  });

  it('rejects hosts not in the allowlist', async () => {
    const { pair } = attachNetwork({});
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://evil.example.org/data',
    ]);
    expect(res.error?.code).toBe('NetworkHostNotAllowedError');
  });

  it('matches wildcard host patterns', async () => {
    const { pair, gateway } = attachNetwork({
      allowedHosts: publicHosts('*.example.com'),
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/v1/items',
    ]);
    expect(res.error).toBeUndefined();
    expect(gateway.calls).toHaveLength(1);
  });

  it('rejects when DNS resolves to a private address', async () => {
    const { pair } = attachNetwork({
      allowedHosts: publicHosts('api.example.com'),
      dns: localDns,
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/data',
    ]);
    expect(res.error?.code).toBe('NetworkHostNotAllowedError');
    expect(res.error?.message).toContain('private');
  });

  it('rejects literal private IPs unless they appear verbatim in the allowlist', async () => {
    const { pair: blocked } = attachNetwork({
      allowedHosts: publicHosts('api.example.com'),
    });
    const a = await workerCall(blocked.workerSide, blocked.hostSent, 'network.fetch', [
      'http://127.0.0.1/data',
    ]);
    expect(a.error?.code).toBe('NetworkHostNotAllowedError');

    const { pair: allowed, gateway } = attachNetwork({
      allowedHosts: publicHosts('127.0.0.1'),
    });
    const b = await workerCall(allowed.workerSide, allowed.hostSent, 'network.fetch', [
      'http://127.0.0.1/data',
    ]);
    expect(b.error).toBeUndefined();
    expect(gateway.calls).toHaveLength(1);
  });

  it('enforces per-host method allowlist', async () => {
    const { pair } = attachNetwork({
      allowedHosts: [{ host: 'api.example.com', purpose: 'test', methods: ['GET'] }],
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/items',
      { method: 'POST', body: '{}' },
    ]);
    expect(res.error?.code).toBe('NetworkHostNotAllowedError');
  });

  it('caps maxResponseBytes at the gateway level', async () => {
    const gateway = new FakeGateway();
    const { pair } = attachNetwork({ gateway });
    await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/data',
      { maxResponseBytes: 1_000_000_000 }, // 1 GB request
    ]);
    expect(gateway.calls[0]!.maxResponseBytes).toBe(100 * 1024 * 1024);
  });

  it('maps gateway ResponseTooLargeError to ResponseTooLargeError on the wire', async () => {
    const gateway = new FakeGateway();
    gateway.nextResult = {
      ok: false,
      code: 'ResponseTooLargeError',
      message: 'Response exceeded 10485760 bytes',
    };
    const { pair } = attachNetwork({ gateway });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/data',
    ]);
    expect(res.error?.code).toBe('ResponseTooLargeError');
  });

  it('throttles after the configured request budget', async () => {
    let now = 1_000_000;
    const { pair } = attachNetwork({ throttle: 2, clock: () => now });
    const ok1 = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/a',
    ]);
    expect(ok1.error).toBeUndefined();
    now += 100;
    const ok2 = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/b',
    ]);
    expect(ok2.error).toBeUndefined();
    now += 100;
    const denied = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/c',
    ]);
    expect(denied.error?.code).toBe('RpcProtocolError');
    expect(denied.error?.message).toContain('throttle');

    // Advance the clock past the 60 s window - the budget refills.
    now += 61_000;
    const recovered = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/d',
    ]);
    expect(recovered.error).toBeUndefined();
  });

  it('serializes JSON bodies and sets Content-Type', async () => {
    const gateway = new FakeGateway();
    const { pair } = attachNetwork({ gateway });
    await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/items',
      { method: 'POST', body: { json: { name: 'Bob' } } },
    ]);
    const call = gateway.calls[0]!;
    expect(call.headers['content-type']).toBe('application/json');
    expect(new TextDecoder().decode(call.body)).toBe('{"name":"Bob"}');
  });

  it('decodes JSON responses when responseType=json', async () => {
    const gateway = new FakeGateway();
    gateway.reply('{"hello":"world"}');
    const { pair } = attachNetwork({ gateway });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/items',
      { responseType: 'json' },
    ]);
    expect(res.error).toBeUndefined();
    expect(res.result).toMatchObject({
      ok: true,
      status: 200,
      body: { hello: 'world' },
    });
  });

  it('isHostAllowed returns true for allowlisted hosts and false otherwise', async () => {
    const { pair } = attachNetwork({
      allowedHosts: publicHosts('*.example.com', 'api.other.io'),
    });
    const yes = await workerCall(pair.workerSide, pair.hostSent, 'network.isHostAllowed', [
      'docs.example.com',
    ]);
    expect(yes.result).toBe(true);
    const no = await workerCall(pair.workerSide, pair.hostSent, 'network.isHostAllowed', [
      'evil.example.org',
    ]);
    expect(no.result).toBe(false);
  });
});

// --- 1b. ElectronNetworkGateway honors the master offline switch ----------

describe('ElectronNetworkGateway — master offline switch', () => {
  function offlineSharedGateway(offline: boolean): INetworkGateway {
    return {
      isOffline: () => offline,
      isConnected: () => true,
      assertEgressAllowed: () => {},
      createRequest: () => {
        throw new Error('createRequest must not be called when offline');
      },
      fetchBuffered: () => Promise.reject(new Error('not used')),
      downloadStream: () => Promise.reject(new Error('not used')),
    };
  }

  const req: GatewayRequest = {
    url: 'https://api.example.com/data',
    method: 'GET',
    headers: {},
    maxResponseBytes: 1024,
    timeoutMs: 1000,
    redirect: 'follow',
  };

  it('returns a NetworkRequestFailedError and opens no socket when offline', async () => {
    let sessionCreated = false;
    const gw = new ElectronNetworkGateway({
      extensionId: 'ext.offline.test',
      sessionFactory: () => {
        sessionCreated = true;
        throw new Error('session must not be created when offline');
      },
      networkGateway: offlineSharedGateway(true),
    });

    const res = await gw.fetch(req);
    expect(res.ok).toBe(false);
    expect((res as GatewayError).code).toBe('NetworkRequestFailedError');
    expect((res as GatewayError).message).toBe('offline mode');
    // No session, no createRequest - the switch is checked first.
    expect(sessionCreated).toBe(false);
  });
});

// --- 2. Pure helpers ------------------------------------------------------

describe('NetworkApiImpl — pure helpers', () => {
  it('matchesHostPattern', () => {
    expect(matchesHostPattern('example.com', 'example.com')).toBe(true);
    expect(matchesHostPattern('example.com', 'api.example.com')).toBe(false);
    expect(matchesHostPattern('*.example.com', 'api.example.com')).toBe(true);
    expect(matchesHostPattern('*.example.com', 'a.b.example.com')).toBe(true);
    expect(matchesHostPattern('*.example.com', 'example.com')).toBe(false);
    expect(matchesHostPattern('*.example.com', 'evil.org')).toBe(false);
  });

  it('isLiteralIp', () => {
    expect(isLiteralIp('127.0.0.1')).toBe(true);
    expect(isLiteralIp('1.2.3.4')).toBe(true);
    expect(isLiteralIp('::1')).toBe(true);
    expect(isLiteralIp('[::1]')).toBe(true);
    expect(isLiteralIp('example.com')).toBe(false);
  });

  it('isPrivateAddress', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.0.0.5')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('169.254.0.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('2001:db8::1')).toBe(false);
  });
});

// --- 3. AuthApiImpl -------------------------------------------------------

class FakeBroker implements IExtensionAuthBroker {
  capturedAuthorizeUrl: string | undefined;
  capturedExtensionId: string | undefined;
  nextResult: AuthBrokerResult | AuthBrokerError | undefined;
  echoState = true;

  async runAuthCodeFlow(opts: {
    extensionId: string;
    authorizeUrl: string;
    expectedRedirectPrefix: string;
    state: string;
  }): Promise<AuthBrokerResult | AuthBrokerError> {
    this.capturedAuthorizeUrl = opts.authorizeUrl;
    this.capturedExtensionId = opts.extensionId;
    if (this.nextResult) return this.nextResult;
    return {
      ok: true,
      code: 'auth-code-xyz',
      state: this.echoState ? opts.state : 'mismatched-state',
    };
  }
}

function attachAuth(opts: {
  perms?: string[];
  brokerResult?: AuthBrokerResult | AuthBrokerError;
  echoState?: boolean;
  openExternal?: (url: string) => Promise<void>;
}): {
  pair: ReturnType<typeof pairedTransports>;
  network: NetworkApiImpl;
  gateway: FakeGateway;
  broker: FakeBroker;
} {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);
  const gateway = new FakeGateway();
  const broker = new FakeBroker();
  if (opts.brokerResult) broker.nextResult = opts.brokerResult;
  if (opts.echoState === false) broker.echoState = false;
  const grant = buildGrant('ext.test.auth', opts.perms ?? ['network']);
  const network = new NetworkApiImpl({
    extensionId: 'ext.test.auth',
    router,
    grant,
    allowedHosts: publicHosts('login.example.com', 'api.example.com'),
    gateway,
    dnsResolver: publicDns,
  });
  network.attach();
  const auth = new AuthApiImpl({
    extensionId: 'ext.test.auth',
    router,
    grant,
    network,
    broker,
    openExternal: opts.openExternal ?? (async () => {}),
    // Deterministic random bytes so the assertions on PKCE / state are stable.
    randomBytesFn: (n: number) => Buffer.alloc(n, 0xab),
    clock: () => 1_700_000_000_000,
  });
  auth.attach();
  return { pair, network, gateway, broker };
}

describe('AuthApiImpl', () => {
  beforeEach(() => {
    nextWorkerReqId = 1;
  });

  it('runs the full authorization-code flow with PKCE', async () => {
    const { pair, gateway, broker } = attachAuth({});
    gateway.reply(
      JSON.stringify({
        access_token: 'at-1',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rt-1',
        scope: 'read',
      }),
    );

    const res = await workerCall(pair.workerSide, pair.hostSent, 'auth.startOAuth', [
      {
        providerId: 'ext.test.auth.provider',
        authorizeUrl: 'https://login.example.com/authorize',
        tokenUrl: 'https://login.example.com/token',
        clientId: 'client-1',
        scopes: ['read', 'write'],
      },
    ]);
    expect(res.error).toBeUndefined();

    const result = res.result as Extensions.OAuthResult;
    expect(result.accessToken).toBe('at-1');
    expect(result.refreshToken).toBe('rt-1');
    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresAt).toBe(1_700_000_000_000 + 3600 * 1000);
    expect(result.scope).toBe('read');

    // Authorize URL must include PKCE + state + redirect_uri.
    expect(broker.capturedAuthorizeUrl).toContain('code_challenge_method=S256');
    expect(broker.capturedAuthorizeUrl).toContain('client_id=client-1');
    expect(broker.capturedAuthorizeUrl).toContain('scope=read+write');
    expect(broker.capturedAuthorizeUrl).toContain('redirect_uri=ext-ui%3A%2F%2Fext.test.auth%2Foauth%2Fcallback');

    // Gateway saw a POST to the token endpoint with form-encoded body.
    const tokenCall = gateway.calls[0]!;
    expect(tokenCall.method).toBe('POST');
    expect(tokenCall.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const formBody = new TextDecoder().decode(tokenCall.body);
    expect(formBody).toContain('grant_type=authorization_code');
    expect(formBody).toContain('code=auth-code-xyz');
    expect(formBody).toContain('code_verifier=');
  });

  it('rejects when the broker echoes back a mismatched state', async () => {
    const { pair } = attachAuth({ echoState: false });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'auth.startOAuth', [
      {
        providerId: 'ext.test.auth.provider',
        authorizeUrl: 'https://login.example.com/authorize',
        tokenUrl: 'https://login.example.com/token',
        clientId: 'client-1',
        scopes: ['read'],
      },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error?.message).toContain('state mismatch');
  });

  it('propagates broker cancellation as RpcProtocolError', async () => {
    const { pair } = attachAuth({
      brokerResult: { ok: false, code: 'OAuthCancelled', message: 'user closed window' },
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'auth.startOAuth', [
      {
        providerId: 'p',
        authorizeUrl: 'https://login.example.com/authorize',
        tokenUrl: 'https://login.example.com/token',
        clientId: 'c',
        scopes: ['x'],
      },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error?.message).toContain('user closed window');
  });

  it('refreshOAuth posts grant_type=refresh_token to the token endpoint', async () => {
    const { pair, gateway } = attachAuth({});
    gateway.reply(
      JSON.stringify({ access_token: 'at-2', token_type: 'Bearer', expires_in: 60 }),
    );
    const res = await workerCall(pair.workerSide, pair.hostSent, 'auth.refreshOAuth', [
      {
        providerId: 'p',
        tokenUrl: 'https://login.example.com/token',
        clientId: 'client-1',
        refreshToken: 'rt-1',
      },
    ]);
    expect(res.error).toBeUndefined();
    const result = res.result as Extensions.OAuthResult;
    expect(result.accessToken).toBe('at-2');
    const formBody = new TextDecoder().decode(gateway.calls[0]!.body);
    expect(formBody).toContain('grant_type=refresh_token');
    expect(formBody).toContain('refresh_token=rt-1');
  });

  it('openExternal requires network:oauth and rejects non-http(s) URLs', async () => {
    const opens: string[] = [];
    const { pair } = attachAuth({
      perms: ['network', 'network:oauth'],
      openExternal: async (url) => {
        opens.push(url);
      },
    });
    const ok = await workerCall(pair.workerSide, pair.hostSent, 'auth.openExternal', [
      'https://docs.example.com/help',
    ]);
    expect(ok.error).toBeUndefined();
    expect(opens).toEqual(['https://docs.example.com/help']);

    const badScheme = await workerCall(pair.workerSide, pair.hostSent, 'auth.openExternal', [
      'file:///etc/passwd',
    ]);
    expect(badScheme.error?.code).toBe('RpcProtocolError');

    // No network:oauth permission => deny.
    const { pair: noPerms } = attachAuth({ perms: ['network'] });
    const denied = await workerCall(noPerms.workerSide, noPerms.hostSent, 'auth.openExternal', [
      'https://docs.example.com/help',
    ]);
    expect(denied.error?.code).toBe('PermissionDeniedError');
  });
});

// --- 4. Pure auth helpers -------------------------------------------------

describe('AuthApiImpl — pure helpers', () => {
  it('base64UrlEncode strips padding and uses URL-safe alphabet', () => {
    expect(base64UrlEncode(Buffer.from([0x14, 0xfb, 0x9c]))).toBe('FPuc');
    expect(base64UrlEncode(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toBe('_____w');
  });

  it('sha256Base64Url is deterministic', () => {
    expect(sha256Base64Url('hello')).toBe(sha256Base64Url('hello'));
    expect(sha256Base64Url('hello')).not.toBe(sha256Base64Url('world'));
  });

  it('constantTimeEquals returns true only for identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });

  it('buildAuthorizeUrl builds a deterministic URL', () => {
    const url = buildAuthorizeUrl(
      {
        providerId: 'p',
        authorizeUrl: 'https://login.example.com/authorize',
        tokenUrl: 'https://login.example.com/token',
        clientId: 'client-1',
        scopes: ['a', 'b'],
        prompt: 'consent',
      },
      { redirectUri: 'ext-ui://x/cb', state: 'st-1', codeChallenge: 'cc-1' },
    );
    expect(url).toContain('client_id=client-1');
    expect(url).toContain('scope=a+b');
    expect(url).toContain('state=st-1');
    expect(url).toContain('code_challenge=cc-1');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('prompt=consent');
  });
});

// --- 4. Redirect re-validation + resolver sharing --------------------------

/**
 * Gateway that replays a scripted sequence of responses, one per hop, so a
 * redirect chain can be driven deterministically.
 */
class ScriptedGateway implements IExtensionNetworkGateway {
  readonly calls: GatewayRequest[] = [];
  private readonly queue: Array<GatewayResponse | GatewayError>;
  /** Set to have the gateway answer `resolveHost` (the transport resolver). */
  resolveHostImpl:
    | ((hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>)
    | undefined;

  constructor(queue: Array<GatewayResponse | GatewayError>) {
    this.queue = [...queue];
  }

  async fetch(req: GatewayRequest): Promise<GatewayResponse | GatewayError> {
    // Snapshot the headers - the api-impl rebuilds them per hop.
    this.calls.push({ ...req, headers: { ...req.headers } });
    const next = this.queue.shift();
    if (next) return next;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      url: req.url,
      body: new TextEncoder().encode('final'),
    };
  }

  resolveHost(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
    if (!this.resolveHostImpl) throw new Error('resolveHost not scripted');
    return this.resolveHostImpl(hostname);
  }
}

function redirectTo(location: string, status = 302): GatewayResponse {
  return {
    ok: true,
    status,
    statusText: 'Found',
    headers: { location },
    url: 'about:blank',
    body: new Uint8Array(),
  };
}

function okBody(text: string): GatewayResponse {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {},
    url: 'about:blank',
    body: new TextEncoder().encode(text),
  };
}

/** Resolver driven by an explicit hostname -> address table. */
function tableDns(table: Record<string, string>): DnsResolver {
  return async (host) => {
    const address = table[host];
    if (!address) throw new Error(`no entry for ${host}`);
    return [{ address, family: 4 }];
  };
}

function errorMessage(res: RpcResponse): string {
  return res.error?.message ?? '';
}

function attachScripted(opts: {
  queue: Array<GatewayResponse | GatewayError>;
  allowedHosts?: AllowedNetworkHost[];
  dns?: DnsResolver;
}): { pair: ReturnType<typeof pairedTransports>; gateway: ScriptedGateway } {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);
  const gateway = new ScriptedGateway(opts.queue);
  const extensionId = 'ext.test.redirect';
  const api = new NetworkApiImpl({
    extensionId,
    router,
    grant: buildGrant(extensionId, ['network']),
    allowedHosts: opts.allowedHosts ?? publicHosts('api.example.com'),
    gateway,
    dnsResolver: opts.dns ?? publicDns,
  });
  api.attach();
  return { pair, gateway };
}

describe('NetworkApiImpl — redirect re-validation', () => {
  beforeEach(() => {
    nextWorkerReqId = 1;
  });

  it('never lets the transport follow redirects itself', async () => {
    const { pair, gateway } = attachScripted({ queue: [okBody('hi')] });
    await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
      { redirect: 'follow' },
    ]);
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]!.redirect).toBe('manual');
  });

  it('blocks a redirect to a host outside the manifest allowlist', async () => {
    const { pair, gateway } = attachScripted({
      queue: [redirectTo('https://evil.example.net/steal')],
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
    ]);
    expect(res.error).toBeDefined();
    expect(errorMessage(res)).toContain('evil.example.net');
    // The second hop was never dispatched.
    expect(gateway.calls).toHaveLength(1);
  });

  it('blocks a redirect to the cloud metadata endpoint', async () => {
    const { pair, gateway } = attachScripted({
      queue: [redirectTo('http://169.254.169.254/latest/meta-data/')],
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
    ]);
    expect(res.error).toBeDefined();
    expect(gateway.calls).toHaveLength(1);
  });

  it('blocks a redirect to an allowlisted host that resolves privately', async () => {
    const { pair, gateway } = attachScripted({
      queue: [redirectTo('https://internal.example.com/')],
      allowedHosts: publicHosts('api.example.com', 'internal.example.com'),
      dns: tableDns({
        'api.example.com': '93.184.216.34',
        'internal.example.com': '10.1.2.3',
      }),
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
    ]);
    expect(res.error).toBeDefined();
    expect(errorMessage(res)).toContain('10.1.2.3');
    expect(gateway.calls).toHaveLength(1);
  });

  it('refuses an https to http downgrade across a redirect', async () => {
    const { pair } = attachScripted({
      queue: [redirectTo('http://api.example.com/x')],
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
    ]);
    expect(res.error).toBeDefined();
    expect(errorMessage(res)).toContain('downgrade');
  });

  it('follows an in-allowlist redirect and returns the final response', async () => {
    const { pair, gateway } = attachScripted({
      queue: [redirectTo('https://api.example.com/moved'), okBody('landed')],
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
    ]);
    expect(res.error).toBeUndefined();
    expect((res.result as { body: string }).body).toBe('landed');
    expect(gateway.calls).toHaveLength(2);
    expect(gateway.calls[1]!.url).toBe('https://api.example.com/moved');
  });

  it('caps the redirect chain rather than looping forever', async () => {
    const queue = Array.from({ length: 25 }, () => redirectTo('https://api.example.com/next'));
    const { pair, gateway } = attachScripted({ queue });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
    ]);
    expect(res.error).toBeDefined();
    expect(errorMessage(res)).toContain('Too many redirects');
    expect(gateway.calls.length).toBeLessThan(25);
  });

  it('rewrites POST to GET and drops the body on a 303', async () => {
    const { pair, gateway } = attachScripted({
      queue: [redirectTo('https://api.example.com/done', 303), okBody('ok')],
    });
    await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
      { method: 'POST', body: 'a=1' },
    ]);
    expect(gateway.calls[0]!.method).toBe('POST');
    expect(gateway.calls[1]!.method).toBe('GET');
    expect(gateway.calls[1]!.body).toBeUndefined();
  });

  it('preserves method and body on a 307', async () => {
    const { pair, gateway } = attachScripted({
      queue: [redirectTo('https://api.example.com/done', 307), okBody('ok')],
    });
    await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
      { method: 'POST', body: 'a=1' },
    ]);
    expect(gateway.calls[1]!.method).toBe('POST');
    expect(gateway.calls[1]!.body).toBeDefined();
  });

  it('strips Authorization across origins but keeps it same-origin', async () => {
    const crossOrigin = attachScripted({
      queue: [redirectTo('https://other.example.com/t'), okBody('ok')],
      allowedHosts: publicHosts('api.example.com', 'other.example.com'),
      dns: tableDns({
        'api.example.com': '93.184.216.34',
        'other.example.com': '93.184.216.35',
      }),
    });
    await workerCall(crossOrigin.pair.workerSide, crossOrigin.pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
      { headers: { Authorization: 'Bearer secret' } },
    ]);
    expect(crossOrigin.gateway.calls[0]!.headers['Authorization']).toBe('Bearer secret');
    expect(crossOrigin.gateway.calls[1]!.headers['Authorization']).toBeUndefined();

    const sameOrigin = attachScripted({
      queue: [redirectTo('https://api.example.com/t'), okBody('ok')],
    });
    await workerCall(sameOrigin.pair.workerSide, sameOrigin.pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
      { headers: { Authorization: 'Bearer secret' } },
    ]);
    expect(sameOrigin.gateway.calls[1]!.headers['Authorization']).toBe('Bearer secret');
  });

  it('honours redirect=error and redirect=manual', async () => {
    const errCase = attachScripted({ queue: [redirectTo('https://api.example.com/y')] });
    const errRes = await workerCall(
      errCase.pair.workerSide,
      errCase.pair.hostSent,
      'network.fetch',
      ['https://api.example.com/x', { redirect: 'error' }],
    );
    expect(errRes.error).toBeDefined();

    const manualCase = attachScripted({ queue: [redirectTo('https://api.example.com/y')] });
    const manualRes = await workerCall(
      manualCase.pair.workerSide,
      manualCase.pair.hostSent,
      'network.fetch',
      ['https://api.example.com/x', { redirect: 'manual' }],
    );
    expect(manualRes.error).toBeUndefined();
    expect((manualRes.result as { status: number }).status).toBe(302);
    expect(manualCase.gateway.calls).toHaveLength(1);
  });
});

describe('NetworkApiImpl — transport-shared resolver', () => {
  beforeEach(() => {
    nextWorkerReqId = 1;
  });

  function attachWithTransportResolver(
    resolveHostImpl: (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>,
  ): { pair: ReturnType<typeof pairedTransports>; gateway: ScriptedGateway } {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const gateway = new ScriptedGateway([okBody('ok')]);
    gateway.resolveHostImpl = resolveHostImpl;
    const api = new NetworkApiImpl({
      extensionId: 'ext.test.resolve',
      router,
      grant: buildGrant('ext.test.resolve', ['network']),
      allowedHosts: publicHosts('api.example.com'),
      gateway,
      // Deliberately NO dnsResolver - production shape.
    });
    api.attach();
    return { pair, gateway };
  }

  it('resolves through the gateway when no resolver is injected', async () => {
    const seen: string[] = [];
    const { pair } = attachWithTransportResolver(async (hostname) => {
      seen.push(hostname);
      return [{ address: '93.184.216.34', family: 4 }];
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
    ]);
    expect(res.error).toBeUndefined();
    expect(seen).toEqual(['api.example.com']);
  });

  it('blocks when the transport resolver reports a private address', async () => {
    const { pair, gateway } = attachWithTransportResolver(async () => [
      { address: '127.0.0.1', family: 4 },
    ]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
    ]);
    expect(res.error).toBeDefined();
    expect(gateway.calls).toHaveLength(0);
  });

  it('rejects a host that resolves to no addresses', async () => {
    const { pair, gateway } = attachScripted({
      queue: [okBody('ok')],
      dns: async () => [],
    });
    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/x',
    ]);
    expect(res.error).toBeDefined();
    expect(gateway.calls).toHaveLength(0);
  });
});

describe('isPrivateAddress — completed classification', () => {
  it('classifies IPv4-mapped IPv6 by the embedded address', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('[::ffff:192.168.1.1]')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
    // Hex spelling of the same mapped addresses.
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('::ffff:a9fe:a9fe')).toBe(true);
  });

  it('classifies NAT64 (64:ff9b::/96) by the embedded address', () => {
    expect(isPrivateAddress('64:ff9b::169.254.169.254')).toBe(true);
    expect(isPrivateAddress('64:ff9b::127.0.0.1')).toBe(true);
    expect(isPrivateAddress('64:ff9b::8.8.8.8')).toBe(false);
  });

  it('covers CGNAT 100.64.0.0/10', () => {
    expect(isPrivateAddress('100.64.0.1')).toBe(true);
    expect(isPrivateAddress('100.127.255.255')).toBe(true);
    expect(isPrivateAddress('100.63.255.255')).toBe(false);
    expect(isPrivateAddress('100.128.0.0')).toBe(false);
  });

  it('handles zone ids and compressed forms', () => {
    expect(isPrivateAddress('fe80::1%eth0')).toBe(true);
    expect(isPrivateAddress('fe80:0:0:0:0:0:0:1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('::')).toBe(true);
    expect(isPrivateAddress('2001:db8::1')).toBe(false);
  });

  it('rejects out-of-range dotted quads instead of calling them public', () => {
    expect(isLiteralIp('999.1.1.1')).toBe(false);
    expect(isLiteralIp('127.0.0.1')).toBe(true);
    expect(isLiteralIp('::ffff:127.0.0.1')).toBe(true);
    expect(isLiteralIp('not.an.ip.address')).toBe(false);
  });
});

// --- 5. Host wiring - which namespaces attach, and what the gaps say ------
//
// Everything above was built, defended, and tested long before anything
// could reach it: `main.ts` never passed `networkGatewayFactory`, so
// `attachApiImpls` skipped the namespace entirely and `api.network.fetch`
// came back as `Unknown RPC method`. That was the right call while
// extensions ran as full Node.js - no sandbox meant no safe egress to
// enable - and the wrong one once the QuickJS realm landed. These tests pin
// the attach rules so the namespace cannot quietly vanish again, and so the
// still-unbuilt OAuth tier keeps saying what it actually means.

/**
 * Build the slice of `ExtensionHostContext` that `attachApiImpls` reads.
 * Every unset bridge is legitimately `undefined` (that is how the host
 * signals "this tier is not wired"), so the cast stands in for ~30 explicit
 * `undefined`s rather than hiding anything. Same test-double style as
 * `ModuleBridges.test.ts`.
 */
function hostContext(over: Partial<ExtensionHostContext>): ExtensionHostContext {
  return {
    db: new FakeSql(),
    contributionRegistry: new ContributionRegistry(),
    ...over,
  } as unknown as ExtensionHostContext;
}

function attachWith(opts: {
  perms: string[];
  ctx?: Partial<ExtensionHostContext>;
}): { pair: ReturnType<typeof pairedTransports> } {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);
  const entry = {
    grantedPermissions: opts.perms,
    manifest: { network: { allowedHosts: publicHosts('api.example.com') } },
  } as unknown as Parameters<typeof attachApiImpls>[2];

  attachApiImpls(
    hostContext(opts.ctx ?? {}),
    'ext.test',
    entry,
    router,
    {} as unknown as ActiveWorker,
  );
  return { pair };
}

const gatewayFactory = (): IExtensionNetworkGateway => new FakeGateway();

describe('attachApiImpls — network tier', () => {
  it('attaches network.* once main.ts supplies a gateway factory', async () => {
    const { pair } = attachWith({
      perms: ['network'],
      ctx: { networkGatewayFactory: gatewayFactory },
    });

    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.isHostAllowed', [
      'api.example.com',
    ]);
    expect(res.error).toBeUndefined();
    expect(res.result).toBe(true);
  });

  it('leaves network.* absent when the extension was not granted `network`', async () => {
    // Feature detection depends on this: an extension that never asked for
    // egress should see the namespace missing, not present-and-rejecting.
    const { pair } = attachWith({
      perms: [],
      ctx: { networkGatewayFactory: gatewayFactory },
    });

    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.isHostAllowed', [
      'api.example.com',
    ]);
    expect(res.error?.message).toContain('Unknown RPC method');
  });

  it('leaves network.* absent when the host wires no gateway at all', async () => {
    const { pair } = attachWith({ perms: ['network'] });

    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', [
      'https://api.example.com/',
    ]);
    expect(res.error?.message).toContain('Unknown RPC method');
  });
});

describe('attachApiImpls — OAuth tier is declared but unbuilt', () => {
  // There is no production `IExtensionAuthBroker` or `ExternalUrlOpener` -
  // only the interface, the api-impl, and the fakes in this file. Until one
  // exists, `auth.*` must not claim the author mistyped a method name.
  it('answers auth.* with "not configured" rather than "Unknown RPC method"', async () => {
    const { pair } = attachWith({
      perms: ['network', 'network:oauth'],
      ctx: { networkGatewayFactory: gatewayFactory },
    });

    for (const method of ['startOAuth', 'refreshOAuth', 'openExternal']) {
      const res = await workerCall(pair.workerSide, pair.hostSent, `auth.${method}`, [{}]);
      expect(res.error?.code).toBe('RpcProtocolError');
      expect(res.error?.message).toContain('OAuth tier is not configured');
      expect(res.error?.message).not.toContain('Unknown RPC method');
    }
  });

  it('does not invent an auth namespace for an extension that never asked', async () => {
    const { pair } = attachWith({
      perms: ['network'],
      ctx: { networkGatewayFactory: gatewayFactory },
    });

    const res = await workerCall(pair.workerSide, pair.hostSent, 'auth.startOAuth', [{}]);
    expect(res.error?.message).toContain('Unknown RPC method');
  });
});
