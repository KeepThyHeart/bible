import { IpcMain, dialog, app } from 'electron';
import { basename, join } from 'path';
import { existsSync, statSync } from 'fs';
import log from 'electron-log';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { getBundledMainDbPath, getUserDataPath, getUserModulesPath, resolveMainDbPath } from '../utils/appPaths';
import { SqliteProvider } from '../providers/SqliteProvider';
import { initializeMainDatabase } from '../utils/initMainDatabase';
import {
  ModuleController,
  ModuleCatalogController,
  ModuleMetadataRepository,
  DownloadQueueRepository,
  ModuleFilter,
  compareModuleVersions
} from '@bible/core';
import type { StarterPack, OfferedStarterPack, CatalogModule } from '@bible/core';
import { DownloadService } from '../services/DownloadService';
import { validateString, validatePositiveInt } from '../utils/validation';
import { InstallationService } from '../services/InstallationService';
import { KeywordIndexService, type KeywordIndexStatusDto } from '../services/KeywordIndexService';
import { ModuleCatalogService, type VouchedKeyApprovalRequest } from '../services/ModuleCatalogService';
import { FileApprovedCatalogKeyStore } from '../services/ApprovedCatalogKeys';
import { getOfficialPublicKeys, OFFICIAL_CATALOG_URL_PREFIXES } from '../services/trustedCatalogKeys';
import { blessPath, isPathBlessed } from './blessedPaths';
import { t } from '../services/MainI18n';
import {
  installModulePack,
  inspectModulePack,
  isModulePackPath,
  ModulePackError,
  MODULE_PACK_EXTENSIONS,
  type ModulePackInstallSummary,
  type ModulePackOutcome,
  type ModulePackFailure,
  type ModulePackUpToDateEntry,
  type SkippedPackEntry,
  type ModulePackTrustOptions
} from '../services/ModulePackService';

/**
 * What to do when the module being installed is already installed.
 *
 * `'fail-on-conflict'` is the original `allowOverwrite: false` behaviour and
 * is what the single-file "Install from File" dialog uses, so the user is
 * told about the clash rather than having it resolved silently behind them.
 *
 * `'replace-if-newer'` is the default for PACK imports. Re-importing a pack
 * is a routine act - a refreshed commentary set, the same starter pack after
 * a reinstall - and the overwhelmingly common intent is "bring me up to date,
 * leave alone what already is". Crucially it only replaces on a *provable*
 * upgrade: `compareModuleVersions` returns `incomparable` for version strings
 * it cannot order (dates, edition years, publisher-invented schemes), and
 * that is treated as "do not touch", never as an upgrade.
 *
 * `'replace-always'` is the escape hatch for the case the version numbers
 * cannot express - a corrupted install, a republished module that kept its
 * version string. It must stay a deliberate user choice.
 */
export type ModuleInstallPolicy = 'fail-on-conflict' | 'replace-if-newer' | 'replace-always';

/**
 * Accept the legacy boolean `allowOverwrite` alongside the policy string.
 *
 * The renderer and the preload have shipped `boolean` on these channels, and
 * an older window can still be open against a reloaded main process, so the
 * boolean has to keep working: `true` meant "overwrite unconditionally" and
 * `false` meant "refuse and tell me". Mapping them to the equivalent policies
 * keeps that contract exactly.
 */
function normalizeInstallPolicy(
  value: ModuleInstallPolicy | boolean | undefined,
  fallback: ModuleInstallPolicy
): ModuleInstallPolicy {
  if (value === undefined) return fallback;
  if (value === true) return 'replace-always';
  if (value === false) return 'fail-on-conflict';
  if (value === 'fail-on-conflict' || value === 'replace-if-newer' || value === 'replace-always') {
    return value;
  }
  return fallback;
}

/**
 * Result of `module:install-from-file`. The dialog now supports selecting
 * multiple plain module files, or a single pack archive - so the single-file
 * result shape from before multi-select existed is preserved verbatim
 * (`kind: 'single'`) for the still-common case of picking exactly one
 * `.db`/`.db.gz`, and every other case (2+ files, or one pack archive)
 * returns a `'batch'` summary. `null` means "nothing to report": the user
 * cancelled the picker, OR every picked pack turned out unsigned/untrusted
 * and the user declined the native "install anyway?" prompt for all of them
 * (see `resolvePackFileTrust`) - both read the same to the person who asked
 * for this, so both get the same no-feedback-needed result.
 */
export type ModuleInstallDialogResult =
  | { kind: 'single'; moduleId?: number; moduleName?: string; overwritten?: boolean }
  | { kind: 'batch'; summary: ModulePackInstallSummary }
  | null;

// Singleton instances
let moduleController: ModuleController | null = null;
let catalogController: ModuleCatalogController | null = null;
let mainDb: SqliteProvider | null = null;
let installationService: InstallationService | null = null;
// F8 (task 0027 revision 2): keyword-index status/rebuild/delete. Held
// separately from `installationService`, mirroring `catalogService` below -
// the IPC handlers for it are module-scoped queries with no controller-level
// state, so they talk to the service directly.
let keywordIndexService: KeywordIndexService | null = null;
// Held separately from `catalogController`: the starter-pack queries are
// catalog-document reads with no controller-level state, so they talk to the
// service directly rather than widening the controller's surface.
let catalogService: ModuleCatalogService | null = null;

