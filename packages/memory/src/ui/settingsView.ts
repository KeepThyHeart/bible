/**
 * Settings tab (A8): the Lists section (drawn by `listsView.ts`, handed in by mount), then Answering
 * (with the verses that override the answer mode), Recite aloud, Reminders, and the old-extension import.
 * Fields use the shared `.kth-*` form classes via `settingsFields.ts`. No screen
 * title of its own (the tab names it): the first section heading is the focus target.
 *
 * Task 0004's review chose a Settings screen inside the panel over the host's
 * Preferences (`contributes.configuration`) specifically because it sits next
 * to the per-verse override on the verse page - a global-only Preferences
 * page could not show "3 verses have their own setting" at all.
 */

import { reciteEnabled } from '../core/features';
import type { AnswerMode, PlanView, ReciteSettings, SettingsView, SpeechAvailability } from '../core/types';
import type { PushSettingsView } from '../core/pushTypes';
import { renderPushSettings } from './pushSettingsView';
import { button, el } from './dom';
import { modal } from './components';
import type { PanelHost } from './host';
import type { MemoryImportResult, MemoryImportStatus } from '../core/api';
import { tr } from './i18n';
import { actionsRow, checkField, hint, radioField, selectField, settingsSection } from './settingsFields';

export function renderSettings(
  host: PanelHost,
  settings: SettingsView,
  plan: PlanView,
  push: PushSettingsView | null = null,
  legacy: LegacyImportControl | null = null,
  lists: HTMLElement | null = null,
): HTMLElement {
  const root = el('section', { class: 'sm-screen sm-screen-settings' });
  if (lists) root.appendChild(lists);

  root.appendChild(
    settingsSection(tr('memory.ui.settings.answering', 'Answering'), { class: 'sm-block-answering' }, [
      renderAnswerModeGroup(host, settings.defaultAnswerMode),
      renderMoveOnToggle(host, settings.autoAdvance !== false),
      renderOverrides(host, plan),
    ]),
  );

  // `recite`/`speech` are absent on a host that predates Recite aloud.
  // The speech value is the cached one (mount passes it; `updateSpeechBanner` applies later pushes).
  const speech = settings.speech ?? plan.speech;
  if (reciteEnabled() && settings.recite && speech) root.appendChild(renderReciteSettings(host, settings.recite, speech));

  if (push) root.appendChild(renderPushSettings(host, push));

  const legacySection = legacyImportSection(host, legacy);
  if (legacySection) root.appendChild(legacySection);

  return root;
}

/** "Move on automatically" (R2 auto-advance, default on): a persisted setting, saved on change. */
function renderMoveOnToggle(host: PanelHost, on: boolean): HTMLElement {
  return checkField({
    id: 'sm-move-on',
    class: 'sm-move-on',
    label: tr('memory.ui.settings.moveOn', 'Move on automatically'),
    hint: tr('memory.ui.settings.moveOnHintAll', 'Go to the next question or verse by itself after a few seconds (a little longer after mistakes). You can stop it any time.'),
    checked: on,
    onChange: (input) => {
      const wanted = input.checked;
      void host.request({ type: 'setAutoAdvance', on: wanted }).then((reply) => {
        if (!reply.ok) {
          input.checked = !wanted;
          host.announce(reply.error);
        }
      });
    },
  }).field;
}

/**
 * Replaces the speech banner of an already drawn settings screen when a push
 * brings a new availability (no re-fetch, no redraw). No-op without the Recite section.
 */
export function updateSpeechBanner(root: ParentNode, host: PanelHost, speech: SpeechAvailability): void {
  const old = root.querySelector('.sm-block-recite > [data-speech-state]');
  if (old) old.replaceWith(availabilityBanner(speech, host));
}

function renderAnswerModeGroup(host: PanelHost, current: AnswerMode): HTMLElement {
  return radioField({
    legend: tr('memory.ui.settings.answerWith', 'Answer with'),
    name: 'sm-answer-mode-default',
    current,
    options: [
      { value: 'firstLetter', id: 'sm-answer-firstLetter', label: tr('memory.ui.settings.firstLetterOfEachWord', 'First letter of each word'), aside: tr('memory.ui.settings.quick', '(quick)') },
      { value: 'fullWord', id: 'sm-answer-fullWord', label: tr('memory.ui.settings.fullWordExactSpelling', 'Full word, exact spelling') },
    ],
    hint: tr('memory.ui.settings.capitalsNeverCount', 'Capitals and punctuation never count.'),
    onChange: (value) => {
      void host.request({ type: 'setDefaultAnswerMode', mode: value as AnswerMode }).then((reply) => {
        if (!reply.ok) host.announce(reply.error);
      });
    },
  });
}

