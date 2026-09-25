/**
 * Declarative-manifest reader for `contributes.commands` / `contributes.panelTypes`
 * (task 0024 round 3, P1.5).
 *
 * Owns the boundary between "what a manifest declares" and "what the
 * renderer bridges know about" - it reads `contributes` off each installed
 * extension's manifest and pushes placeholder registrations through the two
 * existing bridges (`RendererCommandBridge`, `RendererUiBridge`), which do
 * the actual placeholder/supersede bookkeeping. This class only decides
 * *which* extensions are eligible right now and re-runs that decision
 * whenever it might have changed.
 *
 * Constructed once in `main.ts`, after `extensionHost.loadAll()` and before
 * the startup activation event fires - so a lazily-activated extension's
 * commands and panels are already reachable the moment the user looks for
 * them, not just after the extension has run once.
 */

import { Extensions } from '@bible/core';

export interface DeclaredContributionsEntry {
  enabled: boolean;
  status: string;
  manifest: Extensions.ExtensionManifest;
}

/**
 * The declared-command slice of `RendererCommandBridge`'s public surface -
 * narrowed to exactly what this class calls, both so the dependency reads as
 * "what does DeclaredContributions need" rather than "the whole bridge
 * class", and so a lightweight fake (no `electron`/`ipcMain` mocking) is
 * enough to unit-test `syncDeclared`'s eligibility logic - see
 * `LazyActivation.test.ts`. `RendererCommandBridge` satisfies this
 * structurally; `main.ts` passes the real one.
 */
export interface DeclaredCommandBridge {
  registerDeclaredCommand(extensionId: string, decl: Extensions.ContributedCommand): void;
  unregisterDeclaredCommands(extensionId: string): void;
}

/** Same narrowing as `DeclaredCommandBridge`, for `RendererUiBridge`'s declared panel types. */
export interface DeclaredPanelTypeBridge {
  registerDeclaredPanelType(extensionId: string, def: Extensions.ExtensionPanelTypeDef): void;
  unregisterDeclaredPanelTypes(extensionId: string): void;
}

export interface DeclaredContributionsDeps {
  /** Every installed extension's id + entry (enabled, status, manifest). */
  listEntries: () => { id: string; entry: DeclaredContributionsEntry }[];
  commandBridge: DeclaredCommandBridge;
  uiBridge: DeclaredPanelTypeBridge;
  /** Appends one line to `extensionId`'s own lifecycle log. */
  log: (extensionId: string, level: 'info' | 'warn' | 'error', message: string) => void;
}

export class DeclaredContributions {
  private readonly deps: DeclaredContributionsDeps;
  /** One-shot guard so `warnOnUnfiredEvents` never logs the same extension twice per boot. */
  private warnedAtBoot = false;

  constructor(deps: DeclaredContributionsDeps) {
    this.deps = deps;
  }

  /**
   * Re-register (or drop) every declared contribution for one extension.
   * Idempotent - safe to call after any lifecycle transition
   * (activate-settle, deactivate, crash, install, uninstall, enable,
   * disable) without tracking what changed; it just recomputes from the
   * registry's current state every time.
   */
  syncDeclared(extensionId: string): void {
    const found = this.deps.listEntries().find((e) => e.id === extensionId);
    const eligible = found !== undefined && found.entry.enabled && found.entry.status !== 'auto-disabled';
    if (!found || !eligible) {
      this.deps.commandBridge.unregisterDeclaredCommands(extensionId);
      this.deps.uiBridge.unregisterDeclaredPanelTypes(extensionId);
      return;
    }
    const { manifest } = found.entry;
    for (const decl of manifest.contributes?.commands ?? []) {
      this.deps.commandBridge.registerDeclaredCommand(extensionId, decl);
    }
    for (const def of manifest.contributes?.panelTypes ?? []) {
      this.deps.uiBridge.registerDeclaredPanelType(extensionId, def);
    }
  }

  /** `syncDeclared` for every installed extension. Called at boot and once the renderer bridge is ready. */
  syncAll(): void {
    for (const { id } of this.deps.listEntries()) {
      this.syncDeclared(id);
    }
  }

  /**
   * One-shot, at boot: append a warning to each extension's log naming every
   * activation event it declares that the host has no firing site for
   * (`ActivationEvents.ts`'s `FIRED_ACTIVATION_EVENTS`). Declaring one is not
   * an error - the vocabulary intentionally covers events no firing site
   * exists for yet - but it is worth a quiet note in the one place
   * (`Extensions UI` -> view log) an author would look for it.
   */
  warnOnUnfiredEvents(): void {
    if (this.warnedAtBoot) return;
    this.warnedAtBoot = true;
    for (const { id, entry } of this.deps.listEntries()) {
      const unfired = (entry.manifest.activationEvents ?? []).filter(
        (e) => !Extensions.isFiredActivationEvent(e),
      );
      if (unfired.length === 0) continue;
      this.deps.log(
        id,
        'warn',
        `declares activationEvents the host does not fire yet: ${unfired.join(', ')}`,
      );
    }
  }
}
