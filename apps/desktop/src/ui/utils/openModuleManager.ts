/**
 * Open the Module Manager, optionally pre-filtered to a single module type.
 *
 * Panes call this from their empty states so a user with no module of
 * a given type is taken straight to the place they can install one - filtered to
 * that type - rather than to an empty installed-module selector.
 *
 * The event is the same `command:module:openManager` the command registry and
 * native menu already fire; the optional `moduleType` rides along in `detail`
 * and is honored by `App.tsx` (which forwards it to `ModuleManagerDialog`).
 */

import type { ModuleType } from '../stores/useModuleStore';

export interface OpenModuleManagerDetail {
  moduleType?: ModuleType;
}

export function openModuleManager(moduleType?: ModuleType): void {
  window.dispatchEvent(
    new CustomEvent<OpenModuleManagerDetail>('command:module:openManager', {
      detail: moduleType ? { moduleType } : {},
    }),
  );
}
