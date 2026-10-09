/**
 * Lazy half of the Quiz module (task 0125). It contributes nothing to host slots:
 * the panel/app view, the commands and the main-process API are all reached through
 * the manifest, `binding.views`, `commands` and `createModuleClient('quiz')`.
 */
import type { FeatureModuleContext } from '@bible/core/browser';

export async function activate(_ctx: FeatureModuleContext): Promise<void> {
  // Nothing to register.
}
