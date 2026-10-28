/**
 * Console guard: fail an e2e test when the app logs an error.
 *
 * Collects `console.error`, `console.warn` and uncaught page errors from every
 * window of an Electron app (or any Playwright `Page`) and reports them. A
 * browser console full of React warnings is a bug report nobody reads; making
 * the test fail is how it gets read. Nothing here is suppression: the only way
 * to silence a message is an entry in {@link ALLOWED_CONSOLE_MESSAGES}, and an
 * entry must say why the message is not ours to fix.
 *
 * Self-contained on purpose (only Playwright types), so the web e2e harness and
 * later soak runs can copy or import it unchanged.
 */

import type { ConsoleMessage, Page } from '@playwright/test';

export interface AllowedConsoleMessage {
  /** Matched against the message text. */
  pattern: RegExp;
  /** Why this is not ours to fix. Required: an unexplained entry is a suppression. */
  reason: string;
}

/**
 * Known third-party noise. Keep this list short; fix our own messages instead.
 */
export const ALLOWED_CONSOLE_MESSAGES: readonly AllowedConsoleMessage[] = [
  {
    pattern: /Download the React DevTools/i,
    reason: 'React DevTools install hint, printed by React itself in non-production builds; not a defect.',
  },
  {
    pattern: /Electron Security Warning \(Insecure Content-Security-Policy\)/i,
    reason: 'Electron prints this when the CSP allows unsafe-eval; only raised for unpackaged runs. Tracked outside this task.',
  },
];

export interface ConsoleProblem {
  kind: 'console.error' | 'console.warn' | 'pageerror';
  text: string;
  url?: string;
}

export interface ConsoleGuard {
  /** Start listening to `page`; call once per window, as early as possible. */
  attach(page: Page): void;
  /** Problems seen so far that are not allow-listed. */
  problems(): ConsoleProblem[];
  /** Forget what was seen (e.g. after deliberately provoking an error). */
  clear(): void;
  /** Throws, listing each distinct problem once with its count, if any were seen. */
  assertClean(): void;
}

function isAllowed(text: string): boolean {
  return ALLOWED_CONSOLE_MESSAGES.some(a => a.pattern.test(text));
}

/** A fresh guard. Attach it to pages as early as possible; earlier output is lost. */
export function createConsoleGuard(): ConsoleGuard {
  const seen: ConsoleProblem[] = [];

  const record = (problem: ConsoleProblem): void => {
    if (isAllowed(problem.text)) return;
    seen.push(problem);
  };

  return {
    attach(page: Page): void {
      page.on('console', (msg: ConsoleMessage) => {
        const type = msg.type();
        if (type !== 'error' && type !== 'warning') return;
        record({
          kind: type === 'error' ? 'console.error' : 'console.warn',
          text: msg.text(),
          url: msg.location().url || undefined,
        });
      });
      page.on('pageerror', (error: Error) => {
        record({ kind: 'pageerror', text: error.stack ?? error.message });
      });
    },
    problems: () => [...seen],
    clear: () => { seen.length = 0; },
    assertClean(): void {
      if (seen.length === 0) return;
      const counts = new Map<string, { problem: ConsoleProblem; n: number }>();
      for (const p of seen) {
        const key = `${p.kind}: ${p.text.slice(0, 400)}`;
        const entry = counts.get(key);
        if (entry) entry.n += 1;
        else counts.set(key, { problem: p, n: 1 });
      }
      const lines = [...counts.entries()].map(([key, { n }]) => `  ${n > 1 ? `(x${n}) ` : ''}${key}`);
      throw new Error(
        `The app logged ${seen.length} console problem(s) (${counts.size} distinct). ` +
        `Fix the cause; do not suppress. Third-party noise goes in ALLOWED_CONSOLE_MESSAGES with a reason.\n${lines.join('\n')}`,
      );
    },
  };
}