/**
 * Ask whether to trust a new official-catalog signing key that a key the app
 * already trusts has vouched for. A native main-process dialog on purpose: the
 * renderer cannot answer it on the user's behalf.
 */
async function confirmVouchedCatalogKey(request: VouchedKeyApprovalRequest): Promise<boolean> {
  const chain = request.chain
    .map((link) => `${link.vouchingKey}\n  vouched for ${link.newKey}\n  on ${link.issued}`)
    .join('\n');
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Decline', 'Trust new key'],
    defaultId: 0,
    cancelId: 0,
    title: 'New signing key for the official catalog',
    message: 'The official module catalog is signed with a key this app does not know yet.',
    detail:
      `New key:\n${request.newKey}\n\n` +
      `A key this app already trusts vouched for it:\n${chain}\n\n` +
      'This is expected when the publisher replaces its signing key. Trust it only if ' +
      'you expected that - for example, because it was announced on the project ' +
      'website. If you decline, the official catalog will not refresh until you ' +
      'update the app.',
    noLink: true,
  });
  return response === 1;
}

/**
 * Initialize module manager services
 */
function initializeModuleManager(): void {
  if (moduleController && catalogController) {
    return; // Already initialized
  }

  try {
    const mainDbPath = resolveMainDbPath();
    const modulesPath = getUserModulesPath();
    const tempDownloadPath = join(app.getPath('userData'), 'temp', 'downloads');

    log.info('[ModuleManager] Initializing with paths:', {
      mainDb: mainDbPath,
      modules: modulesPath,
      temp: tempDownloadPath
    });

    // Initialize and open main database
    mainDb = initializeMainDatabase(mainDbPath, getBundledMainDbPath());

    // Create services
    const downloadService = new DownloadService();
    keywordIndexService = new KeywordIndexService(mainDb);
    installationService = new InstallationService(mainDb, modulesPath, keywordIndexService);
    catalogService = new ModuleCatalogService(mainDb, undefined, {
      approveVouchedKey: confirmVouchedCatalogKey,
      approvedKeys: new FileApprovedCatalogKeyStore(),
    });

    // Create controllers
    const moduleMetadataRepo = new ModuleMetadataRepository(mainDb);
    const downloadQueueRepo = new DownloadQueueRepository(mainDb);
    moduleController = new ModuleController(
      moduleMetadataRepo,
      downloadQueueRepo,
      downloadService,
      installationService,
      catalogService,
      tempDownloadPath
    );

    catalogController = new ModuleCatalogController(mainDb, catalogService);

    log.info('[ModuleManager] Initialized successfully');
  } catch (error) {
    log.error('[ModuleManager] Initialization failed:', error);
    throw error;
  }
}

/**
 * Require moduleController to be initialized, or throw an IpcKnownError.
 */
function requireModuleController(): ModuleController {
  if (!moduleController) {
    throw new IpcKnownError('unavailable', 'Module manager not initialized');
  }
  return moduleController;
}

/**
 * Require catalogController to be initialized, or throw an IpcKnownError.
 */
function requireCatalogController(): ModuleCatalogController {
  if (!catalogController) {
    throw new IpcKnownError('unavailable', 'Module manager not initialized');
  }
  return catalogController;
}

/**
 * Require the catalog service to be initialized, or throw an IpcKnownError.
 */
function requireCatalogService(): ModuleCatalogService {
  if (!catalogService) {
    throw new IpcKnownError('unavailable', 'Module manager not initialized');
  }
  return catalogService;
}

/**
 * Require the keyword-index service to be initialized, or throw an IpcKnownError.
 */
/**
 * Startup catch-up for keyword indexes: build the index of every installed
 * module that lacks one (see `KeywordIndexService.buildMissingIndexes`).
 * Fire-and-forget; failures are logged and recorded, never thrown.
 */
export function buildMissingKeywordIndexesInBackground(): void {
  void (async () => {
    try {
      initializeModuleManager();
      const built = await requireKeywordIndexService().buildMissingIndexes();
      if (built > 0) log.info(`[ModuleManager] Built ${built} missing keyword index(es)`);
    } catch (error) {
      log.error('[ModuleManager] Building missing keyword indexes failed:', error);
    }
  })();
}

function requireKeywordIndexService(): KeywordIndexService {
  if (!keywordIndexService) {
    throw new IpcKnownError('unavailable', 'Module manager not initialized');
  }
  return keywordIndexService;
}

/**
 * Install a module from a file path.
 * Shared logic for both file dialog and drag-and-drop installation.
 * @param filePath - Path to the module file (.db or .db.gz)
 * @param allowOverwrite - If true, overwrites existing module with same abbreviation
 */
