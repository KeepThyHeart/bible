/**
 * Lazy half of the Downloads module (task 0128). It contributes nothing to host slots: the
 * section is reached through the manifest and `binding.views`. Loading it makes the
 * `downloads` string namespace available before the section renders.
 */
import type { FeatureModuleContext } from '@bible/core/browser';

export async function activate(_ctx: FeatureModuleContext): Promise<void> {
  // Nothing to register.
}
