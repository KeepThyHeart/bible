/**
 * Express request/response stubs shared by the middleware tests.
 *
 * `passwordGate.test.ts` and `rateLimiter.test.ts` each carried their own copy
 * of these, and both wrote `socket: { remoteAddress }` straight into a
 * `Partial<Request>` — which does not type-check, because `Socket` has some
 * ninety other members. That went unnoticed for as long as the test files were
 * excluded from `tsconfig.json`.
 *
 * The cast is confined to `mockSocket` below rather than sprinkled through the
 * call sites, so what is being faked, and how little of it, stays visible.
 */
import type { Request, Response } from 'express';
import type { Socket } from 'net';
import { vi, type Mock } from 'vitest';

/**
 * `remoteAddress` is the only member of `Socket` this middleware reads — it is
 * the client-IP fallback when `req.ip` is unset (no trust-proxy). Constructing
 * a real `Socket` to supply one string would test Node, not the middleware.
 */
export function mockSocket(remoteAddress: string | undefined): Socket {
  return { remoteAddress } as Socket;
}

/**
 * Overrides for `mockRequest`.
 *
 * `socket` is replaced by a flat `remoteAddress` so callers never have to hold
 * a `Socket`. Passing `remoteAddress: undefined` explicitly means "this request
 * has no socket address", which is a case both middlewares handle.
 */
export type RequestOverrides = Partial<Omit<Request, 'socket'>> & {
  remoteAddress?: string | undefined;
};

export function mockRequest(overrides: RequestOverrides = {}): Request {
  const { remoteAddress, ...rest } = overrides;
  const req: Partial<Request> = {
    headers: {},
    method: 'GET',
    path: '/api/bible',
    protocol: 'http',
    ip: '127.0.0.1',
    body: {},
    // `in` rather than `??`: an explicit `remoteAddress: undefined` is a case
    // under test ("uses 'unknown' if no IP available"), not an omitted argument.
    socket: mockSocket('remoteAddress' in overrides ? remoteAddress : '127.0.0.1'),
    // Middleware checks `req.accepts(['html', 'json'])` to decide whether to
    // render the HTML password page or return JSON; default to the HTML case.
    accepts: vi.fn().mockReturnValue('html') as unknown as Request['accepts'],
    ...rest,
  };
  return req as Request;
}

/** A `Response` whose chainable methods are spies. */
export function mockResponse(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res as Response);
  res.json = vi.fn().mockReturnValue(res as Response);
  res.send = vi.fn().mockReturnValue(res as Response);
  res.redirect = vi.fn().mockReturnValue(res as Response);
  res.setHeader = vi.fn().mockReturnValue(res as Response);
  res.getHeader = vi.fn();
  return res as Response;
}

/**
 * A `next` that is also a spy.
 *
 * Typed as the intersection rather than as `NextFunction`: the tests call
 * `next.mockClear()` and read `next.mock.calls`, neither of which exists on
 * `NextFunction`, and both files declared it the narrow way.
 */
export type MockNext = Mock & ((...args: unknown[]) => void);

export function mockNext(): MockNext {
  return vi.fn() as MockNext;
}

/** Read a header the middleware set, by name. */
export function headerCalls(res: Response, name: string): unknown[][] {
  return (res.setHeader as unknown as Mock).mock.calls.filter(
    (call: unknown[]) => call[0] === name,
  );
}
