/**
 * The built-in feature modules of the web app: manifest + binding
 * pairs, added to the host at boot. Manifests are data; bindings only hold
 * lazy loaders. Add a module here (one line) when it is created.
 */
import type { FeatureModuleBinding, FeatureModuleManifest } from '@bible/core/browser';
import { hostPanesModules } from './host/panes';
import { hostUiManifest } from './host/ui';
import { addBuiltinModule, reconcileModules } from './moduleHost';

export const BUILTIN_MODULES: ReadonlyArray<readonly [FeatureModuleManifest, FeatureModuleBinding?]> = [...hostPanesModules, [hostUiManifest]];

let registered = false;

/** Add every built-in module and register the enabled ones' contributions. Loads no module code. */
export function registerBuiltinModules(): void {
  if (registered) return;
  registered = true;
  for (const [manifest, binding] of BUILTIN_MODULES) addBuiltinModule(manifest, binding);
  reconcileModules();
}
