/**
 * The built-in feature modules of the desktop renderer: manifest + binding
 * pairs, added to the host at boot. Manifests are data; bindings only hold
 * lazy loaders. Add a module here (one line) when it is created.
 */
import type { FeatureModuleBinding, FeatureModuleManifest } from '@bible/core/browser';
import { hostPanelsManifest, hostPanelsBinding } from './host/panels';
import { hostUiModule } from './host/ui';
import { addBuiltinModule, reconcileModules } from './moduleHost';
import { genealogyManifest } from './genealogy/manifest';
import { genealogyBinding } from './genealogy/binding';
import { timelineManifest } from './timeline/manifest';
import { timelineBinding } from './timeline/binding';

export const BUILTIN_MODULES: ReadonlyArray<readonly [FeatureModuleManifest, FeatureModuleBinding?]> = [[hostPanelsManifest, hostPanelsBinding], hostUiModule, [genealogyManifest, genealogyBinding], [timelineManifest, timelineBinding]];

let registered = false;

/** Add every built-in module and register the enabled ones' contributions. Loads no module code. */
export function registerBuiltinModules(): void {
  if (registered) return;
  registered = true;
  for (const [manifest, binding] of BUILTIN_MODULES) addBuiltinModule(manifest, binding);
  reconcileModules();
}