async function installModuleFromPath(
  filePath: string,
  policy: ModuleInstallPolicy | boolean = 'replace-always'
): Promise<{
  moduleId?: number;
  moduleName?: string;
  overwritten?: boolean;
  upToDateReason?: string;
}> {
  const effectivePolicy = normalizeInstallPolicy(policy, 'replace-always');
  log.info(`[ModuleManager] Installing module from path: ${filePath} (policy=${effectivePolicy})`);

  const svc = installationService!;
  const ctrl = requireModuleController();

  // Extract module info from the file
  const moduleInfo = await svc.extractModuleInfo(filePath);
  log.info('[ModuleManager] Extracted module info:', moduleInfo);

  // Is this module already installed?
  //
  // Identity is `module_uuid` when both sides have one - it is stable across
  // renames and cannot collide between publishers. Abbreviation is the
  // FALLBACK, used only for pre-2.0 modules that carry no UUID, and it is a
  // weak key: two unrelated publishers can both ship "KJV". Matching on the
  // UUID first is what stops an unrelated module with a colliding
  // abbreviation from being treated as an earlier version of this one.
  const existingModules = ctrl.getInstalledModules();
  const incomingUuid = moduleInfo.moduleUuid;
  const alreadyInstalled = (incomingUuid
    ? existingModules.find(m => m.moduleUuid === incomingUuid)
    : undefined)
    ?? existingModules.find(
      m => !m.moduleUuid && !!moduleInfo.abbreviation && m.abbreviation === moduleInfo.abbreviation
    )
    // Last resort: a UUID-less incoming module against whatever shares its
    // abbreviation. Keeps legacy re-imports working as they always have.
    ?? (incomingUuid ? undefined : existingModules.find(m => m.abbreviation === moduleInfo.abbreviation));

  let overwritten = false;

  if (alreadyInstalled) {
    const label = `"${moduleInfo.moduleName}" (${moduleInfo.abbreviation ?? 'no abbreviation'})`;

    if (effectivePolicy === 'fail-on-conflict') {
      throw new IpcKnownError('conflict', `Module ${label} is already installed`);
    }

    if (effectivePolicy === 'replace-if-newer') {
      const comparison = compareModuleVersions(moduleInfo.version, alreadyInstalled.version);
      if (comparison !== 'newer') {
        // Spell out WHY in the reason. "Skipped" alone is the kind of summary
        // line that sends a publisher hunting for a bug in the pack; naming
        // the two versions makes it self-evidently correct behaviour.
        const installedLabel = alreadyInstalled.version ?? 'an unversioned copy';
        const incomingLabel = moduleInfo.version ?? 'an unversioned copy';
        const reason = comparison === 'same'
          ? `Already at version ${installedLabel}.`
          : comparison === 'older'
            ? `Installed version ${installedLabel} is newer than ${incomingLabel}.`
            : `Cannot tell whether ${incomingLabel} supersedes the installed ${installedLabel}; left unchanged.`;
        log.info(`[ModuleManager] Leaving ${label} alone: ${reason}`);
        return { moduleName: moduleInfo.moduleName, upToDateReason: reason };
      }
      log.info(
        `[ModuleManager] Upgrading ${label}: ${alreadyInstalled.version ?? '(none)'} -> ${moduleInfo.version ?? '(none)'}`
      );
    }

    // Uninstall the existing module first to allow overwrite/update
    log.info(`[ModuleManager] Overwriting existing module: ${alreadyInstalled.abbreviation} (id=${alreadyInstalled.moduleId})`);
    await svc.uninstallModule(alreadyInstalled.moduleId!, false);
    overwritten = true;
  }

  // Install the module
  log.info('[ModuleManager] Installing module from file...');
  const installResult = await svc.installModule(filePath, moduleInfo);
  log.info('[ModuleManager] Install result:', installResult);

  if (!installResult.success) {
    throw new IpcKnownError('unavailable', installResult.error ?? 'Installation failed');
  }

  return { moduleId: installResult.moduleId, moduleName: installResult.moduleName, overwritten };
}

/**
 * Keys trusted for a pack's signature (`.zip` or `.biblepack` alike - see
 * `installModulePackFromPath`'s doc comment): the pinned official keys, plus
 * any the user separately approved for the official scope through a vouch
 * (`ApprovedCatalogKeys`) - the same trust set `ModuleCatalogService` applies
 * to the official catalog itself. A pack has no URL of its own to record a
 * trust-on-first-use key against, so unlike a third-party catalog there is no
 * weaker fallback: a pack is either backed by this trust set or it is not
 * verified, full stop.
 *
 * Reads the on-disk approvals fresh each call (a new store, not the one held
 * by `catalogService`) rather than threading it through - it is the same file,
 * and a pack install is infrequent enough that this costs nothing.
 */
function getPackTrustedKeys(): string[] {
  const scope = OFFICIAL_CATALOG_URL_PREFIXES[0];
  const approved = scope ? new FileApprovedCatalogKeyStore().list(scope) : [];
  return [...getOfficialPublicKeys(), ...approved];
}

/**
 * Re-throw a `ModulePackError` classified for the trust gate as an
 * `IpcKnownError` carrying the matching `IpcErrorCode`, so the renderer can
 * branch on it instead of parsing a message string. Every other
 * `ModulePackError` (bad archive, ceilings) falls through unchanged and is
 * classified `internal` by `ipcHandler`, as before this feature existed.
 */
function rethrowClassified(error: unknown): never {
  if (
    error instanceof ModulePackError &&
    (error.code === 'pack_signature_invalid' ||
      error.code === 'pack_unverified' ||
      error.code === 'pack_tampered' ||
      error.code === 'not_found')
  ) {
    throw new IpcKnownError(error.code, error.message);
  }
  throw error;
}

/** What to do with one picked pack archive, decided by `resolvePackFileTrust`. */
type PackFileTrustDecision =
  | { outcome: 'proceed'; acceptUnverified: boolean }
  /** The user was asked and declined - a clean no-op, never a failure. */
  | { outcome: 'declined' }
  /** Signature present but broken, or the manifest is malformed - no install, no override. */
  | { outcome: 'invalid'; message: string };

