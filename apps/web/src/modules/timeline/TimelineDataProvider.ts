import type { ITimelineDataProvider, TimelineDataset } from '@bible/core/browser';
import { API_BASE } from '../../utils/apiUrl';

/**
 * Fetches the whole timeline module (`GET /api/timeline`) once and keeps it in
 * memory. The dataset is static for an installed module version, and the server
 * marks it cacheable, so a reload is served by the HTTP cache.
 *
 * Resolves null when no timeline module is installed (404). Any other failure
 * rejects and is NOT remembered, so the next call retries.
 */
export class TimelineDataProvider implements ITimelineDataProvider {
  private pending: Promise<TimelineDataset | null> | null = null;

  constructor(private readonly baseUrl: string) {}

  getDataset(): Promise<TimelineDataset | null> {
    if (!this.pending) {
      const request = this.fetchDataset();
      this.pending = request;
      // Only a real dataset stays cached; a miss or an error may be fixed later.
      request.then(
        (dataset) => { if (dataset === null && this.pending === request) this.pending = null; },
        () => { if (this.pending === request) this.pending = null; },
      );
    }
    return this.pending;
  }

  private async fetchDataset(): Promise<TimelineDataset | null> {
    const res = await fetch(`${this.baseUrl}/api/timeline`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return (await res.json()) as TimelineDataset;
  }
}

let shared: ITimelineDataProvider | null = null;

/** The app-wide provider (the shared `IDataProviders` bag has no timeline slot). */
export function getTimelineProvider(): ITimelineDataProvider {
  if (!shared) shared = new TimelineDataProvider(API_BASE);
  return shared;
}
