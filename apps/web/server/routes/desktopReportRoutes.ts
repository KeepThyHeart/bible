/**
 * Reports submitted by the desktop app.
 *
 * POST /api/desktop-report — accepts one queued report from
 * `@bible/desktop`'s diagnostics uploader and persists it under
 * `<dataDir>/desktop-reports`.
 *
 * ## Why this is not `/api/feedback`
 *
 * The web app's own feedback route stores `{category, message, contact}` typed
 * into a browser form. What arrives here is a different thing entirely: a
 * versioned envelope built by the desktop app (`DiagnosticsPayload` in
 * the desktop app's `electron/services/DiagnosticsService.ts`) whose shape
 * depends on the report type, sent by a background uploader rather than by a
 * page. Mixing the two into one directory would mean an operator reading
 * feedback could not tell at a glance which product a submission came from,
 * and every future field added to one shape would have to be made optional in
 * the other. They are kept apart deliberately.
 *
 * ## No IP address is recorded, ever
 *
 * Not in `strict` privacy mode, not in `relaxed`, not behind a flag. The
 * desktop app shows the user a privacy summary before they send
 * (the desktop app's `src/ui/components/diagnostics/privacyBlurb.ts`) whose
 * final line promises that it never sends "Your IP address, timezone, or
 * locale". Recording the address server-side would make that sentence false,
 * and the people most likely to need this promise kept are those reporting
 * from countries where being identified as a Bible reader carries a real cost.
 * The web `/api/feedback` route's `relaxed`-mode IP capture is deliberately
 * NOT mirrored here.
 *
 * ## Bot protection without an IP
 *
 * Discarding the address also discards the usual way of blocking a flood, so
 * the endpoint leans on three cheaper defences instead:
 *
 *  1. A shared token (`X-Report-Token`) baked into the build. It is the same
 *     value in every copy of a release and identifies nobody — it just means a
 *     scanner that finds the URL cannot post to it without also having read a
 *     build config. Configure `desktopReports.token` to require one.
 *  2. Structural validation: a body that is not a recognised report type with
 *     a plausible `report_id` and `timestamp` is rejected before it touches
 *     disk.
 *  3. The size caps below, plus the global `express.json({ limit: '100kb' })`
 *     and the shared rate-limit middleware in `server/index.ts`.
 */

import { Router } from 'express';
import { mkdirSync, writeFileSync } from 'fs';
import { randomUUID, timingSafeEqual } from 'crypto';
import { resolve, join } from 'path';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { registerRoute } from './routeRegistry.js';

/** Report types the desktop app can send. Anything else is rejected. */
const REPORT_TYPES = ['crash', 'manual', 'feedback'] as const;
type ReportType = typeof REPORT_TYPES[number];

/**
 * Caps on the fields we keep. The desktop app already bounds what it builds;
 * these exist because this endpoint is reachable by anything on the internet,
 * not only by the app.
 */
const MAX_DESCRIPTION_LENGTH = 20000;
const MAX_FIELD_LENGTH = 200;
const MAX_SERIALISED_BYTES = 64 * 1024;

/**
 * Fields copied verbatim from the envelope when present, each a short opaque
 * string. Everything else the app sends (the error block, the breadcrumb ring,
 * the state snapshot) is preserved wholesale under `payload`, so a new field
 * added desktop-side needs no change here.
 */
const SCALAR_FIELDS = ['app_version', 'build_id', 'electron_version', 'os', 'arch'] as const;

interface StoredDesktopReport {
  id: string;
  receivedAt: string;
  type: ReportType;
  reportId: string;
  timestamp: string;
  appVersion?: string;
  buildId?: string;
  /** The envelope exactly as sent, minus nothing. Never contains an IP. */
  payload: Record<string, unknown>;
}

function isReportType(value: unknown): value is ReportType {
  return typeof value === 'string' && (REPORT_TYPES as readonly string[]).includes(value);
}

/** A short, printable identifier — the app sends a `shortId()` or a UUID. */
function isPlausibleId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[\w.:-]+$/.test(value);
}

function shortString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, MAX_FIELD_LENGTH);
}

/**
 * Constant-time token comparison. A length-varying `===` would leak the token
 * a byte at a time to anyone willing to measure, which would defeat the one
 * job the token has.
 */
function tokenMatches(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(received, 'utf-8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createDesktopReportRoutes(dataDir: string, requiredToken: string): Router {
  const router = Router();

  // Created once at factory time, mirroring feedbackRoutes.
  const reportDir = resolve(dataDir, 'desktop-reports');
  mkdirSync(reportDir, { recursive: true });

  router.post('/', (req, res): void => {
    try {
      if (requiredToken && !tokenMatches(requiredToken, req.get('X-Report-Token'))) {
        // 404 rather than 401: an unauthenticated scanner learns nothing about
        // whether this path exists, and the desktop uploader treats both as a
        // permanent failure either way.
        sendError(res, 404, ErrorCodes.NOT_FOUND, 'Not found');
        return;
      }

      const body = req.body as Record<string, unknown> | undefined;

      if (!isReportType(body?.type)) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Unrecognised report type');
        return;
      }
      if (!isPlausibleId(body?.report_id)) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'A report id is required');
        return;
      }
      const timestamp = shortString(body?.timestamp);
      if (!timestamp) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'A timestamp is required');
        return;
      }

      // `user_description` is the only free text a person actually typed, so
      // it is the only field worth a length check of its own.
      const description = body?.user_description;
      if (description !== undefined && description !== null) {
        if (typeof description !== 'string') {
          sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Description must be text');
          return;
        }
        if (description.length > MAX_DESCRIPTION_LENGTH) {
          sendError(
            res,
            400,
            ErrorCodes.INVALID_PARAM,
            `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`
          );
          return;
        }
      }

      const receivedAt = new Date();
      const id = randomUUID();

      const scalars: Record<string, string> = {};
      for (const field of SCALAR_FIELDS) {
        const value = shortString(body?.[field]);
        if (value !== undefined) scalars[field] = value;
      }

      const record: StoredDesktopReport = {
        id,
        receivedAt: receivedAt.toISOString(),
        type: body.type,
        reportId: body.report_id,
        timestamp,
        ...(scalars.app_version ? { appVersion: scalars.app_version } : {}),
        ...(scalars.build_id ? { buildId: scalars.build_id } : {}),
        payload: { ...body },
      };

      const serialised = JSON.stringify(record, null, 2);
      if (Buffer.byteLength(serialised, 'utf-8') > MAX_SERIALISED_BYTES) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Report is too large');
        return;
      }

      // One file per report, for the reasons feedbackRoutes gives: concurrent
      // writes cannot interleave, a truncation cannot lose every prior report,
      // and an operator can delete one submission without rewriting a log. The
      // filename is built only from server-generated values — an ISO timestamp
      // with ':' and '.' removed, the report type, and a UUID — so nothing the
      // caller sent ever reaches a path.
      const stamp = receivedAt.toISOString().replace(/[:.]/g, '-');
      writeFileSync(join(reportDir, `${stamp}-${record.type}-${id}.json`), serialised, 'utf-8');

      res.status(201).json({ ok: true, id, receivedAt: record.receivedAt });
    } catch (error) {
      console.error('Error saving desktop report:', error);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to save report');
    }
  });

  return router;
}

registerRoute({
  path: '/api/desktop-report',
  createRoutes: (deps) => createDesktopReportRoutes(
    deps.extra.dataDir as string,
    (deps.extra.desktopReportToken as string | undefined) ?? '',
  ),
});
