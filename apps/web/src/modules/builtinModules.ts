/**
 * The built-in feature modules of the web app, added to the host at boot.
 * Manifests are data; bindings only hold lazy loaders and (at most) a cheap
 * boot probe. Add a module here (one line) when it is created.
 */
import type { FeatureModuleBinding, FeatureModuleManifest } from '@bible/core/browser';
import { hostPanesModules } from './host/panes';
import { hostUiManifest } from './host/ui';
import { addWebModule, reconcileModules } from './moduleHost';
import type { WebFeatureModule } from './moduleHost';
import { presentModule } from './present/binding';
import { genealogyModule } from './genealogy/binding';
import { timelineModule } from './timeline/binding';
import { quizModule } from './quiz/binding';
import { xrefGraphModule } from './xref-graph/binding';
import { wordStudyModule } from './word-study/binding';
import { similarModule } from './similar/binding';
import { measuresModule } from './measures/binding';
import { keywordMarksModule } from './keyword-marks/binding';
import { audioModule } from './audio/binding';
import { downloadsModule } from './downloads/binding';
import { notificationsModule } from './notifications/binding';
import { gamesModule } from './games/binding';

const plain = ([manifest, binding]: readonly [FeatureModuleManifest, FeatureModuleBinding?]): WebFeatureModule => ({ manifest, binding });

export const BUILTIN_MODULES: readonly WebFeatureModule[] = [
  ...hostPanesModules.map(plain),
  { manifest: hostUiManifest },
  presentModule,
  genealogyModule,
  timelineModule,
  quizModule,
  xrefGraphModule,
  wordStudyModule,
  similarModule,
  measuresModule,
  keywordMarksModule,
  audioModule,
  downloadsModule,
  notificationsModule,
  gamesModule,
];

/** Let modules take handoff secrets out of the URL before anything else runs (see `WebFeatureModule.takeUrl`). */
export function takeModuleUrlHandoffs(): void {
  for (const entry of BUILTIN_MODULES) {
    try {
      entry.takeUrl?.();
    } catch (err) {
      console.warn(`[modules] ${entry.manifest.id}: takeUrl failed`, err);
    }
  }
}

let registered = false;

/** Add every built-in module and register the enabled ones' contributions. Loads no module code. */
export function registerBuiltinModules(): void {
  if (registered) return;
  registered = true;
  for (const entry of BUILTIN_MODULES) addWebModule(entry);
  reconcileModules();
}
