/**
 * Production `IExtensionCommandBridge`.
 *
 * Forwards `commandRegistry.register` / `disposeByOwner` / `execute` calls
 * into the renderer-side `CommandRegistry` instance via a small IPC pair:
 *
 *   main ->  renderer  : 'ext-bridge:command'           ({ op, requestId, args })
 *   renderer -> main   : 'ext-bridge:command:response'  ({ requestId, ok, ... })
 *   renderer -> main   : 'ext-bridge:command:invoke'    (callback when the
 *                       renderer fires a registered extension command)
 *   renderer -> main   : 'ext-bridge:command:ready'     (renderer bridge attached)
 *
 * The renderer side of the protocol lives in
 * `src/ui/extensions/extensionRendererBridge.ts`. Both ends agree on a small
 * `op` vocabulary documented inline below.
 *
 * --- Declared commands (task 0024 round 3, P1.5) --------------------------
 *
 * `registerDeclaredCommand`/`unregisterDeclaredCommands` pre-register a
 * *placeholder* row for a `contributes.commands` entry, before the owning
 * extension's worker exists. The placeholder is an ordinary renderer
 * `CommandRegistration` - the palette, the Tools menu and (via `shortcut`)
 * the keyboard treat it exactly like a real command - whose handler
 * (`invokeDeclared`) activates the owner on first invocation and then
 * forwards to whatever the extension actually registered (or, if it declared
 * a `handlerEndpoint` and never bothered to call `commands.register` itself,
 * straight to that reverse-RPC endpoint - see `IRuntimeApi.expose`'s own doc
 * comment: "the host may call before any imperative registration has run").
 *
 * A worker's own `commands.register(sameId)` (via `register()` below)
 * *supersedes* the placeholder: the placeholder row is disposed first (so
 * the renderer's `CommandRegistry.register` does not reject the real one as
 * a duplicate id) and the real spec takes over. If the real registration is
 * later disposed - the worker deactivates, crashes, or calls
 * `commands.dispose()` itself - the placeholder comes back, so a declared
 * command never simply vanishes from the palette. Two independent code
 * paths can trigger that "comes back": the per-registration disposer
 * returned by `register()` (an individual dispose while the worker stays
 * active) and `DeclaredContributions.syncDeclared` via `ctx.onDeclaredResync`
 * (a bulk teardown - deactivate, crash, disable). `disposeByOwner` (the bulk
 * path) does not run the per-registration disposer, so it must clear
 * `registrationIdByCommandId` itself or a later resync would wrongly believe
 * the id is still superseded.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import type { Extensions } from '@bible/core';

import type {
  ExtensionCommandSpec,
  IExtensionCommandBridge,
} from '../api-impl/IExtensionRegistryBridges';
import { BridgeRpc } from './RendererBridgeRpc';

type ContributedCommand = Extensions.ContributedCommand;

/** Bookkeeping for one declared (`contributes.commands`) command id. */
interface DeclaredCommandState {
  extensionId: string;
  decl: ContributedCommand;
  /** Non-null while the placeholder row itself is registered in the renderer. */
  registrationId: string | null;
}

export interface RendererCommandBridgeDeps {
  /**
   * Coalesced activation for a declared command's first invocation. Fires
   * `activationEvent` (best-effort - a per-extension failure there is
   * already logged and does not reject) and then activates `extensionId`
   * directly, so a command still works even if its manifest's
   * `activationEvents` omitted the matching `onCommand:` entry. Rejects with
   * the real activation error on failure.
   */
  activate: (extensionId: string, activationEvent: string) => Promise<void>;
  /**
   * Reverse-RPC call into an active worker's `api.runtime.expose`d endpoint -
   * used when a declared command names a `handlerEndpoint` but the worker
   * never called `commands.register` for it imperatively.
   */
  callWorkerEndpoint: (extensionId: string, endpoint: string, args: unknown[]) => Promise<unknown>;
  /** Appends one line to `extensionId`'s own lifecycle log. */
  log: (extensionId: string, level: 'warn' | 'error', message: string) => void;
  /**
   * Called when the renderer bridge attaches (`ext-bridge:command:ready`).
   * `BridgeRpc` drops a send when there is no window/listener yet and keeps
   * no queue (`RendererBridgeRpc.ts`), so a placeholder pushed before the
   * renderer's extension bridge is wired would otherwise be lost silently.
   * Wired by `main.ts` to `DeclaredContributions.syncAll()`.
   */
  onRendererReady?: () => void;
}

