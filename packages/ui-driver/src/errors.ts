/**
 * Collects what the app complains about (console, page errors, failed or
 * erroring requests) so an agent can ask `errors` instead of reading logs.
 * Deduplicated and capped: a render loop must not flood the agent.
 */

import type { ConsoleMessage, Page, Request, Response } from 'playwright-core';
import type { ErrorEntry, ErrorKind } from './types.ts';

const MAX_TEXT = 200;
const MAX_ENTRIES = 500;

/** Known third-party noise (mirrors apps/desktop/e2e/fixtures/consoleGuard.ts). */
const ALLOWED: RegExp[] = [
  /Download the React DevTools/i,
  /Electron Security Warning \(Insecure Content-Security-Policy\)/i,
];

const REACT_PATTERN = /ErrorBoundary|The above error occurred|Render (error|crash)|error occurred in the <\w+> component/i;

function basename(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? path;
  return clean.slice(clean.lastIndexOf('/') + 1);
}

/** First line only, whitespace collapsed, at most 200 chars. */
function normalise(text: string): string {
  const line = (text.split('\n').find(l => l.trim() !== '') ?? '').replace(/\s+/g, ' ').trim();
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1)}…` : line;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Drops the page's own origin, trims a long query, keeps at most 100 chars. */
function shortUrl(url: string, pageUrl: string): string {
  let out = url;
  const origin = originOf(pageUrl);
  if (origin && origin !== 'null' && url.startsWith(origin)) out = url.slice(origin.length) || '/';
  const q = out.indexOf('?');
  if (q >= 0 && out.length - q > 40) out = out.slice(0, q + 40);
  return out.length > 100 ? out.slice(0, 100) : out;
}

function pageUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}

export class ErrorCollector {
  private seq = 0;
  private readonly entries = new Map<string, ErrorEntry>();

  attach(page: Page): void {
    page.on('console', (msg: ConsoleMessage) => {
      const type = msg.type();
      if (type !== 'error' && type !== 'warning') return;
      let text = msg.text();
      const loc = msg.location();
      if (loc?.url) text = `${normalise(text)} (${basename(loc.url)}:${loc.lineNumber})`;
      const kind: ErrorKind = type === 'warning' ? 'warning' : REACT_PATTERN.test(msg.text()) ? 'react' : 'console';
      this.add(kind, text);
    });
    page.on('pageerror', (error: Error) => {
      const frame = (error.stack ?? '').split('\n').map(l => /(?:\(|\s)([^\s()]+):(\d+):\d+\)?$/.exec(l.trim())).find(Boolean);
      const where = frame ? ` (${basename(frame[1] ?? '')}:${frame[2]})` : '';
      this.add('pageerror', `${normalise(error.message)}${where}`);
    });
    page.on('requestfailed', (req: Request) => {
      this.add('netfail', `${req.method()} ${shortUrl(req.url(), pageUrl(page))} ${req.failure()?.errorText ?? ''}`.trim());
    });
    page.on('response', (res: Response) => {
      if (res.status() < 400) return;
      this.add('http', `${res.status()} ${res.request().method()} ${shortUrl(res.url(), pageUrl(page))}`);
    });
  }

  add(kind: ErrorKind, text: string): void {
    const norm = normalise(text);
    if (ALLOWED.some(re => re.test(norm))) return;
    const key = `${kind}\n${norm}`;
    const seq = ++this.seq;
    const prev = this.entries.get(key);
    // Delete then set so the Map's order is least-recently-seen first (cap drops the front).
    if (prev) this.entries.delete(key);
    this.entries.set(key, prev ? { ...prev, seq, count: prev.count + 1 } : { seq, kind, text: norm, count: 1 });
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  lastSeq(): number {
    return this.seq;
  }

  since(seq: number, opts?: { warnings?: boolean }): ErrorEntry[] {
    return this.all(opts).filter(e => e.seq > seq);
  }

  all(opts?: { warnings?: boolean }): ErrorEntry[] {
    return [...this.entries.values()]
      .filter(e => opts?.warnings || e.kind !== 'warning')
      .sort((a, b) => a.seq - b.seq);
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Terse listing for the agent: `[kind] text ×N`, newest last. */
export function formatErrors(entries: ErrorEntry[], opts?: { max?: number; warnings?: boolean }): string {
  const max = opts?.max ?? 8;
  const shown = entries.filter(e => opts?.warnings || e.kind !== 'warning');
  if (shown.length === 0) return 'none';
  const lines = shown.slice(-max).map(e => `[${e.kind}] ${e.text}${e.count > 1 ? ` ×${e.count}` : ''}`);
  if (shown.length > max) lines.push(`… +${shown.length - max} more (errors --all)`);
  return lines.join('\n');
}
