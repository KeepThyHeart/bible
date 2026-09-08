/**
 * electron-builder `afterSign` hook - macOS notarization.
 *
 * Optional and self-guarding: this no-ops unless the target is macOS AND all
 * Apple notarization credentials are present in the environment. That means it
 * is safe to leave wired unconditionally in electron-builder.branding.cjs - an
 * unsigned build (no secrets), a Windows build, or a Linux build all fall
 * straight through the early return and never touch `@electron/notarize`.
 *
 * `@electron/notarize` is required LAZILY, only on the real notarization path,
 * so builds that never notarize do not need it installed. When you DO notarize,
 * add it as a devDependency: `npm i -D @electron/notarize`.
 *
 * Required env for notarization to run:
 *   APPLE_ID                     Apple developer account email
 *   APPLE_APP_SPECIFIC_PASSWORD  app-specific password for that account
 *   APPLE_TEAM_ID                the Developer Team ID
 * (plus a Developer ID cert via CSC_LINK/CSC_NAME so the app is signed first -
 *  hardenedRuntime is enabled in the same creds-gated branch of branding.cjs).
 */

'use strict';

module.exports = async function notarize(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only macOS notarizes.
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  // Optional, never required: skip cleanly when creds are absent.
  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      '[notarize] Apple notarization credentials not set — skipping (unsigned/un-notarized build).'
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  // Lazy require so non-notarizing builds don't need the dependency installed.
  // eslint-disable-next-line global-require
  const { notarize } = require('@electron/notarize');

  console.log(`[notarize] Submitting ${appPath} to Apple notary service…`);
  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log('[notarize] Notarization complete.');
};
