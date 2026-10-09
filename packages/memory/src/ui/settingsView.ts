/**
 * Settings: the one global preference this extension has, plus a look at
 * which passages have overridden it.
 *
 * Task 0004's review chose a Settings screen inside the panel over the host's
 * Preferences (`contributes.configuration`) specifically because it sits next
 * to the per-passage override on the passage screen - a global-only Preferences
 * page could not show "3 passages have their own setting" at all.
 */

import type { AnswerMode, PlanView, ReciteSettings, SettingsView, SpeechAvailability } from '../core/types';
import type { PushSettingsView } from '../core/pushTypes';
import { renderPushSettings } from './pushSettingsView';
import { button, el } from './dom';
import { breadcrumb, modal } from './components';
import type { PanelHost } from './host';
import type { MemoryImportResult, MemoryImportStatus } from '../core/api';

export function renderSettings(
  host: PanelHost,
  settings: SettingsView,
  plan: PlanView,
  push: PushSettingsView | null = null,
  legacy: LegacyImportControl | null = null,
): HTMLElement {
  const root = el('section', { class: 'sm-screen sm-screen-settings' });

  root.appendChild(breadcrumb({ crumbs: [{ label: 'Home', onClick: () => host.go({ type: 'goPlan' }) }, { label: 'Settings' }] }));

  root.appendChild(
    el('section', { class: 'sm-block' }, [
      el('h2', { class: 'sm-block-title', text: 'Answering blanks' }),
      renderAnswerModeGroup(host, settings.defaultAnswerMode),
      el('p', { class: 'sm-hint', text: 'Capitals and punctuation never count.' }),
    ]),
  );

  // `recite`/`speech` are absent on a host that predates Recite aloud.
  if (settings.recite && settings.speech) root.appendChild(renderReciteSettings(host, settings.recite, settings.speech));

  root.appendChild(renderOverrides(host, plan));

  if (push) root.appendChild(renderPushSettings(host, push));

  const legacySection = legacyImportSection(host, legacy);
  if (legacySection) root.appendChild(legacySection);

  return root;
}

function renderAnswerModeGroup(host: PanelHost, current: AnswerMode): HTMLElement {
  const name = 'sm-answer-mode-default';

  function radio(value: AnswerMode, label: string, hint: string | null): HTMLElement {
    const id = `sm-answer-${value}`;
    const input = el('input', { id, type: 'radio', attrs: { name, value } }) as HTMLInputElement;
    input.checked = current === value;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      void host.request({ type: 'setDefaultAnswerMode', mode: value }).then((reply) => {
        if (!reply.ok) host.announce(reply.error);
      });
    });

    return el('div', { class: 'sm-radio-row' }, [
      input,
      el('label', { attrs: { for: id } }, [
        el('span', { class: 'sm-radio-label', text: label }),
        hint ? el('span', { class: 'sm-hint', text: ` ${hint}` }) : null,
      ]),
    ]);
  }

  return el('div', { class: 'sm-radio-group' }, [
    radio('firstLetter', 'First letter of each word', '(quick)'),
    radio('fullWord', 'Full word, exact spelling', null),
  ]);
}