/** "Verses with their own setting": a sub-part of Answering (the per-verse override of the answer mode). */
function renderOverrides(host: PanelHost, plan: PlanView): HTMLElement {
  const overridden = plan.passages.filter((pv) => pv.passage.answerMode !== null);

  return el('div', { class: 'sm-settings-subsection sm-settings-overrides' }, [
    el('h3', { class: 'sm-settings-subheading', text: tr('memory.ui.settings.versesWithOwnSetting', 'Verses with their own setting') }),
    overridden.length === 0
      ? hint(tr('memory.ui.settings.noneYetChangeOneOnVersePage', 'None yet. Change one from its verse page.'))
      : el(
          'ul',
          { class: 'sm-settings-list' },
          overridden.map((pv) =>
            el('li', { class: 'sm-settings-list-row' }, [
              el('span', { class: 'sm-settings-list-name', text: pv.passage.reference }),
              el('span', {
                class: 'sm-settings-list-meta',
                text: pv.passage.answerMode === 'fullWord' ? tr('memory.ui.settings.fullWord', 'Full word') : tr('memory.ui.settings.firstLetter', 'First letter'),
              }),
              button(tr('memory.ui.settings.change', 'Change'), () => host.go({ type: 'goVerse', passageId: pv.passage.id }), {
                class: 'kth-btn kth-btn--ghost kth-btn--sm',
              }),
            ]),
          ),
        ),
  ]);
}

// ---------------------------------------------------------------------------
// Recite aloud
// ---------------------------------------------------------------------------

export function permissionMissingText(): string {
  return tr('memory.ui.settings.permissionMissing', "Memory needs microphone access to listen while you recite. Allow it in the app's settings.");
}

/** The banner text for each availability state, or null when all is well. */
export function availabilityMessage(speech: SpeechAvailability): string | null {
  switch (speech.state) {
    case 'ready':
      return null;
    case 'permission-missing':
      return speech.missingPermissions.length > 0 && !speech.missingPermissions.includes('speech:listen')
        ? tr('memory.ui.settings.handsFreeNeedsSpeak', "Hands-free mode also needs the app to speak. Allow it in the app's settings.")
        : permissionMissingText();
    case 'needs-download':
      return tr('memory.ui.settings.needsDownload', "The speech model needs to be downloaded before you can recite aloud. Download it in the main app's speech settings.");
    case 'unavailable':
      return tr('memory.ui.settings.speechUnavailable', 'Speech recognition is not available on this device right now.');
    case 'unsupported-language':
      return tr('memory.ui.settings.unsupportedLanguage', "Reciting aloud is not available for this Bible translation's language yet.");
    case 'host-too-old':
      return tr('memory.ui.settings.hostTooOld', 'This version of the app does not support reciting aloud. Update the app to use it.');
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
    tr('memory.ui.settings.openSettings', 'Open settings'),
    () => void host.request({ type: 'openHostSettings' }).then((r) => { if (!r.ok) host.announce(r.error); }),
    { class: 'sm-btn sm-btn-small' },
  );
}

