/**
 * Failure-counted credential gates. A guess budget is kept per (email, client IP /64) and a much higher one per
 * email overall, and only FAILED attempts spend them, so a stranger hammering an address cannot lock its owner out
 * (the owner signs in from another IP /64 and a correct key is never counted).
 */
import type { Request } from 'express';
import { clientIp, type ServerContext } from '../http';
import { RATE_LIMITS, checkLimit } from '../rateLimit';

const pairKey = (email: string, req: Request): string => `${email}|${clientIp(req)}`;

/** Throws 429 when either budget is already spent. Counts nothing. */
export function authGate(ctx: ServerContext, req: Request, email: string): void {
  checkLimit(ctx.limiter, 'emailAuth', pairKey(email, req));
  checkLimit(ctx.limiter, 'emailAuthGlobal', email);
}

/** Spends one failure from both budgets. */
export function authFail(ctx: ServerContext, req: Request, email: string): void {
  ctx.limiter.hit(RATE_LIMITS.emailAuth, `emailAuth:${pairKey(email, req)}`);
  ctx.limiter.hit(RATE_LIMITS.emailAuthGlobal, `emailAuthGlobal:${email}`);
}
