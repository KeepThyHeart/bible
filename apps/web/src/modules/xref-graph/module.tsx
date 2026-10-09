/**
 * The Cross-ref graph module's code (lazy chunk): what `activate()` adds to the host.
 * It loads when the "Show connections" verse action first runs.
 *
 * - the graph dialog, through the `shellOverlays` slot (it renders itself only while the
 *   store says it is open).
 */
import './xrefGraph.scss';
import type { FeatureModuleContext } from '@bible/core/browser';
import { getShellContext } from '../../host/appHost';
import { shellOverlays } from '../../host/slots';
import { XrefGraphDialog } from './XrefGraphDialog';
import { xrefGraphStore } from './xrefGraphStore';

/** Supplies verse text to the dialog from the shell's Bible provider. */
function XrefGraphOverlay() {
  return <XrefGraphDialog bibleProvider={getShellContext().providers.bible} />;
}

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(
    shellOverlays.register(XrefGraphOverlay),
    // Switched off at runtime: the dialog is gone, so close it for the next activation.
    { dispose: () => xrefGraphStore.close() },
  );
}
