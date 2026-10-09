/** Dev harness UI for the on-device speech engine. Plain Preact; not part of any production build. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RecognizedWord } from '@bible/core/speech';
import { biasFor, kitFor } from '@bible/core/recite';
import type { WordVerdict } from '@bible/core/recite';
import type { ReciteAction, ReciteStateView } from '@bible/memory/core';
import { DEFAULT_RECITE_SETTINGS } from '@bible/memory/recite/config';
import { expectedFor, gradeRecitation } from '@bible/memory/recite/grade';
import type { GradedRecitation } from '@bible/memory/recite/grade';
import { HandsFreeLoop } from '@bible/memory/recite/handsFreeLoop';
import type { SpeechModelInfo, WhisperModelId } from '@bible/speech';
import { runBench } from './bench';
import type { BenchClip, BenchResult } from './bench';
import { download, exportFixture } from './exportFixture';
import type { FixtureKind } from './exportFixture';
import { decodeWav, loadWavFromFile, loadWavFromUrl, pcmToMic } from './fakeMic';
import { PASSAGES, cardOf, versesOf } from './passages';
import type { Passage } from './passages';
import type { HarnessServices } from './services';

declare global {
  interface Window {
    __speechHarness?: {
      loadWav(url: string, ref?: string): Promise<void>;
      setFakeMic(on: boolean): void;
      runBench(): Promise<BenchResult>;
      services: HarnessServices;
    };
  }
}

type Progress = { phase: 'download' | 'load'; loaded: number; total: number } | null;
type Clip = BenchClip & { seconds: number };

const mb = (n: number): string => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const kit = kitFor('en')!;

function groupOf(v: WordVerdict): 'correct' | 'partial' | 'incorrect' {
  if (v === 'correct' || v === 'variant') return 'correct';
  if (v === 'near' || v === 'hinted' || v === 'swapped') return 'partial';
  return 'incorrect';
}

function Card(p: { title: string; testid: string; children: preact.ComponentChildren; right?: preact.ComponentChildren }) {
  return (
    <section class="card" data-testid={p.testid}>
      <div class="row spread"><h2>{p.title}</h2>{p.right}</div>
      {p.children}
    </section>
  );
}

function Pill(p: { kind?: 'ok' | 'bad' | 'warn'; testid?: string; children: preact.ComponentChildren }) {
  return <span class={`pill ${p.kind ?? ''}`} data-testid={p.testid}>{p.children}</span>;
}

/** The expected words coloured by verdict. */
function Graded(p: { passage: Passage; graded: GradedRecitation }) {
  const verses = versesOf(p.passage);
  let i = 0;
  const extras = p.graded.result.extras;
  return (
    <div data-testid="graded">
      <div class="passage">
        {verses.flatMap((v) => v.words).map((w) => {
          const aw = p.graded.result.words[i];
          const idx = i++;
          return <span key={idx} class={`w ${aw?.verdict ?? 'missed'}`} data-testid="graded-word" data-verdict={aw?.verdict} data-group={groupOf(aw?.verdict ?? 'missed')}>{w}</span>;
        })}
      </div>
      {extras.length > 0 && <div class="muted">Extra words: {extras.map((e) => e.heard).join(' ')}</div>}
    </div>
  );
}

