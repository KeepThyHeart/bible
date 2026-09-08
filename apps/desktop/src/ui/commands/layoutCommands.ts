/**
 * Layout-management commands: applying preset layouts.
 *
 * Registers one command per built-in preset so they appear in the command
 * palette and can be invoked via keybindings.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { BUILT_IN_PRESETS } from '../presets';
import { LayoutPresetService } from '../services/LayoutPresetService';

// Singleton service instance shared with LayoutDropdown
export const layoutPresetService = new LayoutPresetService();

export function registerLayoutCommands(registry: ICommandRegistry): IDisposable[] {
  return BUILT_IN_PRESETS.map(preset =>
    registry.register({
      id: `layout.applyPreset.${preset.id}`,
      title: { key: 'layout.applyPreset.title', params: { presetName: { key: preset.name.key } } },
      category: { key: 'layout.dropdown.label' },
      handler: async () => {
        await layoutPresetService.apply(preset.id);
      },
    })
  );
}
