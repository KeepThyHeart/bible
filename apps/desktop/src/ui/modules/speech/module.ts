/**
 * Lazy half of the Speech module (task 0151): installs the bridge host that answers the speech
 * calls main forwards. Loads no engine code; `@bible/speech` is imported on the first call.
 */
import type { Disposable, FeatureModuleContext } from '@bible/core/browser';
import { installBridgeHost } from './bridgeHost';

export function activate(_ctx: FeatureModuleContext): Disposable {
  const dispose = installBridgeHost();
  return { dispose };
}