export class RendererCommandBridge implements IExtensionCommandBridge {
  private readonly rpc: BridgeRpc;
  private readonly deps: RendererCommandBridgeDeps | undefined;
  /** registrationId -> invoke callback (set by `registerRow`, drained by inbound). */
  private readonly invokers = new Map<string, (args: unknown) => Promise<unknown>>();
  /** extensionId -> set of registrationIds, for `disposeByOwner`. */
  private readonly ownerToIds = new Map<string, Set<string>>();
  /** Declared (`contributes.commands`) state, keyed by command id. */
  private readonly declared = new Map<string, DeclaredCommandState>();
  /** commandId -> registrationId, but only while a REAL (imperative) registration owns it. */
  private readonly registrationIdByCommandId = new Map<string, string>();
  /** De-dupes the "unresolved declared command" log line per command id. */
  private readonly unresolvedWarned = new Set<string>();
  private nextRegistrationId = 1;

  constructor(getWindow: () => BrowserWindow | null, deps?: RendererCommandBridgeDeps) {
    this.deps = deps;
    this.rpc = new BridgeRpc({
      outboundChannel: 'ext-bridge:command',
      responseChannel: 'ext-bridge:command:response',
      getWindow,
    });

    // Renderer-initiated callback path: when a command registered through
    // this bridge fires (menu / palette / keybinding), the renderer routes
    // the dispatch back to main via this channel and main forwards to the
    // worker through the cached `invoke` callback.
    ipcMain.handle('ext-bridge:command:invoke', async (_event, payload: { registrationId: string; args: unknown }) => {
      const cb = this.invokers.get(payload.registrationId);
      if (!cb) throw new Error(`No registered extension command callback for ${payload.registrationId}`);
      return cb(payload.args);
    });

    // Renderer-ready ping (task 0024 round 3, P1.5) - see `onRendererReady`'s
    // doc comment above for why this exists.
    ipcMain.on('ext-bridge:command:ready', () => {
      this.deps?.onRendererReady?.();
    });
  }

  // --- IExtensionCommandBridge (real, imperative registrations) ----------

  register(
    spec: ExtensionCommandSpec,
    invoke: (args: unknown) => Promise<unknown>,
  ): () => void {
    // Supersede a declared placeholder for the same id, if one is currently
    // placed - dispose it FIRST, or the renderer's `CommandRegistry.register`
    // rejects the real registration as a duplicate id.
    const shadowed = this.declared.get(spec.id);
    if (shadowed?.registrationId) {
      this.disposeRow(shadowed.registrationId, shadowed.extensionId);
      shadowed.registrationId = null;
    }

    const registrationId = this.registerRow(spec, invoke);
    this.registrationIdByCommandId.set(spec.id, registrationId);

    return () => {
      if (!this.disposeRow(registrationId, spec.ownerExtensionId)) return;
      this.registrationIdByCommandId.delete(spec.id);
      // The extension's own registration is gone, but its declaration is
      // not - restore the placeholder so the command stays reachable
      // (retrying activation on next use) instead of disappearing.
      if (shadowed) this.registerDeclaredCommand(shadowed.extensionId, shadowed.decl);
    };
  }

  disposeByOwner(extensionId: string): number {
    const owners = this.ownerToIds.get(extensionId);
    if (!owners) return 0;
    const ids = Array.from(owners);
    const idSet = new Set(ids);
    for (const id of ids) {
      this.invokers.delete(id);
    }
    // A bulk teardown never runs the per-registration disposer returned by
    // `register()`, so it must clear `registrationIdByCommandId` itself -
    // otherwise a later `registerDeclaredCommand` (via `onDeclaredResync`)
    // would see the id as still superseded and never re-place the
    // placeholder. Declared placeholders themselves never occupy this map
    // (only `register()` - the real path - sets it), so this only ever
    // clears real, now-gone registrations.
    for (const [commandId, regId] of this.registrationIdByCommandId) {
      if (idSet.has(regId)) this.registrationIdByCommandId.delete(commandId);
    }
    this.ownerToIds.delete(extensionId);
    if (ids.length > 0) {
      void this.rpc.request('disposeMany', [ids]).catch(() => undefined);
    }
    return ids.length;
  }

  async execute(commandId: string, args?: unknown): Promise<unknown> {
    return this.rpc.request('execute', [commandId, args]);
  }

  // --- Declared commands (task 0024 round 3, P1.5) ------------------------