export function availabilityBanner(speech: SpeechAvailability, host?: PanelHost): HTMLElement {
  if (speech.unknown) {
    // Not probed yet: a neutral state, never a guess ("needs to be downloaded").
    return el('p', {
      class: 'sm-banner',
      text: tr('memory.ui.settings.speechChecking', 'Checking speech recognition...'),
      attrs: { role: 'status', 'data-speech-state': 'checking' },
    });
  }
  const msg = availabilityMessage(speech);
  if (msg === null) {
    const where = speech.onDevice ? tr('memory.ui.settings.onThisDevice', 'on this device') : tr('memory.ui.settings.online', 'online');
    const label = speech.engineLabel ? tr('memory.ui.settings.engineWhere', '{engine}, {where}', { engine: speech.engineLabel, where }) : where;
    return el('p', {
      class: 'sm-banner sm-banner-ok',
      text: speech.handsFree
        ? tr('memory.ui.settings.readyToListenHandsFree', 'Ready to listen ({label}). Hands-free mode is available.', { label })
        : tr('memory.ui.settings.readyToListen', 'Ready to listen ({label}).', { label }),
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

  function select<K extends keyof ReciteSettings>(
    key: K,
    id: string,
    label: string,
    options: { value: string; label: string }[],
    current: string,
    parse: (v: string) => ReciteSettings[K],
  ): HTMLElement {
    return selectField({ id, label, options, current, onChange: (v) => save({ [key]: parse(v) } as Partial<ReciteSettings>) });
  }

  function checkbox(key: 'readBack' | 'autoAdvance' | 'voiceCommands', id: string, label: string, hintText: string): HTMLElement {
    return checkField({
      id,
      label,
      hint: hintText,
      checked: recite[key],
      onChange: (input) => save({ [key]: input.checked } as Partial<ReciteSettings>),
    }).field;
  }

  const delayOptions = HINT_DELAYS_MS.includes(recite.hintDelayMs) ? HINT_DELAYS_MS : [...HINT_DELAYS_MS, recite.hintDelayMs].sort((a, b) => a - b);

  return settingsSection(tr('memory.ui.settings.reciteAloud', 'Recite aloud'), { class: 'sm-block-recite' }, [
    availabilityBanner(speech, host),
    el('div', { class: 'sm-settings-grid' }, [
      select('strictness', 'sm-recite-strictness', tr('memory.ui.settings.strictness', 'Strictness'), [
        { value: 'lenient', label: tr('memory.ui.settings.lenient', 'Lenient (small slips are fine)') },
        { value: 'normal', label: tr('memory.ui.settings.normal', 'Normal') },
        { value: 'strict', label: tr('memory.ui.settings.strict', 'Strict (word for word)') },
      ], recite.strictness, (v) => v as ReciteSettings['strictness']),
      select('promptStyle', 'sm-recite-prompt', tr('memory.ui.settings.prompt', 'Prompt'), [
        { value: 'reference', label: tr('memory.ui.settings.referenceOnly', 'Reference only') },
        { value: 'reference+opening', label: tr('memory.ui.settings.referenceAndOpeningWords', 'Reference and opening words') },
      ], recite.promptStyle, (v) => v as ReciteSettings['promptStyle']),
      select('reciteReference', 'sm-recite-reference', tr('memory.ui.settings.reciteReference', 'Say the reference'), [
        { value: 'off', label: tr('memory.ui.settings.refOff', 'No') },
        { value: 'before', label: tr('memory.ui.settings.refBeforeOption', 'Before the verse') },
        { value: 'after', label: tr('memory.ui.settings.refAfterOption', 'After the verse') },
        { value: 'both', label: tr('memory.ui.settings.refBothOption', 'Before and after') },
      ], recite.reciteReference, (v) => v as ReciteSettings['reciteReference']),
      select('feedback', 'sm-recite-feedback', tr('memory.ui.settings.feedback', 'Feedback'), [
        { value: 'brief', label: tr('memory.ui.settings.brief', 'Brief') },
        { value: 'full', label: tr('memory.ui.settings.fullQuoteMissed', 'Full (quote what was missed)') },
      ], recite.feedback, (v) => v as ReciteSettings['feedback']),
      select('hintDelayMs', 'sm-recite-hintdelay', tr('memory.ui.settings.hintAfterSilence', 'Hint after silence'),
        delayOptions.map((ms) => ({ value: String(ms), label: tr('memory.ui.settings.seconds', '{seconds} seconds', { seconds: ms / 1000 }) })),
        String(recite.hintDelayMs), (v) => Number(v)),
    ]),
    checkbox('readBack', 'sm-recite-readback', tr('memory.ui.settings.readBack', 'Read back'), tr('memory.ui.settings.readBackHintVerse', 'Speak the verse after scoring.')),
    checkbox('autoAdvance', 'sm-recite-auto', tr('memory.ui.settings.autoAdvance', 'Auto-advance'), tr('memory.ui.settings.autoAdvanceHintVerse', 'Move to the next verse by itself in hands-free mode.')),
    checkbox('voiceCommands', 'sm-recite-voice', tr('memory.ui.settings.voiceCommands', 'Voice commands'), tr('memory.ui.settings.voiceCommandsHint', 'Say "hint", "repeat", "skip" or "stop".')),
    renderDeleteHistory(host),
  ]);
}

/** The one destructive action on the screen, set apart at the end of Recite aloud behind a confirmation. */
function renderDeleteHistory(host: PanelHost): HTMLElement {
  const status = el('p', { class: 'sm-settings-status', attrs: { 'aria-live': 'polite' } });

  const confirmButton = button(tr('memory.ui.settings.delete', 'Delete'), () => {
    void host.request({ type: 'deleteReciteHistory' }).then((reply) => {
      dialog.close();
      status.textContent = reply.ok ? tr('memory.ui.settings.historyDeleted', 'Recitation history deleted.') : reply.error;
      if (!reply.ok) host.announce(reply.error);
    });
  }, { class: 'sm-btn sm-btn-danger' });

  const dialog = modal({
    title: tr('memory.ui.settings.deleteHistoryTitle', 'Delete recitation history?'),
    body: [
      el('p', {
        text: tr('memory.ui.settings.deleteHistoryBody', 'This removes the word-by-word detail saved from your recitations. Your scores and review schedule are kept.'),
      }),
    ],
    actions: [button(tr('memory.ui.settings.cancel', 'Cancel'), () => dialog.close(), { class: 'sm-btn sm-btn-quiet' }), confirmButton],
  });

  return el('div', { class: 'sm-settings-danger' }, [
    actionsRow([
      button(tr('memory.ui.settings.deleteRecitationHistory', 'Delete recitation history'), () => dialog.open(), {
        class: 'kth-btn kth-btn--sm sm-settings-danger-btn',
        attrs: { 'aria-describedby': 'sm-recite-delete-hint' },
      }),
    ]),
    hint(tr('memory.ui.settings.scoresKept', 'Scores and your schedule are kept.'), { id: 'sm-recite-delete-hint' }),
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
      return tr('memory.ui.settings.legacyImportedVerses', 'Your verses from the Scripture Memory extension were brought over automatically.');
    case 'merged':
      return tr('memory.ui.settings.legacyMerged', 'Data from the Scripture Memory extension has been imported.');
    case 'skipped-not-empty':
      return tr('memory.ui.settings.legacySkippedVerses', 'Your Scripture Memory extension data was not brought over automatically, because Memory already had verses. Import it to add it to them.');
    default:
      return tr('memory.ui.settings.legacyOnComputer', 'Data from the Scripture Memory extension is on this computer.');
  }
}

/** Summary of a manual import, for the status line. */
export function legacyResultText(result: MemoryImportResult): string {
  if (result.status !== 'merged') return tr('memory.ui.settings.nothingToImport', 'There was nothing to import.');
  const verses = result.added.memory_passage ?? 0;
  const attempts = result.added.memory_attempt ?? 0;
  if (verses === 0 && attempts === 0 && result.revived === 0) return tr('memory.ui.settings.everythingHere', 'Everything from the extension is already here.');
  const parts = [
    tr('memory.ui.settings.importVerses', '{count, plural, one {# verse} other {# verses}}', { count: verses }),
    tr('memory.ui.settings.importRecords', '{count, plural, one {# practice record} other {# practice records}}', { count: attempts }),
  ];
  if (result.revived > 0) parts.push(tr('memory.ui.settings.importRestoredVerses', '{count, plural, one {# removed verse restored} other {# removed verses restored}}', { count: result.revived }));
  return tr('memory.ui.settings.importedList', 'Imported {list}.', { list: parts.join(', ') });
}

/**
 * Settings section: "Import data from the old Scripture Memory extension".
 * Shown only when that extension's database is on this computer. The import
 * merges and never overwrites, so running it twice is harmless.
 */
export function legacyImportSection(host: PanelHost, legacy: LegacyImportControl | null): HTMLElement | null {
  if (!legacy || !legacy.status.sourceAvailable) return null;
  const action = button(tr('memory.ui.settings.importButton', 'Import data from the old Scripture Memory extension'), () => {
    action.setAttribute('disabled', '');
    void legacy
      .run()
      .then((result) => {
        host.announce(legacyResultText(result));
        host.reload();
      })
      .catch((err: unknown) => host.announce(err instanceof Error ? err.message : String(err)))
      .finally(() => action.removeAttribute('disabled'));
  }, { class: 'kth-btn' });
  return settingsSection(tr('memory.ui.settings.legacyTitle', 'Scripture Memory extension'), { class: 'sm-legacy-import' }, [
    hint(legacyStatusText(legacy.status)),
    hint(tr('memory.ui.settings.importingAdds', 'Importing adds what is missing and never changes what you already have.')),
    actionsRow([action]),
  ]);
}