/**
 * Inspect a pack archive picked through the "Install from File" dialog and,
 * when it needs a decision the renderer cannot make on the app's behalf,
 * raise a NATIVE dialog for it right here in main.
 *
 * This flow (pick + install in one round trip via `dialog.showOpenDialog`)
 * has no later point at which a renderer-side confirmation could run, so the
 * confirmation has to happen in main - which is also a STRONGER guarantee
 * than a renderer confirm would be: a compromised renderer cannot suppress,
 * skip, or fake the user's answer to a dialog it never gets to render. The
 * decision here still changes nothing about verification itself -
 * `installModulePackFromPath` re-verifies the signature and the manifest from
 * scratch regardless of what is returned.
 *
 * Mirrors `confirmEnable` (`networkHandlers.ts`) and `confirmVouchedCatalogKey`
 * above: an unparented `dialog.showMessageBox`, Cancel as both the default and
 * the Escape/close outcome (`cancelId`), so a dismissed dialog can never be
 * mistaken for consent.
 */
async function resolvePackFileTrust(filePath: string): Promise<PackFileTrustDecision> {
  const inspection = await inspectModulePack(filePath, getPackTrustedKeys());
  const fileName = basename(filePath);

  if (inspection.status === 'invalid') {
    dialog.showErrorBox(
      "This pack can't be installed",
      `"${fileName}" has been altered or its signature is broken, so it can't be installed.\n\n${inspection.message}`
    );
    return { outcome: 'invalid', message: inspection.message };
  }

  if (inspection.status === 'unsigned' || inspection.status === 'untrusted') {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Install anyway'],
      defaultId: 0,
      cancelId: 0,
      title: "This pack isn't verified",
      message: `"${fileName}" isn't signed by Keep Thy Heart.`,
      detail:
        `${inspection.message}\n\n` +
        'Only install it if you trust where it came from. Each module is still checked ' +
        'before it is installed.',
      noLink: true,
    });
    if (response !== 1) {
      return { outcome: 'declined' };
    }
    return { outcome: 'proceed', acceptUnverified: true };
  }

  // 'verified'
  return { outcome: 'proceed', acceptUnverified: false };
}

/**
 * Root directory pack archives are extracted into. Deliberately placed under
 * the same user-data root as `getUserModulesPath()` (rather than the OS temp
 * directory) so the per-module install's final `fs.renameSync` move - from
 * the extracted temp copy to its destination in the modules directory - is a
 * same-volume rename rather than a cross-device copy.
 */
function getModulePackExtractionRoot(): string {
  return join(getUserDataPath(), 'temp', 'module-packs');
}

/**
 * Install every `.db`/`.db.gz` file bundled in a pack archive.
 *
 * Shared by the "Upload Module" dialog (when a single pack file is chosen)
 * and pack drag-and-drop. Each contained module is installed independently
 * through `installModuleFromPath` - the same conformance-gated path as a
 * single-file install - so one module failing (a bad conformance check, a
 * duplicate abbreviation) does not stop the others.
 *
 * The policy defaults to `'replace-if-newer'` for packs: re-importing the
 * same pack (e.g. a refreshed commentary set, or a starter pack after a
 * reinstall) is expected to bring stale modules up to date while leaving
 * current ones untouched. Modules left alone are reported in the summary's
 * `upToDate` bucket, NOT as failures.
 *
 * Every pack archive - a `.zip` exactly like a `.biblepack` - is subject to
 * the signature/manifest trust gate: `acceptUnverified` must be explicitly
 * `true` to install one that is unsigned or signed by an untrusted key, and a
 * pack whose signature is invalid, or whose file bytes do not match a
 * verified manifest, is refused with no override at all. The archive's
 * EXTENSION decides nothing here - a `.zip` with no `pack.json` verifies as
 * plain `unsigned` and needs the same confirmation a renamed `.biblepack`
 * would, and a `.zip` that does carry `pack.json`(`.sig`) is checked exactly
 * like a `.biblepack`. Deciding trust from a filename extension - something
 * the archive itself controls - would let a hostile file simply rename its
 * way past the gate. This check runs HERE, in main, every time - a
 * renderer's earlier `module:inspect-pack` call, or its own decision to ask
 * the user, is only ever a preview; it is never trusted in place of
 * re-verifying now.
 */
async function installModulePackFromPath(
  archivePath: string,
  policy: ModuleInstallPolicy | boolean = 'replace-if-newer',
  acceptUnverified = false
): Promise<ModulePackInstallSummary> {
  const effectivePolicy = normalizeInstallPolicy(policy, 'replace-if-newer');
  const trust: ModulePackTrustOptions = { trustedKeys: getPackTrustedKeys(), acceptUnverified };
  log.info(
    `[ModuleManager] Installing module pack from: ${archivePath} (policy=${effectivePolicy}, acceptUnverified=${acceptUnverified})`
  );
  const summary = await installModulePack(
    archivePath,
    getModulePackExtractionRoot(),
    (filePath) => installModuleFromPath(filePath, effectivePolicy),
    undefined,
    trust
  );
  log.info(
    `[ModuleManager] Pack install complete: ${summary.installed.length} installed, ` +
    `${summary.failed.length} failed, ${summary.upToDate?.length ?? 0} already current, ` +
    `${summary.skipped.length} skipped` +
    (summary.packVerification ? `, signature=${summary.packVerification.status}` : '')
  );
  return summary;
}

/**
 * Register module management IPC handlers
 */
