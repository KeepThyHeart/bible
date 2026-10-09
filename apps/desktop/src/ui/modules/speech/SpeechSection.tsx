/**
 * SpeechSection.tsx
 *
 * "Speech" tab of the Preferences dialog (task 0151): choose the on-device Whisper model and
 * device, download / cancel / delete the model with progress, and test the microphone with a
 * level meter. The engine is reached through bridgeHost's lazy service; nothing loads until the
 * section is shown. The mic test uses only getUserMedia + an AnalyserNode (no audio is stored).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechPrefs } from '@bible/speech';
import { useI18n } from '../../contexts/useI18n';
import { getSpeechService, speechPrefs, type RendererSpeechService } from './bridgeHost';

type ListenState = 'ready' | 'needs-download' | 'unavailable' | 'unknown';

const MODELS: SpeechPrefs['model'][] = ['auto', 'base', 'tiny'];
const DEVICES: SpeechPrefs['device'][] = ['auto', 'webgpu', 'wasm'];

/** RMS of a time-domain byte buffer, 0..1. */
export function levelOf(samples: Uint8Array): number {
  let sum = 0;
  for (const s of samples) {
    const v = (s - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / Math.max(1, samples.length)) * 3);
}

export const SpeechSection: React.FC = () => {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<SpeechPrefs>(() => speechPrefs.get());
  const [state, setState] = useState<ListenState>('unknown');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const modelOf = useCallback(async (svc: RendererSpeechService): Promise<string> => {
    const c = await svc.chosen();
    return typeof c === 'string' ? c : c.model;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const svc = await getSpeechService();
      setState((await svc.status()).listen as ListenState);
    } catch (err) {
      setState('unavailable');
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  const update = (patch: Partial<SpeechPrefs>) => {
    const next = { ...prefs, ...patch };
    speechPrefs.set(next);
    setPrefs(next);
    void refresh();
  };

  const download = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError(null);
    setProgress({ loaded: 0 });
    try {
      const svc = await getSpeechService();
      await svc.prepareModel(await modelOf(svc), (p) => setProgress({ loaded: p.loaded, total: p.total }), ctrl.signal);
    } catch (err) {
      if (!ctrl.signal.aborted) setError((err as Error).message);
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
      await refresh();
    }
  };

  const remove = async () => {
    setError(null);
    try {
      const svc = await getSpeechService();
      await svc.removeModel(await modelOf(svc));
    } catch (err) {
      setError((err as Error).message);
    }
    await refresh();
  };

  const percent = progress?.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : null;
  const secondary = { color: 'var(--theme-text-secondary)' };

  return (
    <div className="space-y-4" data-testid="speech-section">
      <p className="text-xs" style={secondary}>{t('speech.description')}</p>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{t('speech.model')}</span>
        <select
          data-testid="speech-model"
          value={prefs.model}
          onChange={(e) => update({ model: e.target.value as SpeechPrefs['model'] })}
          disabled={busy}
        >
          {MODELS.map((m) => <option key={m} value={m}>{t(`speech.model.${m}`)}</option>)}
        </select>
      </label>

      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{t('speech.device')}</span>
        <select
          data-testid="speech-device"
          value={prefs.device}
          onChange={(e) => update({ device: e.target.value as SpeechPrefs['device'] })}
          disabled={busy}
        >
          {DEVICES.map((d) => <option key={d} value={d}>{t(`speech.device.${d}`)}</option>)}
        </select>
      </label>

      <div className="flex items-center gap-3 text-sm" data-testid="speech-model-row">
        <span className="flex-1" data-testid="speech-status">{t(`speech.status.${state}`)}</span>
        {busy ? (
          <>
            {percent !== null && <span data-testid="speech-percent">{t('speech.downloading', { percent })}</span>}
            <button type="button" data-testid="speech-cancel" onClick={() => abortRef.current?.abort()}>{t('speech.cancel')}</button>
          </>
        ) : state === 'needs-download' ? (
          <button type="button" data-testid="speech-download" onClick={() => void download()}>{t('speech.download')}</button>
        ) : state === 'ready' ? (
          <button type="button" data-testid="speech-delete" onClick={() => void remove()}>{t('speech.delete')}</button>
        ) : null}
      </div>
      {busy && (
        <progress className="w-full" max={100} value={percent ?? undefined} data-testid="speech-progress" />
      )}
      {error && <p className="text-sm" style={secondary} role="alert" data-testid="speech-error">{error}</p>}

      <MicTest />
    </div>
  );
};

/** Start/stop microphone level meter. */
export const MicTest: React.FC = () => {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setRunning(false);
    setLevel(0);
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        setLevel(levelOf(buf));
      }, 60);
      stopRef.current = () => {
        clearInterval(timer);
        stream.getTracks().forEach((tr) => tr.stop());
        void ctx.close();
      };
      setRunning(true);
    } catch (err) {
      const name = (err as Error).name;
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? t('speech.mic.denied') : t('speech.mic.unavailable'));
    }
  };

  return (
    <div className="space-y-2" data-testid="speech-mic-test">
      <div className="flex items-center gap-3 text-sm">
        <span className="flex-1">{t('speech.mic.title')}</span>
        <button type="button" data-testid="speech-mic-toggle" onClick={() => (running ? stop() : void start())}>
          {running ? t('speech.mic.stop') : t('speech.mic.start')}
        </button>
      </div>
      <div
        role="meter"
        aria-label={t('speech.mic.level')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        className="h-2 w-full rounded"
        style={{ background: 'var(--theme-border, #8884)' }}
        data-testid="speech-mic-meter"
      >
        <div className="h-2 rounded" style={{ width: `${Math.round(level * 100)}%`, background: 'var(--theme-accent, #3b82f6)' }} />
      </div>
      {error && <p className="text-sm" role="alert" style={{ color: 'var(--theme-text-secondary)' }}>{error}</p>}
    </div>
  );
};

export default SpeechSection;
