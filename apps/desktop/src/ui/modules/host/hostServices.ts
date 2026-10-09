/**
 * The renderer services a module's `activate()` needs (the command registry, the i18n service).
 * They live in React context, so `main.tsx` binds them here once, before any module can activate.
 */
import type { ICommandRegistry } from '../../services/ICommandRegistry';
import type { II18nService } from '../../services/II18nService';

export interface ModuleHostServices {
  readonly registry: ICommandRegistry;
  readonly i18n: Pick<II18nService, 'loadNamespace'>;
}

let bound: ModuleHostServices | null = null;

export function bindModuleHostServices(services: ModuleHostServices): void {
  bound = services;
}

/** The bound services, or `null` in a window that never bound them (detached windows, tests). */
export function getModuleHostServices(): ModuleHostServices | null {
  return bound;
}

/** Test hook. */
export function resetModuleHostServices(): void {
  bound = null;
}
