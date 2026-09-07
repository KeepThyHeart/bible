import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import uiCatalog from '../../src/locales/en/ui.json' with { type: 'json' };

/** Hash a password with scrypt. Returns "salt:hash" hex string. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** Verify a password against a "salt:hash" string using timing-safe comparison. */
function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// Simple in-memory rate limiter for login attempts.
// Tracks failed attempts per IP; blocks after too many failures.
const LOGIN_RATE_LIMIT = {
  maxAttempts: 5,       // max failed attempts before lockout
  windowMs: 15 * 60_000, // 15-minute window
};
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return false;
  // Reset window if expired
  if (now - record.firstAttempt > LOGIN_RATE_LIMIT.windowMs) {
    loginAttempts.delete(ip);
    return false;
  }
  return record.count >= LOGIN_RATE_LIMIT.maxAttempts;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now - record.firstAttempt > LOGIN_RATE_LIMIT.windowMs) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count++;
  }
}

function clearAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

// Item #10: HTML escaping to prevent XSS in error messages
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The login page's wording, read from the same English catalog the app uses.
 *
 * This is the first screen anyone meets on a gated deployment, so its text
 * belongs where the rest of the app's English is reviewable rather than inline
 * in a template literal. The catalog is imported rather than resolved through
 * i18next because there is no session yet — nobody has told us a language, and
 * the page has to render before anything else can.
 */
const LOGIN = (uiCatalog as { login: Record<string, string> }).login;

function loginPage(error?: string) {
  return `<!DOCTYPE html><html><head><title>${escapeHtml(LOGIN.title!)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100dvh;margin:0;background:#f5f5f5}
.box{background:#fff;padding:2.5rem;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.12);text-align:center;width:90%;max-width:400px;box-sizing:border-box}
h2{font-size:1.5rem;margin:0 0 1.5rem}
input{display:block;width:100%;padding:.85rem 1rem;margin:0 0 1rem;font-size:1.1rem;border:1px solid #ccc;border-radius:6px;box-sizing:border-box}
button{display:block;width:100%;padding:.85rem;font-size:1.1rem;cursor:pointer;background:#2563eb;color:#fff;border:none;border-radius:6px}
button:active{background:#1d4ed8}
.err{color:red;margin-bottom:1rem;font-size:1rem}
</style></head>
<body><div class="box"><h2>${escapeHtml(LOGIN.heading!)}</h2>
${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
<form method="POST" action="/login"><input type="password" name="password" placeholder="${escapeHtml(LOGIN.passwordPlaceholder!)}" autofocus>
<button type="submit">${escapeHtml(LOGIN.submit!)}</button></form></div></body></html>`;
}

export function createPasswordGate(options: {
  passwordHash: string;
  /**
   * In "strict" (default), auth cookies are session-only (no Max-Age) so that
   * closing the browser forgets the login. In "relaxed", cookies persist for
   * a year for convenience.
   */
  privacyMode?: 'strict' | 'relaxed';
}): (req: Request, res: Response, next: NextFunction) => void {
  const { passwordHash } = options;
  const privacyMode = options.privacyMode ?? 'strict';
  const maxAgeClause = privacyMode === 'relaxed' ? '; Max-Age=31536000' : '';

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for static assets — these are non-sensitive build artifacts that must
    // load for the app to function.  Web Workers (blob-URL origin) may not send
    // cookies, so gating these behind auth causes WASM/JS loads to fail.
    // `.webmanifest` is included because the browser fetches the PWA manifest without
    // credentials unless the link carries crossorigin="use-credentials"; gating it
    // returns a 401 and the install/manifest metadata silently fails to load.
    if (/\.(js|css|wasm|svg|png|ico|woff2?|map|webmanifest)$/i.test(req.path)) return next();

    // Skip auth for browser-side semantic-search index files under /data/ (the .bin
    // vectors and .meta.json metadata). These are non-sensitive, filename-versioned
    // artifacts fetched from a Web Worker, which may not send the auth cookie — gating
    // them returns the login HTML and the worker chokes trying to JSON.parse it.
    if (req.path.startsWith('/data/') && /\.(bin|json)$/i.test(req.path)) return next();

    // Check for auth cookie
    const cookies = req.headers.cookie || '';
    const authed = cookies.split(';').some(c => c.trim() === 'bible_auth=1');
    if (authed) return next();

    // For non-navigation requests (fetch/XHR that expect JSON, not a browser navigating
    // to a page), answer with a JSON 401 instead of the HTML login page. Sending login
    // HTML to a JSON consumer is what makes an auth failure masquerade as valid content
    // and blow up on JSON.parse. Browsers navigating to a page still get the login form.
    if (req.accepts(['html', 'json']) !== 'html') {
      res.status(401).json({ error: 'Unauthorized', reason: 'auth_required' });
      return;
    }

    // Handle login POST
    if (req.method === 'POST' && req.path === '/login') {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';

      if (isRateLimited(ip)) {
        return res.status(429).send(loginPage(LOGIN.tooManyAttempts!));
      }

      if (verifyPassword(req.body?.password || '', passwordHash)) {
        clearAttempts(ip);
        const secure = req.protocol === 'https' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `bible_auth=1; Path=/; HttpOnly; SameSite=Lax${maxAgeClause}${secure}`);
        return res.redirect('/');
      }

      recordFailedAttempt(ip);
      return res.status(401).send(loginPage(LOGIN.incorrectPassword!));
    }

    // Show login form — clear any stale auth cookie so the browser doesn't loop
    res.setHeader('Set-Cookie', 'bible_auth=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.status(401).send(loginPage());
  };
}