export function registerModuleHandlers(_ipc: IpcMain): void {
  log.info('[IPC] Registering module handlers...');

  // Initialize module manager
  ipcHandler<[], void>(
    'module:init',
    () => {
      initializeModuleManager();
    }
  );

  // Get available modules
  ipcHandler<[ModuleFilter | undefined], unknown[]>(
    'module:get-available',
    (filter?) => {
      initializeModuleManager();
      const ctrl = requireModuleController();
      return filter
        ? ctrl.searchModules(filter)
        : ctrl.getAvailableModules();
    }
  );

  // Get installed modules
  ipcHandler<[], unknown[]>(
    'module:get-installed',
    () => {
      initializeModuleManager();
      const ctrl = requireModuleController();
      const modules = ctrl.getInstalledModules();
      return modules.map(m => m.toJSON());
    }
  );

  // Starter packs recommended for a UI locale. Returns [] when the language
  // has no pack, or when no catalog is currently the verified official one -
  // both normal outcomes, never an error. Every entry carries `source`
  // (which verified-official catalog it came from) so a subsequent
  // `module:get-starter-pack-modules` / `module:install` call can be pinned
  // to that same catalog - see `ModuleCatalogService.getAvailableStarterPacks`.
  ipcHandler<[string], OfferedStarterPack[]>(
    'module:get-starter-packs',
    (languageCode) => {
      validateString(languageCode, 'languageCode', 35);
      initializeModuleManager();
      return requireCatalogService().getStarterPacksForLanguage(languageCode);
    }
  );

  // Resolve a starter pack's module ids to the catalog entries they name, so
  // the first-run screen can show what would be installed (with licences and
  // sizes) before the user commits to anything. `catalogId` (a pack's own
  // `source.catalogId`) scopes resolution to that one catalog - see the
  // service method's doc comment for why cross-catalog resolution is unsafe.
  ipcHandler<[string, number], { pack?: StarterPack; modules: CatalogModule[] }>(
    'module:get-starter-pack-modules',
    (packId, catalogId) => {
      validateString(packId, 'packId', 100);
      validatePositiveInt(catalogId, 'catalogId');
      initializeModuleManager();
      return requireCatalogService().getStarterPackModules(packId, catalogId);
    }
  );

  // Search modules
  ipcHandler<[ModuleFilter], unknown[]>(
    'module:search',
    (filter) => {
      initializeModuleManager();
      const ctrl = requireModuleController();
      return ctrl.searchModules(filter);
    }
  );

  // Install module. `catalogId`, when given, restricts resolution to that one
  // catalog (see `IModuleCatalogService.getModuleInfo`) - first-run starter-
  // pack installs always pass their pack's `source.catalogId` so a
  // third-party catalog can never "shadow" an official module id. The Module
  // Manager's own per-module install omits it, unchanged.
  ipcHandler<[string, number | undefined], { moduleId?: number; moduleName?: string }>(
    'module:install',
    async (moduleId, catalogId) => {
      validateString(moduleId, 'moduleId', 200);
      if (catalogId !== undefined) validatePositiveInt(catalogId, 'catalogId');
      initializeModuleManager();
      const ctrl = requireModuleController();
      log.info(`[IPC] Installing module: ${moduleId}${catalogId !== undefined ? ` (catalog ${catalogId})` : ''}`);
      const result = await ctrl.installModule(moduleId, catalogId);
      log.info('[IPC] Install result:', result);
      if (!result.success) {
        throw new IpcKnownError('unavailable', result.error ?? 'Installation failed');
      }
      return { moduleId: result.moduleId, moduleName: result.moduleName };
    }
  );

  // Install module(s) from file (opens file dialog). Accepts multiple plain
  // module files at once, or a single pack archive (.zip/.biblepack)
  // bundling many modules - see ModulePackService.ts. See
  // `ModuleInstallDialogResult` above for the return shape.
  ipcHandler<[], ModuleInstallDialogResult>(
    'module:install-from-file',
    async () => {
      initializeModuleManager();
      log.info('[IPC] Opening file dialog for module installation');

      // Show file picker
      const result = await dialog.showOpenDialog({
        title: t('main.dialog.selectModuleFiles'),
        filters: [
          {
            name: t('main.filter.moduleFiles'),
            extensions: ['db', 'gz', ...MODULE_PACK_EXTENSIONS.map(ext => ext.slice(1))]
          },
          { name: t('main.filter.allFiles'), extensions: ['*'] }
        ],
        properties: ['openFile', 'multiSelections']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null; // User cancelled - not an error
      }

      // The user explicitly picked these paths via a native dialog -
      // authorize each so a subsequent `module:install-from-path` /
      // `module:install-pack-from-path` call for the same file is allowed.
      for (const p of result.filePaths) {
        blessPath(p);
      }

      // The common case - exactly one plain module file - keeps the original
      // single-result shape and single-install throw-on-failure behavior.
      if (result.filePaths.length === 1 && !isModulePackPath(result.filePaths[0])) {
        const single = await installModuleFromPath(result.filePaths[0], 'fail-on-conflict');
        return { kind: 'single', ...single };
      }

      // Otherwise: multiple files were selected, and/or one of them is a pack
      // archive. Every path is installed independently and its outcome
      // recorded - one bad file does not stop the rest.
      const installed: ModulePackOutcome[] = [];
      const failed: ModulePackFailure[] = [];
      const skipped: SkippedPackEntry[] = [];
      const upToDate: ModulePackUpToDateEntry[] = [];
      let found = 0;

      for (const filePath of result.filePaths) {
        if (isModulePackPath(filePath)) {
          try {
            // This whole flow is one main-process round trip with no later
            // chance for a renderer confirmation, so an unsigned/untrusted
            // pack is confirmed HERE with a native dialog rather than
            // silently refused - see `resolvePackFileTrust`'s doc comment.
            const decision = await resolvePackFileTrust(filePath);
            if (decision.outcome === 'declined') {
              continue; // the user said no - a clean no-op, not a failure
            }
            if (decision.outcome === 'invalid') {
              failed.push({ entryPath: filePath, reason: decision.message });
              continue;
            }
            const packSummary = await installModulePackFromPath(
              filePath,
              'replace-if-newer',
              decision.acceptUnverified
            );
            found += packSummary.found;
            installed.push(...packSummary.installed);
            failed.push(...packSummary.failed);
            skipped.push(...packSummary.skipped);
            upToDate.push(...(packSummary.upToDate ?? []));
          } catch (error) {
            failed.push({ entryPath: filePath, reason: (error as Error).message });
          }
          continue;
        }
        found += 1;
        try {
          // Plain files in a multi-selection use the same policy as a pack:
          // the user picked a set to bring in, so an already-current member
          // should be reported as current, not abort the whole selection with
          // a conflict the way a deliberate single-file install does.
          const single = await installModuleFromPath(filePath, 'replace-if-newer');
          if (single.upToDateReason) {
            upToDate.push({ entryPath: filePath, moduleName: single.moduleName, reason: single.upToDateReason });
            continue;
          }
          installed.push({ entryPath: filePath, moduleName: single.moduleName, overwritten: single.overwritten });
        } catch (error) {
          failed.push({ entryPath: filePath, reason: (error as Error).message });
        }
      }

      // Every picked pack was declined and nothing else was selected: from
      // the user's point of view this is indistinguishable from cancelling
      // the picker, so it gets the same `null` ("no feedback needed")
      // result rather than a batch panel reporting all zeroes.
      if (found === 0 && installed.length === 0 && failed.length === 0 && skipped.length === 0 && upToDate.length === 0) {
        return null;
      }

      return { kind: 'batch', summary: { found, installed, failed, skipped, upToDate } };
    }
  );

  // Install module from a given file path.
  //
  // Accepting an arbitrary absolute path from the renderer here would
  // let a compromised renderer make the app read any file and surface it as an
  // installed module. The path must therefore have been chosen by the user
  // through a main-process file dialog (blessed-path registry), or authorized
  // via `module:bless-dropped-path` for a genuine OS drag-and-drop. Fabricated
  // paths are refused.
  ipcHandler<
    [string, ModuleInstallPolicy | boolean | undefined],
    { moduleId?: number; moduleName?: string; overwritten?: boolean; upToDateReason?: string }
  >(
    'module:install-from-path',
    async (filePath, policy) => {
      validateString(filePath, 'filePath', 1000);
      if (!isPathBlessed(filePath)) {
        throw new IpcKnownError(
          'unauthorized',
          'This module path was not authorized. Choose the file through "Install from File".'
        );
      }
      initializeModuleManager();
      // Unspecified keeps the historical drag-and-drop default (unconditional
      // overwrite) so existing renderer call sites are unaffected.
      return await installModuleFromPath(filePath, normalizeInstallPolicy(policy, 'replace-always'));
    }
  );

  // Install a module pack archive from a given (blessed) file path. Same
  // path-trust model as `module:install-from-path`: the path must have been
  // chosen through a main-process dialog, or authorized via
  // `module:bless-dropped-path` for a genuine OS drag-and-drop.
  //
  // `options.acceptUnverified` is the renderer's record of the user having
  // confirmed an "install anyway" prompt for an unsigned/untrusted
  // `.biblepack` (see `module:inspect-pack`) - it is NOT trusted on its own:
  // `installModulePackFromPath` re-verifies the signature here regardless of
  // what the renderer believes it already knows, and tampering (an invalid
  // signature, or a verified manifest that does not match the archive's
  // actual bytes) is refused unconditionally, with no flag that overrides it.
  ipcHandler<
    [string, ModuleInstallPolicy | boolean | undefined, { acceptUnverified?: boolean } | undefined],
    ModulePackInstallSummary
  >(
    'module:install-pack-from-path',
    async (archivePath, policy, options) => {
      validateString(archivePath, 'archivePath', 1000);
      if (!isPathBlessed(archivePath)) {
        throw new IpcKnownError(
          'unauthorized',
          'This file path was not authorized. Choose the file through "Install from File" or drop it onto the window.'
        );
      }
      initializeModuleManager();
      try {
        return await installModulePackFromPath(
          archivePath,
          normalizeInstallPolicy(policy, 'replace-if-newer'),
          options?.acceptUnverified ?? false
        );
      } catch (error) {
        rethrowClassified(error);
      }
    }
  );

  // Inspect a pack archive's signature/manifest WITHOUT installing anything -
  // lets the renderer show "Verified: signed by Keep Thy Heart" or an
  // "install anyway?" confirmation before calling
  // `module:install-pack-from-path`. Purely a preview: the install call above
  // always re-verifies independently, so a stale or fabricated result here
  // can never substitute for that check. Applies equally to `.zip` and
  // `.biblepack` (see `installModulePackFromPath`'s doc comment for why the
  // extension decides nothing); a single module file (`.db`/`.db.gz`, not an
  // archive at all) has no manifest to inspect and always reports `unsigned`
  // with no manifest summary.
  ipcHandler<
    [string],
    { status: 'verified' | 'unsigned' | 'untrusted' | 'invalid'; manifest?: { name: string; version: string; languages: string[]; moduleCount: number; totalBytes: number }; signer?: string; message: string }
  >(
    'module:inspect-pack',
    async (archivePath) => {
      validateString(archivePath, 'archivePath', 1000);
      if (!isPathBlessed(archivePath)) {
        throw new IpcKnownError(
          'unauthorized',
          'This file path was not authorized. Choose the file through "Install from File" or drop it onto the window.'
        );
      }
      if (!isModulePackPath(archivePath)) {
        return { status: 'unsigned', message: 'Not a pack archive — nothing to verify.' };
      }
      initializeModuleManager();
      try {
        const result = await inspectModulePack(archivePath, getPackTrustedKeys());
        return {
          status: result.status,
          manifest: result.manifest
            ? {
                name: result.manifest.name,
                version: result.manifest.version,
                languages: result.manifest.languages,
                moduleCount: result.moduleCount ?? result.manifest.modules.length,
                totalBytes: result.totalBytes ?? 0,
              }
            : undefined,
          signer: result.publicKey,
          message: result.message,
        };
      } catch (error) {
        rethrowClassified(error);
      }
    }
  );

  // Authorize a path resolved from a genuine OS drag-and-drop via the
  // preload's `webUtils.getPathForFile()` bridge (B2). A `File` object can
  // only carry a real OS path when the browser attached one - via an actual
  // native file picker or an OS-level drag-and-drop the user performed - so a
  // path that reaches here reflects something the user's own action revealed
  // to the renderer, not one a compromised page fabricated: a synthetic
  // `new File([...])` blob resolves to an empty string from `webUtils`, and
  // the preload never forwards an empty path here. The file must also
  // actually exist on disk.
  ipcHandler<[string], boolean>(
    'module:bless-dropped-path',
    (filePath) => {
      validateString(filePath, 'filePath', 1000);
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        throw new IpcKnownError('not_found', 'That file could not be found.');
      }
      blessPath(filePath);
      return true;
    }
  );

  // Uninstall module
  ipcHandler<[number, boolean | undefined], boolean>(
    'module:uninstall',
    async (moduleId, removeUserData?) => {
      validatePositiveInt(moduleId, 'moduleId');
      initializeModuleManager();
      const ctrl = requireModuleController();
      log.info(`[IPC] Uninstalling module: ${moduleId}`);
      return await ctrl.uninstallModule(moduleId, removeUserData);
    }
  );

  // Update module
  ipcHandler<[number], { moduleId?: number; moduleName?: string }>(
    'module:update',
    async (moduleId) => {
      validatePositiveInt(moduleId, 'moduleId');
      initializeModuleManager();
      const ctrl = requireModuleController();
      log.info(`[IPC] Updating module: ${moduleId}`);
      const result = await ctrl.updateModule(moduleId);
      if (!result.success) {
        throw new IpcKnownError('unavailable', result.error ?? 'Update failed');
      }
      return { moduleId: result.moduleId, moduleName: result.moduleName };
    }
  );

  // Check for updates
  ipcHandler<[number], { hasUpdate: boolean; currentVersion?: string; availableVersion?: string }>(
    'module:check-for-updates',
    async (moduleId) => {
      validatePositiveInt(moduleId, 'moduleId');
      initializeModuleManager();
      const ctrl = requireModuleController();
      return await ctrl.checkForUpdate(moduleId);
    }
  );

  // Get module details
  ipcHandler<[number], unknown>(
    'module:get-details',
    (moduleId) => {
      validatePositiveInt(moduleId, 'moduleId');
      initializeModuleManager();
      const ctrl = requireModuleController();
      const module = ctrl.getModuleDetails(moduleId);
      if (!module) {
        throw new IpcKnownError('not_found', `Module not found: ${moduleId}`);
      }
      return module;
    }
  );

  // Keyword index (F8, task 0027 revision 2, design doc §5.3). Three
  // handlers over `KeywordIndexService`, keyed by the same numeric `moduleId`
  // every other module handler above uses - the renderer never needs a
  // module's `moduleUuid` for these. Search itself does not read any of this
  // yet (it always degrades through `KeywordIndexRegistry`, unaffected by
  // whatever this module reports); these exist so a "keyword index" section
  // of the module details UI can show status and offer Rebuild/Delete
  // actions without any further backend work.

  // Current status: unavailable / unbuilt / building / ready / stale / failed.
  ipcHandler<[number], KeywordIndexStatusDto>(
    'module:get-keyword-index-status',
    (moduleId) => {
      validatePositiveInt(moduleId, 'moduleId');
      initializeModuleManager();
      const status = requireKeywordIndexService().getStatusForModule(moduleId);
      if (!status) {
        throw new IpcKnownError('not_found', `Module not found: ${moduleId}`);
      }
      return status;
    }
  );

  // Trigger (and await) a rebuild. Same build path `installModule` triggers
  // automatically, callable on demand - the "Rebuild" action. Resolves with
  // the resulting status rather than throwing on a build failure: the
  // failure is already recorded in `keyword_index`, and the renderer reads it
  // back the same way `module:get-keyword-index-status` reports one.
  ipcHandler<[number], KeywordIndexStatusDto>(
    'module:rebuild-keyword-index',
    async (moduleId) => {
      validatePositiveInt(moduleId, 'moduleId');
      initializeModuleManager();
      const status = await requireKeywordIndexService().rebuildForModule(moduleId);
      if (!status) {
        throw new IpcKnownError('not_found', `Module not found: ${moduleId}`);
      }
      return status;
    }
  );

  // Delete this module's index (the on-disk `.kwi` and its `keyword_index`
  // row) without uninstalling the module itself - the "Delete index" action.
  ipcHandler<[number], KeywordIndexStatusDto>(
    'module:delete-keyword-index',
    async (moduleId) => {
      validatePositiveInt(moduleId, 'moduleId');
      initializeModuleManager();
      const status = await requireKeywordIndexService().deleteIndexForModule(moduleId);
      if (!status) {
        throw new IpcKnownError('not_found', `Module not found: ${moduleId}`);
      }
      return status;
    }
  );

  // Download management

  ipcHandler<[number], unknown>(
    'download:get-progress',
    (queueId) => {
      validatePositiveInt(queueId, 'queueId');
      initializeModuleManager();
      return requireModuleController().getDownloadProgress(queueId);
    }
  );

  ipcHandler<[], unknown[]>(
    'download:get-active',
    () => {
      initializeModuleManager();
      return requireModuleController().getActiveDownloads();
    }
  );

  ipcHandler<[number], void>(
    'download:pause',
    (queueId) => {
      validatePositiveInt(queueId, 'queueId');
      initializeModuleManager();
      requireModuleController().pauseDownload(queueId);
    }
  );

  ipcHandler<[number], void>(
    'download:resume',
    async (queueId) => {
      validatePositiveInt(queueId, 'queueId');
      initializeModuleManager();
      await requireModuleController().resumeDownload(queueId);
    }
  );

  ipcHandler<[number], void>(
    'download:cancel',
    (queueId) => {
      validatePositiveInt(queueId, 'queueId');
      initializeModuleManager();
      requireModuleController().cancelDownload(queueId);
    }
  );

  // Repository management

  ipcHandler<[], unknown[]>(
    'repository:get-all',
    () => {
      initializeModuleManager();
      return requireCatalogController().getRepositories();
    }
  );

  ipcHandler<[number], unknown>(
    'repository:refresh-catalog',
    async (repositoryId) => {
      validatePositiveInt(repositoryId, 'repositoryId');
      initializeModuleManager();
      log.info(`[IPC] Refreshing catalog for repository: ${repositoryId}`);
      return await requireCatalogController().refreshCatalog(repositoryId);
    }
  );

  ipcHandler<[], unknown[]>(
    'repository:refresh-all',
    async () => {
      initializeModuleManager();
      log.info('[IPC] Refreshing all catalogs');
      return await requireCatalogController().refreshAllCatalogs();
    }
  );

  ipcHandler<[number], unknown>(
    'repository:get-catalog',
    (repositoryId) => {
      validatePositiveInt(repositoryId, 'repositoryId');
      initializeModuleManager();
      return requireCatalogController().getCatalog(repositoryId);
    }
  );

  ipcHandler<[string, string, string, string | undefined], unknown>(
    'repository:add',
    async (name, url, type, abbreviation?) => {
      validateString(name, 'repository name', 200);
      validateString(url, 'repository url', 2000);
      validateString(type, 'repository type', 50);
      if (abbreviation !== undefined) { validateString(abbreviation, 'abbreviation', 30); }
      initializeModuleManager();
      log.info(`[IPC] Adding repository: ${name} (${url})`);
      return await requireCatalogController().addRepository(
        name,
        url,
        type as 'official' | 'crosswire' | 'third_party' | 'local',
        abbreviation
      );
    }
  );

  ipcHandler<[number], boolean>(
    'repository:remove',
    (repositoryId) => {
      validatePositiveInt(repositoryId, 'repositoryId');
      initializeModuleManager();
      log.info(`[IPC] Removing repository: ${repositoryId}`);
      return requireCatalogController().removeRepository(repositoryId);
    }
  );

  ipcHandler<[number, string], unknown>(
    'repository:update-url',
    (repositoryId, newUrl) => {
      validatePositiveInt(repositoryId, 'repositoryId');
      validateString(newUrl, 'url', 2000);
      initializeModuleManager();
      log.info(`[IPC] Updating repository ${repositoryId} URL to: ${newUrl}`);
      const ctrl = requireCatalogController();
      const repository = ctrl.getRepository(repositoryId);
      if (!repository) {
        throw new IpcKnownError('not_found', `Repository not found: ${repositoryId}`);
      }
      repository.url = newUrl;
      // Clear cached catalog since URL changed
      repository.catalogJson = undefined;
      repository.lastFetched = undefined;
      ctrl.updateRepository(repository);
      return repository;
    }
  );

  ipcHandler<[number, boolean], void>(
    'repository:set-enabled',
    (repositoryId, enabled) => {
      validatePositiveInt(repositoryId, 'repositoryId');
      initializeModuleManager();
      log.info(`[IPC] Setting repository ${repositoryId} enabled: ${enabled}`);
      requireCatalogController().setRepositoryEnabled(repositoryId, enabled);
    }
  );

  log.info('[IPC] Module handlers registered successfully');
}

/**
 * Close module manager resources
 */
export function closeModuleManager(): void {
  if (mainDb) {
    mainDb.close();
    mainDb = null;
  }
  moduleController = null;
  catalogController = null;
  catalogService = null;
  installationService = null;
  keywordIndexService = null;
  log.info('[ModuleManager] Closed');
}
