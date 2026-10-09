/**
 * Family Tree: activation code (lazy). Registers the "Show family tree" action the Topics pane
 * shows on a person; switching the module off disposes it with everything else in `subscriptions`.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { registerEntityAction } from '../host/entityActions';
import { openFamilyTree } from './openFamilyTree';

export function activate(ctx: FeatureModuleContext): void {
  ctx.subscriptions.push(
    registerEntityAction('genealogy', {
      id: 'genealogy.showFamilyTree',
      categories: ['people'],
      labelKey: 'entityDetailView.showFamilyTree',
      testId: 'show-family-tree',
      run: (entity) => {
        openFamilyTree(entity.id);
      },
    }),
  );
}
