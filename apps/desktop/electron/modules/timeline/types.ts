import type { TimelineDataset } from '@bible/core/browser';

/** Main <-> renderer API of the timeline module (`module:timeline:<method>`). */
export interface TimelineApi {
  /** The whole installed timeline module as one dataset, or `null` when none is installed. */
  getDataset(): Promise<TimelineDataset | null>;
}
