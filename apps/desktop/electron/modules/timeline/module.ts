/**
 * Main-process half of the Timeline feature module: serves the installed timeline module
 * (one read-only database) to the renderer as a single `TimelineDataset` on
 * `module:timeline:getDataset`. `null` means no timeline module is installed.
 */
import type { FeatureMainModule } from '../FeatureMainModule';
import { closeTimelineDb, loadDataset } from './timelineData';

const timelineMainModule: FeatureMainModule = {
  id: 'timeline',
  registerIpc(ipc) {
    ipc.handle('getDataset', () => loadDataset());
  },
  close() {
    closeTimelineDb();
  },
};

export default timelineMainModule;
