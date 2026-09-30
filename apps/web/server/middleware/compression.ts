import compression from 'compression';
import type { Request, Response } from 'express';

/**
 * Response compression for the web server.
 *
 * Nothing was doing this before: Express served every JSON body and every
 * bundle raw. Measured on the built client, gzip takes `index.js` 555 KB ->
 * 159 KB and `index.css` 221 KB -> 38 KB; a KJV Psalm 119 chapter response
 * goes 49 KB -> 6.7 KB. That is ~80-86% off the wire for one middleware.
 *
 * Mount it before every route and both `express.static` mounts so it covers
 * API JSON, the SPA shell, and the hashed assets alike. If a reverse proxy in
 * front of this already compresses, it sees an already-encoded body and passes
 * it through — the client gets one round of compression, never two.
 */

/**
 * Content types to hand back untouched.
 *
 * The default filter is NOT enough here. `compressible` answers `true` for both
 * of these, which is right for a typical app and wrong for this one:
 *
 *  - `application/octet-stream` is what `/data` serves the semantic-search
 *    embedding vectors and metadata as — up to ~180 MB of already-quantized
 *    int8 data. It is incompressible in practice, so gzipping it burns CPU
 *    proportional to the largest files we host in exchange for approximately
 *    nothing.
 *  - `application/wasm` is the ~21 MB ONNX runtime binary. It does compress,
 *    but it is fetched about once per client and then pinned for 7 days by its
 *    `immutable` cache header, so the cost lands on every cold request and the
 *    benefit lands once.
 *
 * Both are better served by pre-compressing at build time if their transfer
 * size ever becomes the constraint.
 *
 * `text/event-stream` is a different problem, and a worse one. The
 * `compressible` module answers `true` for it -- everything under `text/` is
 * compressible in principle -- but gzip is a buffering codec: it holds bytes
 * back until it has enough to emit a block, so each presenter event would sit
 * in a compressor waiting for the next one. On a stream whose whole purpose is
 * to move a few hundred bytes the instant someone presses a key, that is
 * indistinguishable from the feature not working, and it breaks only once the
 * middleware is mounted -- so it presents as a client bug. See
 * `routes/presentRoutes.ts`.
 */
const SKIP_CONTENT_TYPES = [
  'application/octet-stream',
  'application/wasm',
  'text/event-stream',
];

/**
 * Decides whether a given response should be compressed.
 *
 * Exported for tests: the interesting behaviour is what this *declines*, and
 * that is invisible from the outside once the middleware is mounted.
 */
export function shouldCompress(req: Request, res: Response): boolean {
  // Standard per-request opt-out, honoured by convention.
  if (req.headers['x-no-compression']) return false;

  // Explicit per-response opt-in, set by the route (see `sendDbFile`). It has
  // to win over the content-type list below, because the responses that need it
  // are octet-stream too: a lite Bible module is served as octet-stream like
  // the embedding vectors, but unlike them it is ordinary SQLite pages full of
  // English prose and gives up ~71% to gzip. The skip list is about the
  // *incompressible* octet-stream bodies, and this is how a route says it is
  // not one of those.
  if (res.locals?.compressible === true) return true;

  const contentType = res.getHeader('Content-Type');
  if (typeof contentType === 'string') {
    const base = contentType.split(';')[0].trim().toLowerCase();
    if (SKIP_CONTENT_TYPES.includes(base)) return false;
  }

  // Otherwise defer to `compression`'s own content-type test, which correctly
  // declines the genuinely pre-compressed formats (woff2 fonts, images).
  return compression.filter(req, res);
}

/** The configured middleware, ready to `app.use()`. */
export function createCompression() {
  return compression({ filter: shouldCompress });
}
