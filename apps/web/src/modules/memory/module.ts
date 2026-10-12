/**
 * The Memory module's code (lazy chunk): what `activate()` adds to the host. It activates after the first paint (see
 * `binding.probe`) so this tab can answer the worker's `memory.bible` calls whenever it is the leader tab.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { webBible } from './webBible';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  // The client chunk is only imported here, never from entry code; importing it starts nothing (the worker opens on
  // first use).
  const { registerHostApi } = await import('../../userdb/client');
  const off = registerHostApi('memory.bible', webBible as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>);
  ctx.subscriptions.push({ dispose: off });
}
