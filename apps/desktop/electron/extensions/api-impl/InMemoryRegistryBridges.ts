/**
 * In-process bridge implementations that wrap a real
 * `ICommandRegistry` / `IWhenContextService` and satisfy the
 * `IExtensionCommandBridge` / `IExtensionContextBridge` contracts.
 *
 * These exist so:
 *
 *   1. Unit tests of `commandsApiImpl` / `contextApiImpl` can drive the full
 *      registration and dispose-on-deactivate flow without standing up an
 *      Electron `BrowserWindow` and an IPC channel.
 *
 *   2. Future host integrations that already have a registry instance in the
 *      same process (e.g. a hypothetical "headless" host used by CLI tooling
 *      or e2e harnesses) can use these directly instead of routing through
 *      IPC.
 *
 * The production wiring used inside Electron talks to the renderer-side
 * registry via `ipcMain.handle` round-trips. That bridge ships in a
 * follow-up so this chunk does not need to design every IPC envelope at
 * once. Both bridges share the contract here, so swapping between them is
 * a one-line change in `ExtensionHost`.
 */

import type { ICommandRegistry } from '../../../src/ui/services/ICommandRegistry';
import type {
  IWhenContextService,
  WhenContextValue,
} from '../../../src/ui/services/IWhenContextService';
import type { CommandRegistration, CommandContext } from '../../../src/ui/types/Command';
import type {
  ExtensionCommandSpec,
  IExtensionCommandBridge,
  IExtensionContextBridge,
} from './IExtensionRegistryBridges';

export class InMemoryCommandBridge implements IExtensionCommandBridge {
  constructor(private readonly registry: ICommandRegistry) {}

  register(
    spec: ExtensionCommandSpec,
    invoke: (args: unknown) => Promise<unknown>,
  ): () => void {
    const registration: CommandRegistration = {
      id: spec.id,
      title: spec.title,
      handler: async (ctx: CommandContext) => {
        await invoke(ctx.args);
      },
      ownerExtensionId: spec.ownerExtensionId,
      ...(spec.category !== undefined ? { category: spec.category } : {}),
      ...(spec.shortcut !== undefined ? { shortcut: spec.shortcut } : {}),
      ...(spec.when !== undefined ? { when: spec.when } : {}),
      ...(spec.order !== undefined ? { order: spec.order } : {}),
      ...(spec.hidden !== undefined ? { hidden: spec.hidden } : {}),
    };
    const disposable = this.registry.register(registration);
    return () => disposable.dispose();
  }

  disposeByOwner(extensionId: string): number {
    return this.registry.disposeByOwner(extensionId);
  }

  execute(commandId: string, args?: unknown): Promise<unknown> {
    return this.registry.execute(commandId, args);
  }
}

export class InMemoryContextBridge implements IExtensionContextBridge {
  constructor(private readonly whenContext: IWhenContextService) {}

  get(key: string): WhenContextValue | undefined {
    return this.whenContext.get(key);
  }

  setForExtension(extensionId: string, key: string, value: WhenContextValue): void {
    this.whenContext.setForExtension(extensionId, key, value);
  }

  disposeExtensionKeys(extensionId: string): number {
    return this.whenContext.disposeExtensionKeys(extensionId);
  }
}
