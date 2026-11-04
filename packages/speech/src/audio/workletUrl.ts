import url from './pcmCapture.worklet.ts?worker&url';

/** Single seam so tests can mock the Vite worker URL. */
export const PCM_WORKLET_URL: string = url;
export const PCM_WORKLET_NAME = 'pcm-capture';
