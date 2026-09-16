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
 * `win.signAndEditExecutable`, or `mac.hardenedRuntime`.
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
 * macOS. `mac.hardenedRuntime` activates only when Apple signing + notarization
 * creds are all present: CSC_LINK/CSC_NAME (Developer ID cert) AND APPLE_ID AND
 * APPLE_APP_SPECIFIC_PASSWORD AND APPLE_TEAM_ID. Notarization needs no hook:
 * electron-builder submits and staples a signed app itself whenever those
 * APPLE_* vars are set. Otherwise an unsigned, un-notarized dmg still builds.
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

// --- Electron version ------------------------------------------------------
//
// The installers must run the Electron the app is developed and tested on, so
// no config pins one. electron-builder would read it from
// apps/desktop/node_modules/electron, but npm hoists `electron` to the root
// node_modules, and without it there electron-builder falls back to the
// `^44.x` range in package.json and refuses to build ("is a range, not a fixed
// version"). So it is resolved here the way Node resolves it, which finds the
// hoisted package. Upgrading Electron with npm needs no edit here.
const electronVersion = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(require.resolve('electron/package.json', { paths: [__dirname] })).version;
  } catch (cause) {
    throw new Error(`electron-builder.branding.cjs: the electron package is not installed (${cause.message}). Run \`npm install\` at the repository root first.`);
  }
})();

// --- Native modules after a mac build ----------------------------------------
//
// electron-builder rebuilds native modules for each arch it packages IN PLACE,
// in the repository's node_modules. The mac targets build arm64 and x64, so the
// last pass leaves its arch behind: on an Apple Silicon Mac the development
// tree then holds x64 binaries and `npm run dev` cannot load SQLite
// ("incompatible architecture") until `npm run rebuild-native:force`. After a
// mac build this puts back the host's Electron build of any binding left for
// another arch. Not on CI, which has no development tree to keep working.
const MACHO_CPU_TYPES = { 0x01000007: 'x64', 0x0100000c: 'arm64' }; // <mach/machine.h>
const NATIVE_BINDINGS = {
  'better-sqlite3-multiple-ciphers': 'build/Release/better_sqlite3.node',
  keytar: 'build/Release/keytar.node',
};

function restoreHostNativeModules() {
  if (process.platform !== 'darwin' || process.env.CI) return [];
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const otherArch = Object.entries(NATIVE_BINDINGS)
    .filter(([name, binding]) => {
      const header = Buffer.alloc(8);
      try {
        const dir = path.dirname(require.resolve(`${name}/package.json`, { paths: [__dirname] }));
        const fd = fs.openSync(path.join(dir, binding), 'r');
        try {
          fs.readSync(fd, header, 0, 8, 0);
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        return false; // not installed (keytar is optional) or not built
      }
      const arch = MACHO_CPU_TYPES[header.readUInt32LE(4)];
      return arch !== undefined && arch !== process.arch;
    })
    .map(([name]) => name);
  if (otherArch.length > 0) {
    console.log(`  • restoring the ${process.arch} Electron build of ${otherArch.join(', ')} for npm run dev`);
    execFileSync('npx', ['@electron/rebuild', '--only', otherArch.join(','), '-f'], { cwd: __dirname, stdio: 'inherit' });
  }
  return [];
}

module.exports = {
  appId,
  productName,
  electronVersion,
  afterAllArtifactBuild: restoreHostNativeModules,
  publish: [
    {
      provider: 'github',
      owner: branding.githubOrg || 'psrankin',
      repo: branding.githubRepo || 'bible',
      // Drafts are not offered to users: GitHub hides them from unauthenticated
      // API calls, so neither electron-updater nor the in-app check sees them.
      // The release workflow uploads into a draft for review, and updates only
      // start flowing once it is published by hand from the Releases page.
      releaseType: 'draft',
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
    // With no certificate supplied, sign ad hoc ('-') rather than letting
    // electron-builder pick whatever identity the keychain holds. Otherwise a
    // developer's Mac signs local builds with their personal "Apple
    // Development" cert, timestamping every file against Apple's server (slow,
    // and it fails offline), while CI builds the same config unsigned. Ad hoc
    // is also the least Apple Silicon needs: an arm64 app with no signature at
    // all is refused. Set CSC_NAME to sign with a keychain identity on purpose.
    ...(envStr('CSC_LINK') || envStr('CSC_NAME') ? {} : { identity: '-' }),
  },
  // The deb's required "homepage" (fpm refuses to build without one). Taken
  // from branding like every other public URL, rather than hard-coded in
  // package.json.
  extraMetadata: {
    homepage: branding.siteUrl || branding.downloadsUrl
      || `https://github.com/${branding.githubOrg || 'psrankin'}/${branding.githubRepo || 'bible'}`,
  },
  linux: {
    // On Linux the binary is otherwise named after the npm package,
    // `@bible/desktop` -> `@bibledesktop`, which electron-builder refuses for
    // the AppImage ("executableName contains characters that cannot be safely
    // used in file paths"), so the Linux release build failed.
    // Linux only: on Windows the .exe keeps productName, which
    // build-installer.nsh depends on. Child configs' `linux:` blocks are
    // deep-merged with this one, so their targets are unaffected.
    executableName: linuxName(),
  },
  deb: {
    // Otherwise both come from the npm name, and the deb was written to
    // dist/@bible/desktop_<version>_amd64.deb: a subdirectory the release
    // workflow's `dist/*.deb` never matches.
    packageName: linuxName(),
    artifactName: `${linuxName()}_\${version}_\${arch}.\${ext}`,
  },
};

/**
 * productName as a Linux file and package name ("keep-thy-heart-bible-reader"),
 * so a neutral BIBLE_PRODUCT_NAME build renames the binary and the deb too.
 * A function declaration, so the object above can call it.
 */
function linuxName() {
  return productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bible';
}
