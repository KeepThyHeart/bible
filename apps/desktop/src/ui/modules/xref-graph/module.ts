/**
 * The Cross-ref graph module's code (lazy chunk): what `activate()` adds to the host. It loads
 * when the "Show connections" verse action first runs.
 *
 * - the graph dialog, through the `shellOverlays` slot (it renders itself only while open).
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { shellOverlays } from '../host/slots';
import XrefGraphDialog from './XrefGraphDialog';
import { useXrefGraphStore } from './useXrefGraphStore';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(
    shellOverlays.register(XrefGraphDialog),
    // Switched off at runtime: the dialog is gone, so close it for the next activation.
    { dispose: () => useXrefGraphStore.getState().close() }, // allow-getstate: disposal is imperative
  );
}
