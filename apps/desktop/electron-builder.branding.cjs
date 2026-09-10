/**
 * Shared branding + optional-signing profile for the electron-builder configs.
 *
 * electron-builder does NOT expand `${env.X}` inside plain config values such
 * as `productName` (macro expansion is limited to artifact-name style fields),
 * so this JS parent config reads the environment itself. Both
 * `electron-builder.yml` and `electron-builder.curated.yml` pull it in via
 * `extends: file:electron-builder.branding.cjs`. electron-builder DEEP-merges the
 * extends chain, so a child yml may add sibling keys under `win`/`mac`/`nsis`
 * (e.g. `win.target`) and the values set here survive - but a child that
 * RE-DECLARES a key set here overrides it. Therefore the child ymls must NOT
 * re-declare `appId`, `productName`, `nsis.shortcutName`,
 * `win.signAndEditExecutable`, `mac.hardenedRuntime`, or `afterSign`.
 *
 * ===================================================================
 * NEUTRAL-BRANDING PROFILE  (persecuted-user footprint)
 * ===================================================================
 * Two env vars neutralise the on-disk footprint of a build. They are OPT-IN:
 * the defaults keep the ordinary "Keep Thy Heart Bible Reader" identity, so a normal
 * release is unchanged.
 *
 *   BIBLE_PRODUCT_NAME   user-visible product name (default "Keep Thy Heart Bible Reader")
 *   BIBLE_APP_ID         application id / reverse-DNS (default com.bibledesktopapp.app)
 *
 * `BIBLE_PRODUCT_NAME` flows to EVERY name-derived location:
 *   - install directory (NSIS default is the product name)
 *   - Start-menu + desktop shortcut names (nsis.shortcutName, below)
 *   - the packaged app name, from which Electron derives BOTH:
 *       * userData dir  (app.getPath('userData'))
 *       * the electron-log log dir  (electron-log keys off app.getName())
 *     The same variable is read at runtime by electron/config/appConfig.ts
 *     (DEFAULT_PRODUCT_NAME kept in sync there), so build-time and run-time agree.
 * `BIBLE_APP_ID` neutralises the Windows uninstall-registry key and the
 * AppUserModelID (both derived from appId), which otherwise embed "bible".
 *
 * Produce a neutral build, e.g.:
 *   BIBLE_PRODUCT_NAME="Study Notes" BIBLE_APP_ID="com.studynotes.app" \
 *     npx electron-builder --win
 * Result: no "Bible" string in the install path, the shortcuts, the userData
 * dir, the log dir, the uninstall key, or the AUMID.
 *
 * STILL APP-SOURCE (out of scope for this config; follow-up for the app agent):
 * the in-window title bar and in-app strings come from the renderer, not from
 * electron-builder. appConfig.ts already reads BIBLE_PRODUCT_NAME for the window
 * title/About dialog, but any hard-coded "Bible" UI strings must be audited
 * separately to make the neutral profile complete end to end.
 *
 * ===================================================================
 * OPTIONAL CODE SIGNING  (optional, NEVER required)
 * ===================================================================
 * Signing activates ONLY when credentials are present in the environment; with
 * no secrets set, electron-builder produces a working UNSIGNED installer/dmg and
 * the build still succeeds. Same config, no code changes between the two.
 *
 * WINDOWS. `win.signAndEditExecutable` is true only when a Windows signing
 * credential is detected, else false (which also skips rcedit - matching the
 * prior hard-coded behaviour). Options, in order of preference for an OSS app:
 *   1. SignPath.io Foundation (FREE certificates + signing for OSS projects).
 *      Typical flow signs the artifact AFTER electron-builder produces it, via
 *      the SignPath GitHub Action - set BIBLE_WIN_SIGN=1 so this config enables
 *      rcedit/metadata but leaves the actual signature to the post-build step,
 *      OR wire electron-builder's own signing and point CSC_LINK at the cert.
 *   2. Azure Trusted Signing (cheap, cloud HSM; no long-lived cert on disk).
 *      Add `win.azureSignOptions` in a private overlay config and set the
 *      AZURE_* env vars; set BIBLE_WIN_SIGN=1 to flip signAndEditExecutable on.
 *   3. Traditional OV/EV .pfx: set CSC_LINK (path or base64) + CSC_KEY_PASSWORD;
 *      electron-builder signs automatically.
 *
 * macOS. `mac.hardenedRuntime` and the `afterSign` notarization hook
 * (scripts/notarize.cjs) activate only when Apple signing + notarization creds are
 * all present: CSC_LINK/CSC_NAME (Developer ID cert) AND APPLE_ID AND
 * APPLE_APP_SPECIFIC_PASSWORD AND APPLE_TEAM_ID. Otherwise an unsigned,
 * un-notarized dmg still builds. The hook itself also re-checks and no-ops when
 * creds are absent, so it is safe to leave wired unconditionally.
 *
 * Keep DEFAULT_PRODUCT_NAME in sync with `DEFAULT_PRODUCT_NAME` in
 * `electron/config/appConfig.ts`.
 */

