/**
 * The built-in feature modules of the desktop renderer: manifest + binding
 * pairs, added to the host at boot. Manifests are data; bindings only hold
 * lazy loaders. Add a module here (one line) when it is created.
 */
import { hostPanelsManifest, hostPanelsBinding } from './host/panels';
import { hostUiModule } from './host/ui';
import { genealogyManifest } from './genealogy/manifest';
import { genealogyBinding } from './genealogy/binding';
import { timelineManifest } from './timeline/manifest';
import { timelineBinding } from './timeline/binding';
import { quizModule } from './quiz/binding';
import { readingPlansModule } from './reading-plans/binding';
import { addDesktopModule, fireStartupFinished, reconcileModules } from './moduleHost';
import type { DesktopFeatureModule } from './moduleHost';

export const BUILTIN_MODULES: readonly DesktopFeatureModule[] = [
  { manifest: hostPanelsManifest, binding: hostPanelsBinding },
  { manifest: hostUiModule[0], binding: hostUiModule[1] },
  { manifest: genealogyManifest, binding: genealogyBinding },
  { manifest: timelineManifest, binding: timelineBinding },
  quizModule,
  readingPlansModule,
];

let registered = false;

/** Add every built-in module and register the enabled ones' contributions. Loads no module code. */
export function registerBuiltinModules(): void {
  if (registered) return;
  registered = true;
  for (const entry of BUILTIN_MODULES) addDesktopModule(entry);
  reconcileModules();
  fireStartupFinished();
}