  /**
   * Pre-register a placeholder for one `contributes.commands` entry.
   * Idempotent: a no-op if this extension's placeholder is already placed,
   * and does not disturb an id another extension already declared (logs and
   * ignores - structurally shouldn't happen, since `normalizeId` forces every
   * contribution id under `ext.<owner>.`, but this is the same first-wins
   * defence `CommandRegistry.register` itself applies).
   */
  registerDeclaredCommand(extensionId: string, decl: ContributedCommand): void {
    const existing = this.declared.get(decl.id);
    if (existing) {
      if (existing.extensionId !== extensionId) {
        this.deps?.log(
          extensionId,
          'warn',
          `command ${decl.id} is already declared by ${existing.extensionId}; ignored`,
        );
        return;
      }
      if (existing.registrationId !== null) return; // already placed
    }
    const state: DeclaredCommandState = { extensionId, decl, registrationId: null };
    this.declared.set(decl.id, state);
    // A real registration currently owns this id (the extension is active
    // and superseded the placeholder) - leave it be. `registrationIdByCommandId`
    // is the live source of truth for this, not any flag on `state` itself.
    if (this.registrationIdByCommandId.has(decl.id)) return;

    const spec: ExtensionCommandSpec = {
      id: decl.id,
      ownerExtensionId: extensionId,
      title: decl.title,
      ...(decl.category !== undefined ? { category: decl.category } : {}),
      ...(decl.shortcut !== undefined ? { shortcut: decl.shortcut } : {}),
      ...(decl.when !== undefined ? { when: decl.when } : {}),
      ...(decl.order !== undefined ? { order: decl.order } : {}),
      ...(decl.hidden !== undefined ? { hidden: decl.hidden } : {}),
    };
    state.registrationId = this.registerRow(spec, (args) => this.invokeDeclared(decl.id, args));
  }

  /** Drop every declared placeholder owned by `extensionId` (uninstalled, disabled, or no longer eligible). */
  unregisterDeclaredCommands(extensionId: string): void {
    for (const [commandId, state] of this.declared) {
      if (state.extensionId !== extensionId) continue;
      if (state.registrationId) {
        this.disposeRow(state.registrationId, extensionId);
      }
      this.declared.delete(commandId);
      this.unresolvedWarned.delete(commandId);
    }
  }

  /**
   * The declared placeholder's handler: activate the owner (coalesced -
   * concurrent invocations while activation is in flight all await the same
   * promise, see `ExtensionHostLifecycle.activate`), then forward to
   * whatever now handles the command for real.
   */
  private async invokeDeclared(commandId: string, args: unknown): Promise<unknown> {
    const state = this.declared.get(commandId);
    if (!state) throw new Error(`No declared command ${commandId}`);
    const { extensionId, decl } = state;
    if (!this.deps) {
      throw new Error(
        `Declared command ${commandId} cannot activate - RendererCommandBridge has no deps wired`,
      );
    }

    // Throws (and leaves the placeholder in place, untouched) on a real
    // activation failure - the palette/menu surfaces that as a command error.
    await this.deps.activate(extensionId, `onCommand:${commandId}`);

    // Activation may have superseded the placeholder: the worker's own
    // `activate()` called `commands.register` for this id, which set
    // `registrationIdByCommandId`. Call that closure DIRECTLY, never
    // `this.execute(commandId)` - re-entering the renderer's dispatch would
    // loop back to this same placeholder if the supersede has not (yet)
    // happened for any reason.
    const realId = this.registrationIdByCommandId.get(commandId);
    const real = realId ? this.invokers.get(realId) : undefined;
    if (real) return real(args);

    if (decl.handlerEndpoint) {
      return this.deps.callWorkerEndpoint(extensionId, decl.handlerEndpoint, [args]);
    }

    if (!this.unresolvedWarned.has(commandId)) {
      this.unresolvedWarned.add(commandId);
      this.deps.log(
        extensionId,
        'warn',
        `declared command ${commandId} is unresolved: add a handlerEndpoint to extension.json ` +
          `or call api.commands.register('${commandId}', ...) from activate()`,
      );
    }
    throw new Error(
      `${extensionId} declares command ${commandId} but neither registered it at activation ` +
        'nor declared a handlerEndpoint for it',
    );
  }

  // --- Shared row bookkeeping ----------------------------------------------

  /** Mint a registrationId, track it, and push the registration to the renderer. */
  private registerRow(
    spec: ExtensionCommandSpec,
    invoke: (args: unknown) => Promise<unknown>,
  ): string {
    const registrationId = `cmd-${this.nextRegistrationId++}`;
    this.invokers.set(registrationId, invoke);
    let owners = this.ownerToIds.get(spec.ownerExtensionId);
    if (!owners) {
      owners = new Set();
      this.ownerToIds.set(spec.ownerExtensionId, owners);
    }
    owners.add(registrationId);

    // Best-effort dispatch - the renderer may not be ready (e.g. during
    // shutdown). We deliberately do not await: the api-impl is sync.
    void this.rpc
      .request('register', [{ registrationId, spec }])
      .catch((err) => {
        // Silently swallow - registration failures land in the worker on
        // the next call. The host already logs RPC errors centrally.
        void err;
      });

    return registrationId;
  }

  /** Undo `registerRow`. Returns false (no-op) if `registrationId` was already gone. */
  private disposeRow(registrationId: string, ownerExtensionId: string): boolean {
    if (!this.invokers.delete(registrationId)) return false;
    this.ownerToIds.get(ownerExtensionId)?.delete(registrationId);
    void this.rpc.request('dispose', [registrationId]).catch(() => undefined);
    return true;
  }
}
