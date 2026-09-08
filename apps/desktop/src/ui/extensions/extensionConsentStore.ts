/**
 * Renderer-side store for the extension consent prompt.
 *
 * The main process opens a single prompt at a time via the
 * `ext-bridge:consent` channel. The handler in `extensionRendererBridge.ts`
 * pushes a `pending` request into this store; the user's decision in
 * `ExtensionConsentDialog` resolves the underlying Promise back to main.
 */

import { create } from 'zustand';
import type { Extensions } from '@bible/core';

type ExtensionPermission = Extensions.ExtensionPermission;
type ExtensionManifest = Extensions.ExtensionManifest;
type LocalizedString = Extensions.LocalizedString;

export interface PendingConsentRequest {
  manifest: ExtensionManifest;
  requestedPermissions: ExtensionPermission[];
  separatelyPrompted: ExtensionPermission[];
  networkHosts: { host: string; purpose: LocalizedString }[];
  /** Provenance tier from the host. Absent is rendered as untrusted. */
  trustTier?: 'untrusted' | 'signed' | 'marketplace';
  /** Signing key when the package carries an intact signature, trusted or not. */
  signaturePublicKey?: string;
  resolve: (value: { granted: boolean; grantedPermissions?: ExtensionPermission[] }) => void;
}

interface ExtensionConsentState {
  pending: PendingConsentRequest | null;
  setPending(req: PendingConsentRequest | null): void;
}

export const useExtensionConsentStore = create<ExtensionConsentState>((set) => ({
  pending: null,
  setPending(req) {
    set({ pending: req });
  },
}));
