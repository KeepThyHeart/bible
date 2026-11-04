/**
 * Open the Module Manager, optionally on one tab: a module type (pre-filtered)
 * or another tab such as `features`.
 *
 * Panes call this from their empty states so a user with no module of
 * a given type is taken straight to the place they can install one - filtered to
 * that type - rather than to an empty installed-module selector.
 *
 * The event is the same `command:module:openManager` the command registry and
 * native menu already fire; the optional `moduleType` rides along in `detail`
 * and is honored by `App.tsx` (which forwards it to `ModuleManagerDialog`).
 */

import type { ModuleManagerTab } from '../stores/module/types';

export interface OpenModuleManagerDetail {
  moduleType?: ModuleManagerTab;
}

export function openModuleManager(moduleType?: ModuleManagerTab): void {
  window.dispatchEvent(
    new CustomEvent<OpenModuleManagerDetail>('command:module:openManager', {
      detail: moduleType ? { moduleType } : {},
    }),
  );
}
