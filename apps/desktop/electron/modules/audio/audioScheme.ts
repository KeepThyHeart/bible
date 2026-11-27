/** The privileged-scheme entry for `kth-audio`; main.ts registers it together with `ext-ui` (Electron honours one call). */
import type { CustomScheme } from 'electron';
import { AUDIO_SCHEME } from './types';

export const AUDIO_SCHEME_PRIVILEGE: CustomScheme = {
  scheme: AUDIO_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};
