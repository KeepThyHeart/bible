/**
 * Speech, desktop main half. The engine runs in the renderer (`src/ui/modules/speech`); this module
 * forwards `ISpeechApi` calls to it (main -> renderer event `call`, renderer -> main `reply`/`ready`)
 * and publishes the bridge through `hub.ts` for Scripture memory and extensions.
 */
import type { Disposable } from '@bible/core/browser';
import type { FeatureMainModule } from '../FeatureMainModule';
import { RendererSpeechBridge } from './bridge';
import { setMainSpeech } from './hub';
import type { SpeechBridgeResult, SpeechModuleApi } from './types';

async function askMicrophone(): Promise<unknown> {
  if (process.platform !== 'darwin') return true;
  const { systemPreferences } = await import('electron');
  return systemPreferences.askForMediaAccess('microphone');
}

const mainModule: FeatureMainModule = {
  id: 'speech',
  registerIpc(ipc, deps): Disposable {
    const bridge = new RendererSpeechBridge({
      send(call) {
        if (deps.getWindows().length === 0) throw new Error('No window.');
        ipc.send('call', call);
      },
      askMicrophone,
    });
    const handle = <K extends keyof SpeechModuleApi>(method: K, fn: (...args: Parameters<SpeechModuleApi[K]>) => void): void =>
      ipc.handle(method, fn as (...args: unknown[]) => unknown);
    handle('reply', (callId: number, result: SpeechBridgeResult) => {
      if (typeof callId === 'number') bridge.reply(callId, result);
    });
    handle('ready', () => bridge.markReady());
    setMainSpeech(bridge, () => bridge.windowGone());
    return {
      dispose() {
        setMainSpeech(null);
        bridge.dispose();
      },
    };
  },
};

export default mainModule;
