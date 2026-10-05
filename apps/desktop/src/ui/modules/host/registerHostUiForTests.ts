/** Test helper: register the `host-ui` manifest in the singleton module host (idempotent). */
import { featureModules, reconcileModules } from '../moduleHost';
import { hostUiBinding, hostUiManifest } from './ui';

export function registerHostUiForTests(): void {
  if (!featureModules.list().some((m) => m.id === hostUiManifest.id)) {
    featureModules.add(hostUiManifest, hostUiBinding);
  }
  reconcileModules();
}