const DEFAULT_PRODUCT_NAME = 'Keep Thy Heart Bible Reader';
const DEFAULT_APP_ID = 'com.bibledesktopapp.app';

/** Trimmed env value, or undefined when unset/blank. */
function envStr(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

const productName = envStr('BIBLE_PRODUCT_NAME') || DEFAULT_PRODUCT_NAME;
const appId = envStr('BIBLE_APP_ID') || DEFAULT_APP_ID;

// --- Optional-signing gates (presence of creds = activate; absence = unsigned) ---

// Windows: a real cert (CSC_LINK/WIN_CSC_LINK) OR an explicit opt-in for the
// cloud/post-build signers (SignPath OSS, Azure Trusted Signing) that supply the
// signature outside electron-builder's own CSC path.
const windowsSigningConfigured = Boolean(
  envStr('CSC_LINK') || envStr('WIN_CSC_LINK') || envStr('BIBLE_WIN_SIGN')
);

// macOS: notarization needs the Developer ID cert AND all three Apple creds.
const macSigningConfigured = Boolean(
  (envStr('CSC_LINK') || envStr('CSC_NAME')) &&
    envStr('APPLE_ID') &&
    envStr('APPLE_APP_SPECIFIC_PASSWORD') &&
    envStr('APPLE_TEAM_ID')
);

// --- Update feed ---------------------------------------------------------
//
// Declaring a publish provider is what makes electron-builder EMIT the update
// metadata (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`) next to the
// installers. Without it those files are never written and an updater has
// nothing to read, however it is implemented.
//
// Declaring the provider does NOT publish anything by itself: electron-builder
// only uploads when invoked with `--publish always|onTag`, which happens solely
// in `.github/workflows/release.yml`. A local `npm run package:win` writes the
// yml alongside the exe and uploads nothing.
//
// Owner/repo come from `admin/brand/branding.json` (with a fork's
// `branding.local.json` laid over it, as electron.vite.config.ts does) so this
// cannot drift from the URL the in-app update check already uses
// (`DEFAULT_UPDATE_MANIFEST_URL`).
const branding = (() => {
  const readJson = (file) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(file);
    } catch {
      return {};
    }
  };
  return {
    ...readJson('../../admin/brand/branding.json'),
    ...readJson('../../admin/brand/branding.local.json'),
  };
})();

module.exports = {
  appId,
  productName,
  publish: [
    {
      provider: 'github',
      owner: branding.githubOrg || 'psrankin',
      repo: branding.githubRepo || 'bible',
      // Drafts are not offered to users. The release workflow publishes a draft
      // for review, and updates only start flowing once it is published by hand.
      releaseType: 'release',
    },
  ],
  nsis: {
    shortcutName: productName,
  },
  win: {
    // false when unconfigured -> build unsigned and skip rcedit (prior behaviour).
    signAndEditExecutable: windowsSigningConfigured,
  },
  mac: {
    // Hardened runtime is required for notarization; only meaningful when signed.
    hardenedRuntime: macSigningConfigured,
  },
  // Notarization hook. Self-guards: no-ops unless the platform is darwin and all
  // Apple creds are present, so it is safe to leave wired for unsigned builds and
  // on Windows/Linux. Path resolves relative to the desktop package dir.
  afterSign: 'scripts/notarize.cjs',
};