export function Harness(p: { services: HarnessServices; initialWav?: { url: string; ref?: string }; autoBench?: boolean }) {
  const { service, engine, mic, prefs } = p.services;

  // ---- info and models ----
  const [info, setInfo] = useState<Record<string, string>>({});
  const [models, setModels] = useState<SpeechModelInfo[]>([]);
  const [prefsState, setPrefsState] = useState(prefs.get());
  const [progress, setProgress] = useState<Progress>(null);
  const [busyModel, setBusyModel] = useState<string | null>(null);
  const [modelError, setModelError] = useState('');
  const abortModel = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const [env, choice, status, list] = await Promise.all([p.services.env(), p.services.choice(), service.status(), service.models()]);
    setModels(list);
    setInfo({
      'Secure context (mic needs it)': String(window.isSecureContext),
      Device: `${choice.device}${prefsState.device === 'auto' ? ' (auto)' : ''}`,
      Model: `${choice.model}${prefsState.model === 'auto' ? ' (auto)' : ''}`,
      Engine: status.engineLabel,
      Listening: status.listen,
      Speaking: status.speak,
      'Cross-origin isolated': `${window.crossOriginIsolated} (wasm threads ${window.crossOriginIsolated ? 'on' : 'off'})`,
      Cores: String(env.hardwareConcurrency ?? 'unknown'),
      'Device memory': env.deviceMemory ? `${env.deviceMemory} GB` : 'unknown',
      Languages: `${status.languages.length}`,
    });
  }, [service, p.services, prefsState]);

  useEffect(() => { void refresh().catch((e) => setModelError(errText(e))); }, [refresh]);

  const setPref = (k: 'model' | 'device', v: string) => {
    const next = { ...prefs.get(), [k]: v } as ReturnType<typeof prefs.get>;
    prefs.set(next);
    setPrefsState(next);
  };

  const load = async (id: string) => {
    const ac = new AbortController();
    abortModel.current = ac;
    setBusyModel(id);
    setModelError('');
    try {
      await service.prepareModel(id, (pr) => setProgress({ phase: pr.phase === 'manifest' ? 'download' : 'load', loaded: pr.loaded, total: pr.total ?? 0 }), ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) setModelError(errText(e));
    } finally {
      setBusyModel(null);
      setProgress(null);
      void refresh();
    }
  };
  const cancelModel = () => abortModel.current?.abort();
  const removeModel = async (id: string) => {
    setBusyModel(id);
    try { await service.removeModel(id); } catch (e) { setModelError(errText(e)); }
    setBusyModel(null);
    void refresh();
  };

  // ---- clips and fake mic ----
  const [clips, setClips] = useState<Clip[]>([]);
  const [clipIx, setClipIx] = useState(0);
  const [useFake, setUseFake] = useState(false);
  const [clipError, setClipError] = useState('');
  const clip = clips[clipIx];

  useEffect(() => {
    mic.useFake = useFake;
    mic.fake = clip ? pcmToMic(clip.samples, clip.seconds) : null;
  }, [mic, useFake, clip?.samples, clip?.seconds]);

  const addClip = useCallback(async (name: string, wav: ArrayBuffer, ref?: string) => {
    try {
      const d = decodeWav(wav);
      setClips((c) => [...c, { name, samples: d.samples, seconds: d.seconds, ref }]);
      setClipIx((i) => i);
      setClipError('');
    } catch (e) {
      setClipError(`${name}: ${errText(e)}`);
    }
  }, []);

  const loadUrl = useCallback(async (url: string, ref?: string) => {
    try { await addClip(url.split('/').pop()?.split('?')[0] || url, await loadWavFromUrl(url), ref); setUseFake(true); } catch (e) { setClipError(errText(e)); }
  }, [addClip]);

  useEffect(() => { if (p.initialWav) void loadUrl(p.initialWav.url, p.initialWav.ref); }, []);

  const onFiles = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    for (const f of Array.from(input.files ?? [])) await addClip(f.name, await loadWavFromFile(f));
    input.value = '';
  };
  const rewind = () => mic.fake?.rewind();
  const setRef = (text: string) => setClips((c) => c.map((x, i) => (i === clipIx ? { ...x, ref: text || undefined } : x)));

  // ---- mic test ----
  const [level, setLevel] = useState(-100);
  const [micMsg, setMicMsg] = useState('');
  const [micText, setMicText] = useState('');
  const [micBusy, setMicBusy] = useState(false);
  const micListen = useRef<string | null>(null);
  useEffect(() => {
    let last = 0;
    return mic.onLevel((db) => {
      const t = performance.now();
      if (t - last > 60 || db <= -100) { last = t; setLevel(db); }
    });
  }, [mic]);

  const micTest = async () => {
    setMicBusy(true); setMicText(''); setMicMsg('Speak now');
    mic.resetRecording();
    if (useFake) rewind();
    try {
      const { listenId } = await service.startListening({ language: 'en', maxDurationMs: 20000, endSilenceMs: 1200 });
      micListen.current = listenId;
      const o = await service.nextUtterance(listenId, { noSpeechTimeoutMs: 30000 });
      if (o.kind === 'speech') { setMicText(o.transcript.text); setMicMsg(`Heard ${o.transcript.words.length} words in ${Math.round(o.transcript.decodeMs)} ms`); }
      else if (o.kind === 'error') setMicMsg(`${o.code}: ${o.message}`);
      else setMicMsg(o.kind === 'no-speech' ? 'No speech heard' : `Ended (${o.reason})`);
      await service.stopListening(listenId).catch(() => undefined);
    } catch (e) {
      setMicMsg(errText(e));
    }
    micListen.current = null;
    setMicBusy(false);
  };
  const micStop = () => { if (micListen.current) void service.stopListening(micListen.current); };

  // ---- recite ----
  const [passageId, setPassageId] = useState(PASSAGES[0].id);
  const passage = PASSAGES.find((x) => x.id === passageId)!;
  const [rPhase, setRPhase] = useState<'idle' | 'listening' | 'scoring' | 'done'>('idle');
  const [rMsg, setRMsg] = useState('');
  const [graded, setGraded] = useState<GradedRecitation | null>(null);
  const [gradedFor, setGradedFor] = useState<Passage | null>(null);
  const [strictness, setStrictness] = useState<'lenient' | 'normal' | 'strict'>('normal');
  const reciteListen = useRef<string | null>(null);

  const recite = async () => {
    setRPhase('listening'); setGraded(null); setRMsg('Listening');
    mic.resetRecording();
    if (useFake) rewind();
    const verses = versesOf(passage);
    const { words } = expectedFor(verses);
    const heard: RecognizedWord[] = [];
    try {
      const bias = biasFor(words, [], kit, 'names', Math.random);
      const { listenId } = await service.startListening({ language: 'en', bias, maxDurationMs: Math.min(120000, 20000 + words.length * 700), endSilenceMs: 1500 });
      reciteListen.current = listenId;
      for (let first = true; ; first = false) {
        const o = await service.nextUtterance(listenId, { noSpeechTimeoutMs: first ? 30000 : 2500 });
        if (o.kind === 'speech') { heard.push(...o.transcript.words); setRMsg(`Heard ${heard.length} words`); continue; }
        if (o.kind === 'error') setRMsg(`${o.code}: ${o.message}`);
        break;
      }
      await service.stopListening(listenId).catch(() => undefined);
    } catch (e) {
      setRMsg(errText(e));
    }
    reciteListen.current = null;
    if (!heard.length) { setRPhase('idle'); setRMsg((m) => (m.startsWith('Heard') || m === 'Listening' ? 'Nothing heard' : m)); return; }
    setRPhase('scoring');
    const g = gradeRecitation(verses, heard, new Set(), strictness, kit);
    setGraded(g); setGradedFor(passage); setRPhase('done');
    setRMsg(`Scored ${Math.round(g.result.score * 100)}%`);
  };
  const reciteStop = () => { if (reciteListen.current) void service.stopListening(reciteListen.current); };

  // ---- hands-free ----
  const [hf, setHf] = useState<ReciteStateView | null>(null);
  const loopRef = useRef<HandsFreeLoop | null>(null);
  const hfStart = () => {
    void loopRef.current?.dispose();
    mic.resetRecording();
    if (useFake) rewind();
    const loop = new HandsFreeLoop({
      reciteId: 'harness',
      speech: service,
      now: () => Date.now(),
      kitFor,
      biasLevel: 'names',
      rng: Math.random,
      settings: () => ({ ...DEFAULT_RECITE_SETTINGS, strictness }),
      mode: 'handsfree',
      source: 'passage',
      nextCard: async (exclude) => {
        const left = PASSAGES.filter((x) => !exclude.includes(x.id));
        const next = left.find((x) => x.id === passageId) ?? left[0];
        return next ? cardOf(next, left.length - 1) : null;
      },
      record: async (_card, g) => ({ level: 1, nextDueAt: null, passageWellLearned: g.attempt.score >= 0.95 }),
      emit: setHf,
    });
    loopRef.current = loop;
    loop.start();
  };
  const hfControl = (a: ReciteAction) => loopRef.current?.control(a);
  const hfDone = hf?.phase === 'done' || hf?.phase === 'summary';
  useEffect(() => () => { void loopRef.current?.dispose(); }, []);

  // ---- bench ----
  const [bench, setBench] = useState<BenchResult | null>(null);
  const [benchMsg, setBenchMsg] = useState('');
  const [benchBusy, setBenchBusy] = useState(false);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const doBench = useCallback(async (): Promise<BenchResult> => {
    setBenchBusy(true); setBench(null);
    try {
      const choice = await p.services.choice();
      const r = await runBench({
        engine, modelId: choice.model, device: choice.device, clips: clipsRef.current,
        load: () => service.prepareModel(choice.model, () => undefined, new AbortController().signal),
        onStep: setBenchMsg,
      });
      setBench(r); setBenchMsg('Done');
      void refresh();
      return r;
    } catch (e) {
      setBenchMsg(errText(e));
      throw e;
    } finally {
      setBenchBusy(false);
    }
  }, [engine, service, p.services, refresh]);

  useEffect(() => {
    window.__speechHarness = {
      loadWav: (url, ref) => loadUrl(url, ref),
      setFakeMic: setUseFake,
      runBench: doBench,
      services: p.services,
    };
  }, [loadUrl, doBench, p.services]);
  useEffect(() => { if (p.autoBench) void doBench().catch(() => undefined); }, []);

  // ---- fixture export ----
  const [voice, setVoice] = useState('mic');
  const [kind, setKind] = useState<FixtureKind>('correct');
  const [exported, setExported] = useState('');
  const doExport = () => {
    const samples = mic.recording();
    if (!samples.length) { setExported('Nothing recorded yet: run a recite or mic test first.'); return; }
    const text = versesOf(passage).flatMap((v) => v.words).join(' ');
    const e = exportFixture(samples, { ref: passage.reference, voice, text, kind });
    setExported(`Saved ${e.file} (${(samples.length / 16000).toFixed(1)} s)`);
  };

  const chosenId = useMemo(() => models.find((m) => m.chosen)?.id, [models]);
  const pct = (pr: NonNullable<Progress>) => (pr.total ? Math.min(100, Math.round((pr.loaded / pr.total) * 100)) : 0);

  return (
    <div>
      <h1>Speech harness</h1>
      <p class="sub">On-device speech recognition: Whisper in a worker, nothing leaves this browser.</p>

      <Card title="Device and model" testid="info-card" right={<Pill kind={info.Listening === 'ready' ? 'ok' : info.Listening === 'needs-download' ? 'warn' : 'bad'} testid="listen-status">{info.Listening ?? '...'}</Pill>}>
        <dl class="grid" data-testid="info">
          {Object.entries(info).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        <div class="row" style="margin-top:12px">
          <label>Model <select data-testid="pref-model" value={prefsState.model} onChange={(e) => setPref('model', (e.currentTarget as HTMLSelectElement).value)}>
            <option value="auto">auto</option><option value="base">base</option><option value="tiny">tiny</option></select></label>
          <label>Device <select data-testid="pref-device" value={prefsState.device} onChange={(e) => setPref('device', (e.currentTarget as HTMLSelectElement).value)}>
            <option value="auto">auto</option><option value="webgpu">webgpu</option><option value="wasm">wasm</option></select></label>
        </div>
      </Card>

      <Card title="Model download" testid="models-card">
        <table>
          <thead><tr><th>Model</th><th>Size</th><th>State</th><th></th></tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} data-testid={`model-${m.id}`}>
                <td>{m.label}{m.id === chosenId && <> <Pill>chosen</Pill></>}</td>
                <td>{mb(m.downloadBytes)}</td>
                <td><Pill kind={m.installed ? 'ok' : undefined} testid={`model-state-${m.id}`}>{m.installed ? 'installed' : 'not installed'}</Pill></td>
                <td>
                  <div class="row">
                    <button class="primary" data-testid={`download-${m.id}`} disabled={!!busyModel} onClick={() => void load(m.id as WhisperModelId)}>{m.installed ? 'Load' : 'Download'}</button>
                    <button data-testid={`delete-${m.id}`} disabled={!!busyModel || !m.installed} onClick={() => void removeModel(m.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {busyModel && (
          <div class="row" style="margin-top:12px" data-testid="progress">
            <span class="muted">{progress?.phase === 'download' ? 'Downloading' : progress?.phase === 'load' ? 'Loading model' : 'Working'}</span>
            <div class="bar"><i style={`width:${progress ? pct(progress) : 0}%`} /></div>
            <span>{progress ? (progress.phase === 'download' ? `${mb(progress.loaded)} / ${mb(progress.total)}` : `${progress.loaded} / ${progress.total}`) : ''}</span>
            <button data-testid="cancel-download" onClick={cancelModel}>Cancel</button>
          </div>
        )}
        {modelError && <p class="err" data-testid="model-error">{modelError}</p>}
      </Card>

      <Card title="Microphone" testid="mic-card" right={<Pill kind={useFake ? 'warn' : undefined} testid="mic-source">{useFake ? 'fake mic' : 'live mic'}</Pill>}>
        <div class="row">
          <label class="sw"><input type="checkbox" data-testid="fake-mic-toggle" checked={useFake} disabled={!clip} onChange={(e) => setUseFake((e.currentTarget as HTMLInputElement).checked)} /> Fake mic (play a WAV)</label>
          <input type="file" accept=".wav,audio/wav" multiple data-testid="wav-file" onChange={(e) => void onFiles(e)} />
          <button data-testid="fake-mic-rewind" disabled={!clip} onClick={rewind}>Rewind</button>
        </div>
        {clips.length > 0 && (
          <div style="margin-top:10px">
            <div class="row">
              {clips.map((c, i) => <button key={i} class="chip" aria-pressed={i === clipIx} data-testid={`clip-${i}`} onClick={() => setClipIx(i)}>{c.name} ({c.seconds.toFixed(1)} s)</button>)}
            </div>
            <div class="row" style="margin-top:8px">
              <input type="text" style="flex:1;min-width:220px" placeholder="Reference text for this clip (optional, for the WER)" data-testid="clip-ref" value={clip?.ref ?? ''} onInput={(e) => setRef((e.currentTarget as HTMLInputElement).value)} />
            </div>
          </div>
        )}
        {clipError && <p class="err" data-testid="clip-error">{clipError}</p>}
        <div class="row" style="margin-top:14px">
          <button class="primary" data-testid="mic-test" disabled={micBusy} onClick={() => void micTest()}>Test microphone</button>
          <button data-testid="mic-test-stop" disabled={!micBusy} onClick={micStop}>Stop</button>
          <div class="bar meter" data-testid="mic-meter" data-db={Math.round(level)}><i style={`width:${Math.max(0, Math.min(100, ((level + 70) / 60) * 100))}%`} /></div>
          <span class="muted" style="min-width:64px">{level > -99 ? `${Math.round(level)} dB` : 'idle'}</span>
        </div>
        {micMsg && <p class="muted" data-testid="mic-message">{micMsg}</p>}
        {micText && <p data-testid="mic-transcript">{micText}</p>}
      </Card>

      <Card title="Recite" testid="recite-card" right={<Pill testid="recite-phase">{rPhase}</Pill>}>
        <div class="row">
          {PASSAGES.map((x) => <button key={x.id} class="chip" aria-pressed={x.id === passageId} data-testid={`passage-${x.id}`} onClick={() => setPassageId(x.id)}>{x.reference}</button>)}
        </div>
        <div class="row" style="margin-top:12px">
          <button class="primary" data-testid="recite-start" disabled={rPhase === 'listening' || rPhase === 'scoring'} onClick={() => void recite()}>Recite</button>
          <button data-testid="recite-stop" disabled={rPhase !== 'listening'} onClick={reciteStop}>Done speaking</button>
          <label>Strictness <select data-testid="strictness" value={strictness} onChange={(e) => setStrictness((e.currentTarget as HTMLSelectElement).value as typeof strictness)}>
            <option>lenient</option><option>normal</option><option>strict</option></select></label>
          <span class="muted" data-testid="recite-status">{rMsg}</span>
        </div>
        {graded && gradedFor && (
          <div data-testid="recite-result" style="margin-top:8px">
            <div class="row"><span class="score" data-testid="recite-score">{Math.round(graded.result.score * 100)}%</span>
              <span class="muted">{gradedFor.reference}</span>
              <Pill kind="ok" testid="recite-correct">{graded.result.words.filter((w) => groupOf(w.verdict) === 'correct').length} correct</Pill>
              <Pill kind="bad" testid="recite-incorrect">{graded.result.words.filter((w) => groupOf(w.verdict) === 'incorrect').length} missed or wrong</Pill></div>
            <Graded passage={gradedFor} graded={graded} />
          </div>
        )}
      </Card>

      <Card title="Hands-free" testid="handsfree-card" right={<Pill testid="hf-phase">{hf?.phase ?? 'idle'}</Pill>}>
        <p class="muted" style="margin-top:0">The passage is read out, you recite, and the result is spoken back, using the memory module's loop with in-memory storage.</p>
        <div class="row">
          <button class="primary" data-testid="hf-start" onClick={hfStart}>Start hands-free</button>
          {(['repeat', 'hint', 'skip', 'pause', 'resume', 'stop'] as ReciteAction[]).map((a) => <button key={a} data-testid={`hf-${a}`} disabled={!hf || hfDone} onClick={() => hfControl(a)}>{a}</button>)}
        </div>
        {hf && (
          <div style="margin-top:10px">
            <div data-testid="hf-message"><strong>{hf.reference}</strong> <span class="muted">{hf.message}</span></div>
            {hf.error && <p class="err" data-testid="hf-error">{hf.error.message}</p>}
            {hf.result && hf.verses && (
              <div data-testid="hf-result">
                <span class="score">{Math.round(hf.result.score * 100)}%</span>
                <div class="passage">
                  {hf.verses.flatMap((v) => v.words).map((w, i) => <span key={i} class={`w ${hf.result!.words[i]?.verdict ?? 'missed'}`} data-testid="hf-word" data-verdict={hf.result!.words[i]?.verdict}>{w}</span>)}
                </div>
              </div>
            )}
            <div class="muted">Done {hf.done}, remaining {hf.remaining}</div>
          </div>
        )}
      </Card>

      <Card title="Bench" testid="bench-card" right={<span class="muted" data-testid="bench-status">{benchMsg}</span>}>
        <div class="row">
          <button class="primary" data-testid="bench-run" disabled={benchBusy} onClick={() => void doBench().catch(() => undefined)}>Run bench</button>
          <span class="muted">Loads the model, then decodes {clips.length} clip{clips.length === 1 ? '' : 's'} (add WAVs above).</span>
          {bench && <button data-testid="bench-copy" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(bench, null, 2))}>Copy JSON</button>}
          {bench && <button data-testid="bench-save" onClick={() => download('speech-bench.json', JSON.stringify(bench, null, 2), 'application/json')}>Save JSON</button>}
        </div>
        {bench && <pre data-testid="bench-json">{JSON.stringify(bench, null, 2)}</pre>}
      </Card>

      <Card title="Export fixture" testid="fixture-card">
        <p class="muted" style="margin-top:0">Saves the audio of the last recite or mic test (16 kHz mono WAV) with its fixtures.json entry, for the selected passage ({passage.reference}).</p>
        <div class="row">
          <label>Voice <input type="text" style="width:130px" data-testid="fixture-voice" value={voice} onInput={(e) => setVoice((e.currentTarget as HTMLInputElement).value)} /></label>
          <label>Kind <select data-testid="fixture-kind" value={kind} onChange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as FixtureKind)}>
            <option>correct</option><option>skip</option><option>swap</option></select></label>
          <button data-testid="fixture-export" onClick={doExport}>Export fixture</button>
        </div>
        {exported && <p class="muted" data-testid="fixture-message">{exported}</p>}
      </Card>
    </div>
  );
}
