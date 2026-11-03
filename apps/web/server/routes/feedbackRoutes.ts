/**
 * User feedback submissions.
 *
 * POST /api/feedback — accepts a short message (plus an optional category and
 * an optional way to reply) and persists it under `<dataDir>/feedback`.
 *
 * Rate limiting is deliberately not mounted here: `/api/feedback` is not listed
 * in `tierForApiPath()`, so it falls to the `default` tier (120/min) through the
 * single tier middleware in `server/index.ts`. Adding an `app.use` for it would
 * double-charge the request — see `docs/features/server-api.md` "Rate limiting".
 *
 * That tier bounds request *rate*, not what reaches disk, and this route is open
 * to anyone once the site password is off. So a valid submission is also charged
 * to a per-client hourly quota, and the directory as a whole has a size cap
 * (`FeedbackLimits`).
 */

import { Router } from 'express';
import { mkdirSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { resolve, join } from 'path';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { createClientQuota } from '../utils/clientQuota.js';
import { createDirectoryBudget } from '../utils/directoryBudget.js';
import { registerRoute } from './routeRegistry.js';
import type { PrivacyMode } from '../SiteConfig.js';

/** Categories a submission may declare. Anything else is rejected. */
const CATEGORIES = ['bug', 'idea', 'other'] as const;
type FeedbackCategory = typeof CATEGORIES[number];

/**
 * Caps. The global `express.json({ limit: '100kb' })` already bounds the whole
 * body, but that is a transport limit — these bound what we are willing to keep
 * on disk, and give the user a specific 400 instead of a generic parser error.
 */
const MAX_MESSAGE_LENGTH = 5000;
const MAX_CONTACT_LENGTH = 200;

/** What one client may store, and what the store may hold in total. */
export interface FeedbackLimits {
  perClientPerHour: number;
  maxFiles: number;
  maxBytes: number;
}

/**
 * A person sending feedback sends one or two messages; ten an hour leaves room
 * for a shared address (a church or school network) without letting a script
 * write thousands. The totals are far above any real backlog: at ~5 KB a file
 * the byte cap is reached only by abuse.
 */
export const DEFAULT_FEEDBACK_LIMITS: FeedbackLimits = {
  perClientPerHour: 10,
  maxFiles: 5000,
  maxBytes: 50 * 1024 * 1024,
};

interface StoredFeedback {
  id: string;
  submittedAt: string;
  category: FeedbackCategory;
  message: string;
  /** Whatever the user typed as a way to reach them; omitted when they left it blank. */
  contact?: string;
  /**
   * Only ever populated in 'relaxed' privacy mode. In 'strict' (the default)
   * no client-identifying value is written to disk at all.
   */
  ip?: string;
}

function isCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export function createFeedbackRoutes(
  dataDir: string,
  privacyMode: PrivacyMode,
  limits: FeedbackLimits = DEFAULT_FEEDBACK_LIMITS,
): Router {
  const router = Router();

  // Created once at factory time rather than per request, mirroring the
  // lite-cache directory in moduleRoutes.
  const feedbackDir = resolve(dataDir, 'feedback');
  mkdirSync(feedbackDir, { recursive: true });
  const quota = createClientQuota({ limit: limits.perClientPerHour, windowMs: 60 * 60_000 });
  const budget = createDirectoryBudget(feedbackDir, limits);

  router.post('/', (req, res): void => {
    try {
      const body = req.body as Record<string, unknown> | undefined;

      const rawMessage = body?.message;
      if (typeof rawMessage !== 'string') {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'A feedback message is required');
        return;
      }
      const message = rawMessage.trim();
      if (message.length === 0) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'A feedback message is required');
        return;
      }
      if (message.length > MAX_MESSAGE_LENGTH) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, `Feedback message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
        return;
      }

      // Absent/empty category means "unspecified", which we store as 'other'.
      // A value that is present but unrecognised is a client bug, not a default.
      const rawCategory = body?.category;
      let category: FeedbackCategory = 'other';
      if (rawCategory !== undefined && rawCategory !== null && rawCategory !== '') {
        if (!isCategory(rawCategory)) {
          sendError(res, 400, ErrorCodes.INVALID_PARAM, `Category must be one of: ${CATEGORIES.join(', ')}`);
          return;
        }
        category = rawCategory;
      }

      const rawContact = body?.contact;
      if (rawContact !== undefined && rawContact !== null && typeof rawContact !== 'string') {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Contact must be text');
        return;
      }
      const contact = typeof rawContact === 'string' ? rawContact.trim() : '';
      if (contact.length > MAX_CONTACT_LENGTH) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, `Contact must be ${MAX_CONTACT_LENGTH} characters or fewer`);
        return;
      }

      const submittedAt = new Date();
      const id = randomUUID();

      const record: StoredFeedback = {
        id,
        submittedAt: submittedAt.toISOString(),
        category,
        message,
        ...(contact ? { contact } : {}),
        // `privacy.mode` defaults to 'strict', where an IP must never reach disk.
        ...(privacyMode === 'relaxed' && req.ip ? { ip: req.ip } : {}),
      };

      // One file per submission rather than an append-only JSONL log:
      // concurrent requests write disjoint files, so there is no interleaving
      // to corrupt and no single file whose truncation loses every prior
      // submission; and an operator can delete or forward one submission
      // without rewriting a log. The filename is built entirely from
      // server-generated values (an ISO timestamp with the ':' and '.'
      // separators removed, plus a UUID) — nothing the caller sent ever reaches
      // a path, so there is no traversal surface here at all.
      const serialised = JSON.stringify(record, null, 2);
      const bytes = Buffer.byteLength(serialised, 'utf-8');
      // Checked only once the submission is known to be valid, so a rejected
      // form costs the sender nothing against their quota.
      if (!budget.hasRoom(bytes)) {
        console.warn('[feedback] store is full; submission refused');
        sendError(res, 503, ErrorCodes.STORAGE_FULL, 'Feedback cannot be accepted right now. Please try again later.');
        return;
      }
      const retryAfter = quota.take(req);
      if (retryAfter !== null) {
        res.setHeader('Retry-After', String(retryAfter));
        sendError(res, 429, ErrorCodes.RATE_LIMITED, 'Too much feedback from this connection. Please try again later.');
        return;
      }

      const stamp = submittedAt.toISOString().replace(/[:.]/g, '-');
      const filePath = join(feedbackDir, `${stamp}-${id}.json`);
      writeFileSync(filePath, serialised, 'utf-8');
      budget.recordWrite(bytes);

      // Deliberately no path in the response: where submissions live on disk is
      // the operator's business, not the caller's.
      res.status(201).json({ ok: true, id, submittedAt: record.submittedAt });
    } catch (error) {
      console.error('Error saving feedback:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to save feedback');
    }
  });

  return router;
}

registerRoute({
  path: '/api/feedback',
  createRoutes: (deps) => createFeedbackRoutes(
    deps.extra.dataDir as string,
    deps.extra.privacyMode as PrivacyMode,
  ),
});
