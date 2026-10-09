/** Lazy view of Settings > Audio (`preferences:audio`). Loads the stylesheet itself: it can open before `module.ts` ran. */
import '../audio.scss';
import { AudioSettingsTab } from './AudioSettingsTab';

export default AudioSettingsTab;
