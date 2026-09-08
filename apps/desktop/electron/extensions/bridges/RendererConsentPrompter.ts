/**
 * Production consent prompter.
 *
 * A renderer-side modal that walks the user through every requested
 * permission, surfaces the high-risk `SEPARATELY_PROMPTED_PERMISSIONS` with
 * extra detail, and lets the user grant a subset.
 *
 * Wired into `ExtensionHost.setConsentPrompter()` from `main.ts`.
 *
 * The renderer side is in `src/ui/extensions/extensionRendererBridge.ts`
 * (handler for `ext-bridge:consent` op `prompt`) and the UI is rendered by
 * `ExtensionConsentDialog.tsx`.
 */

import type { BrowserWindow } from 'electron';
import type { Extensions } from '@bible/core';

import type { ConsentPrompter } from '../ExtensionHost';
import { BridgeRpc } from './RendererBridgeRpc';

type ExtensionPermission = Extensions.ExtensionPermission;

interface RendererConsentResponse {
  granted: boolean;
  grantedPermissions?: ExtensionPermission[];
}

export function createRendererConsentPrompter(
  getWindow: () => BrowserWindow | null,
): ConsentPrompter {
  const rpc = new BridgeRpc({
    outboundChannel: 'ext-bridge:consent',
    responseChannel: 'ext-bridge:consent:response',
    getWindow,
    timeoutMs: 5 * 60_000, // user has up to 5 minutes to decide
  });

  return async (req) => {
    try {
      const response = await rpc.request<RendererConsentResponse>('prompt', [
        {
          manifest: req.manifest,
          requestedPermissions: req.requestedPermissions,
          separatelyPrompted: req.separatelyPrompted,
          networkHosts: req.networkHosts,
          // Provenance drives the untrusted banner in the dialog.
          trustTier: req.trustTier,
          signaturePublicKey: req.signaturePublicKey,
        },
      ]);
      if (response.granted && response.grantedPermissions) {
        return { granted: true, grantedPermissions: response.grantedPermissions };
      }
      return { granted: false };
    } catch {
      // If the renderer is missing or the prompt times out we treat it as a
      // refusal - better than auto-granting against the user's wishes.
      return { granted: false };
    }
  };
}
