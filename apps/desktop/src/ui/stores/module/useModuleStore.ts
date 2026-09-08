import { create } from 'zustand';
import { ModuleState } from './types';
import { createLifecycleSlice } from './slices/lifecycleSlice';
import { createCatalogSlice } from './slices/catalogSlice';
import { createInstalledSlice } from './slices/installedSlice';
import { createDetailsSlice } from './slices/detailsSlice';
import { createDownloadSlice } from './slices/downloadSlice';
import { createRepositorySlice } from './slices/repositorySlice';

export const useModuleStore = create<ModuleState>()((...a) => ({
  ...createLifecycleSlice(...a),
  ...createCatalogSlice(...a),
  ...createInstalledSlice(...a),
  ...createDetailsSlice(...a),
  ...createDownloadSlice(...a),
  ...createRepositorySlice(...a),
}));