function renderOverrides(host: PanelHost, plan: PlanView): HTMLElement {
  const overridden = plan.passages.filter((pv) => pv.passage.answerMode !== null);

  return el('section', { class: 'sm-block' }, [
    el('h2', { class: 'sm-block-title', text: 'Passages with their own setting' }),
    overridden.length === 0
      ? el('p', {
          class: 'sm-block-caption',
          text: 'None yet. Change one from its own passage screen.',
        })
      : el(
          'ul',
          { class: 'sm-list' },
          overridden.map((pv) =>
            el('li', { class: 'sm-row' }, [
              el('span', { class: 'sm-row-ref', text: pv.passage.reference }),
              el('span', {
                class: 'sm-row-meta',
                text: pv.passage.answerMode === 'fullWord' ? 'Full word' : 'First letter',
              }),
              button('Change', () => host.go({ type: 'goPassage', passageId: pv.passage.id }), {
                class: 'sm-btn sm-btn-small sm-btn-quiet',
              }),
            ]),
          ),
        ),
    el('p', {
      class: 'sm-block-caption',
      text: '(Change it on each passage\'s screen.)',
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Recite aloud
// ---------------------------------------------------------------------------

export const PERMISSION_MISSING_TEXT =
  'Memory needs microphone access to listen while you recite. Allow it in the app\'s settings.';

/** The banner text for each availability state, or null when all is well. */
export function availabilityMessage(speech: SpeechAvailability): string | null {
  switch (speech.state) {
    case 'ready':
      return null;
    case 'permission-missing':
      return speech.missingPermissions.length > 0 && !speech.missingPermissions.includes('speech:listen')
        ? 'Hands-free mode also needs the app to speak. Allow it in the app\'s settings.'
        : PERMISSION_MISSING_TEXT;
    case 'needs-download':
      return 'The speech model needs to be downloaded before you can recite aloud. Download it in the main app\'s speech settings.';
    case 'unavailable':
      return 'Speech recognition is not available on this device right now.';
    case 'unsupported-language':
      return 'Reciting aloud is not available for this Bible translation\'s language yet.';
    case 'host-too-old':
      return 'This version of the app does not support reciting aloud. Update the app to use it.';
  }
}

/**
 * A button that opens the host's settings (`openHostSettings`), only when the
 * state is a missing permission. A built-in module is granted everything, so
 * on desktop this shows only if a host ever withholds speech.
 */
export function permissionSettingsButton(host: PanelHost, speech: SpeechAvailability): HTMLElement | null {
  if (speech.state !== 'permission-missing') return null;
  return button(
    'Open settings',
    () => void host.request({ type: 'openHostSettings' }).then((r) => { if (!r.ok) host.announce(r.error); }),
    { class: 'sm-btn sm-btn-small' },
  );
}

export function availabilityBanner(speech: SpeechAvailability, host?: PanelHost): HTMLElement {
  const msg = availabilityMessage(speech);
  if (msg === null) {
    const where = speech.onDevice ? 'on this device' : 'online';
    const label = speech.engineLabel ? `${speech.engineLabel}, ${where}` : where;
    return el('p', {
      class: 'sm-banner sm-banner-ok',
      text: `Ready to listen (${label}).${speech.handsFree ? ' Hands-free mode is available.' : ''}`,
      attrs: { role: 'status', 'data-speech-state': speech.state },
    });
  }
  const action = host ? permissionSettingsButton(host, speech) : null;
  return el('div', { class: 'sm-banner sm-banner-warn', attrs: { role: 'status', 'data-speech-state': speech.state } }, [
    el('p', { text: msg }),
    action,
  ]);
}

const HINT_DELAYS_MS = [3000, 5000, 8000, 12000];

export function renderReciteSettings(host: PanelHost, recite: ReciteSettings, speech: SpeechAvailability): HTMLElement {
  function save(patch: Partial<ReciteSettings>): void {
    void host.request({ type: 'setReciteSettings', patch }).then((reply) => {
      if (!reply.ok) host.announce(reply.error);
    });
  }

  function field(id: string, label: string, control: HTMLElement): HTMLElement {
    return el('div', { class: 'sm-setting-row' }, [
      el('label', { class: 'sm-label-inline', attrs: { for: id }, text: label }),
      control,
    ]);
  }

  function select<K extends keyof ReciteSettings>(
    key: K,
    id: string,
    options: { value: string; label: string }[],
    current: string,
    parse: (v: string) => ReciteSettings[K],
  ): HTMLSelectElement {
    const sel = el('select', { class: 'sm-select', id }) as HTMLSelectElement;
    for (const o of options) {
      const opt = el('option', { value: o.value, text: o.label }) as HTMLOptionElement;
      if (o.value === current) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => save({ [key]: parse(sel.value) } as Partial<ReciteSettings>));
    return sel;
  }

  function checkbox(key: 'readBack' | 'autoAdvance' | 'voiceCommands', id: string, label: string, hint: string): HTMLElement {
    const input = el('input', { id, type: 'checkbox' }) as HTMLInputElement;
    input.checked = recite[key];
    input.addEventListener('change', () => save({ [key]: input.checked } as Partial<ReciteSettings>));
    return el('div', { class: 'sm-radio-row' }, [
      input,
      el('label', { attrs: { for: id } }, [
        el('span', { class: 'sm-radio-label', text: label }),
        el('span', { class: 'sm-hint', text: ` ${hint}` }),
      ]),
    ]);
  }

  const delayOptions = HINT_DELAYS_MS.includes(recite.hintDelayMs) ? HINT_DELAYS_MS : [...HINT_DELAYS_MS, recite.hintDelayMs].sort((a, b) => a - b);

  return el('section', { class: 'sm-block sm-block-recite' }, [
    el('h2', { class: 'sm-block-title', text: 'Recite aloud' }),
    availabilityBanner(speech, host),
    field('sm-recite-strictness', 'Strictness', select('strictness', 'sm-recite-strictness', [
      { value: 'lenient', label: 'Lenient (small slips are fine)' },
      { value: 'normal', label: 'Normal' },
      { value: 'strict', label: 'Strict (word for word)' },
    ], recite.strictness, (v) => v as ReciteSettings['strictness'])),
    field('sm-recite-prompt', 'Prompt', select('promptStyle', 'sm-recite-prompt', [
      { value: 'reference', label: 'Reference only' },
      { value: 'reference+opening', label: 'Reference and opening words' },
    ], recite.promptStyle, (v) => v as ReciteSettings['promptStyle'])),
    field('sm-recite-feedback', 'Feedback', select('feedback', 'sm-recite-feedback', [
      { value: 'brief', label: 'Brief' },
      { value: 'full', label: 'Full (quote what was missed)' },
    ], recite.feedback, (v) => v as ReciteSettings['feedback'])),
    checkbox('readBack', 'sm-recite-readback', 'Read back', 'Speak the passage after scoring.'),
    checkbox('autoAdvance', 'sm-recite-auto', 'Auto-advance', 'Move to the next passage by itself in hands-free mode.'),
    checkbox('voiceCommands', 'sm-recite-voice', 'Voice commands', 'Say "hint", "repeat", "skip" or "stop".'),
    field('sm-recite-hintdelay', 'Hint after silence', select('hintDelayMs', 'sm-recite-hintdelay',
      delayOptions.map((ms) => ({ value: String(ms), label: `${ms / 1000} seconds` })),
      String(recite.hintDelayMs), (v) => Number(v))),
    renderDeleteHistory(host),
  ]);
}

function renderDeleteHistory(host: PanelHost): HTMLElement {
  const status = el('div', { class: 'sm-error-slot', attrs: { 'aria-live': 'polite' } });

  const confirmButton = button('Delete', () => {
    void host.request({ type: 'deleteReciteHistory' }).then((reply) => {
      dialog.close();
      status.textContent = reply.ok ? 'Recitation history deleted.' : reply.error;
      if (!reply.ok) host.announce(reply.error);
    });
  }, { class: 'sm-btn sm-btn-danger' });

  const dialog = modal({
    title: 'Delete recitation history?',
    body: [
      el('p', {
        text: 'This removes the word-by-word detail saved from your recitations. Your scores and review schedule are kept.',
      }),
    ],
    actions: [button('Cancel', () => dialog.close(), { class: 'sm-btn sm-btn-quiet' }), confirmButton],
  });

  return el('div', { class: 'sm-setting-row' }, [
    button('Delete recitation history', () => dialog.open(), { class: 'sm-btn sm-btn-danger-quiet sm-btn-small' }),
    el('span', { class: 'sm-hint', text: 'Scores and your schedule are kept.' }),
    status,
    dialog.element,
  ]);
}

// ---------------------------------------------------------------------------
// Data from the old extension (task 0114)
// ---------------------------------------------------------------------------

/** What the settings screen needs for the manual import; null hides the section. */
export interface LegacyImportControl {
  status: MemoryImportStatus;
  run(): Promise<MemoryImportResult>;
}

/** One line on what the automatic import did, for the section's caption. */
export function legacyStatusText(status: MemoryImportStatus): string {
  switch (status.status) {
    case 'imported':
      return 'Your plan from the Scripture Memory extension was brought over automatically.';
    case 'merged':
      return 'Data from the Scripture Memory extension has been imported.';
    case 'skipped-not-empty':
      return 'Your Scripture Memory extension data was not brought over automatically, because Memory already had a plan. Import it to add it to this plan.';
    default:
      return 'Data from the Scripture Memory extension is on this computer.';
  }
}

/** Summary of a manual import, for the status line. */
export function legacyResultText(result: MemoryImportResult): string {
  if (result.status !== 'merged') return 'There was nothing to import.';
  const passages = result.added.memory_passage ?? 0;
  const attempts = result.added.memory_attempt ?? 0;
  if (passages === 0 && attempts === 0 && result.revived === 0) return 'Everything from the extension is already here.';
  const parts = [`${passages} passage${passages === 1 ? '' : 's'}`, `${attempts} practice record${attempts === 1 ? '' : 's'}`];
  if (result.revived > 0) parts.push(`${result.revived} removed passage${result.revived === 1 ? '' : 's'} restored`);
  return `Imported ${parts.join(', ')}.`;
}

/**
 * Settings section: "Import data from the old Scripture Memory extension".
 * Shown only when that extension's database is on this computer. The import
 * merges and never overwrites, so running it twice is harmless.
 */
export function legacyImportSection(host: PanelHost, legacy: LegacyImportControl | null): HTMLElement | null {
  if (!legacy || !legacy.status.sourceAvailable) return null;
  const action = button('Import data from the old Scripture Memory extension', () => {
    action.setAttribute('disabled', '');
    void legacy
      .run()
      .then((result) => {
        host.announce(legacyResultText(result));
        host.reload();
      })
      .catch((err: unknown) => host.announce(err instanceof Error ? err.message : String(err)))
      .finally(() => action.removeAttribute('disabled'));
  }, { class: 'sm-btn sm-btn-small' });
  return el('section', { class: 'sm-block sm-legacy-import' }, [
    el('h2', { class: 'sm-block-title', text: 'Scripture Memory extension' }),
    el('p', { class: 'sm-block-caption', text: legacyStatusText(legacy.status) }),
    el('p', { class: 'sm-block-caption', text: 'Importing adds what is missing and never changes what you already have.' }),
    action,
  ]);
}
