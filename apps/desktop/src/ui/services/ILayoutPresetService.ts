import type { LayoutPreset } from '../types/LayoutPreset';

export interface ApplyPresetOptions {
  /**
   * Ignore the arrangement remembered for this preset and rebuild it from the
   * preset definition. This is what "Reset to default layout" does - the point
   * of that command is to discard whatever state the user has got into.
   */
  forceRebuild?: boolean;
}

export interface ILayoutPresetService {
  list(): LayoutPreset[];
  apply(presetId: string, options?: ApplyPresetOptions): Promise<void>;
  undo(): boolean;
  /** Forget remembered arrangements (called when the workbench is replaced). */
  reset(): void;
  /** Told about every layout change; drops the "current preset" checkmark for manual ones. */
  notifyManualLayoutChange(): void;
  readonly currentPresetId: string | null;
}
