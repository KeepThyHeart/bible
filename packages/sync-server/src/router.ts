/**
 * The sync API router, mounted by the host at SYNC_API_PREFIX. It carries its own JSON parser (push bodies are
 * up to 8 MiB, above the host's global limit), the CSRF Origin check, the per-IP rate limit, then the route
 * modules, then a JSON error handler.
 */
import express, { Router } from 'express';
import { Sync } from '@bible/core';
import { clientIp, errorHandler, handler, originCheck, sendError, type ServerContext } from './http';
import { enforceLimit } from './rateLimit';
import { accountRoutes } from './routes/account';

const MiB = 1024 * 1024;

export function buildRouter(ctx: ServerContext): Router {
  const r = Router();
  // Responses carry keys and account data: never cache, never sniff.
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  r.use(handler((req, _res, next) => {
    enforceLimit(ctx.limiter, 'ipAll', clientIp(req));
    next();
  }));
  r.use(originCheck(ctx));
  // Small bodies everywhere; only the record push may be large (auth routes never need MBs).
  const smallJson = express.json({ limit: 64 * 1024, strict: true });
  const pushJson = express.json({ limit: Sync.LIMITS.maxPushBodyBytes + MiB, strict: true });
  r.use((req, res, next) => (req.path === '/push' ? pushJson : smallJson)(req, res, next));

  r.use(accountRoutes(ctx));
  // --- W2-C mount lines (records, devices, privacy) ---
  // r.use(recordRoutes(ctx));     // GET changes, POST push
  // r.use(deviceRoutes(ctx));     // GET devices, DELETE devices/:id
  // r.use(privacyRoutes(ctx));    // GET export, DELETE account
  // --- W2-D mount line (email flows) ---
  // r.use(emailFlowRoutes(ctx));  // POST verify-email, reset, reset/confirm; pushes into ctx.onAccountCreated

  r.use((_req, res) => sendError(res, 404, 'not_found'));
  r.use(errorHandler(ctx));
  return r;
}
