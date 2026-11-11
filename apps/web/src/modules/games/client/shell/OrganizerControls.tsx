/**
 * What the organizer sees while a game runs: the round and the timer, the
 * answer only they may see, who has answered, one main button that is always
 * in the same place, and a row of smaller controls.
 *
 * One component for both organizers. A remote (not playing) passes its
 * snapshot, whose control block carries the private answer; a player who was
 * handed control passes theirs, which never does, so no answer card appears.
 * The server decides what is in the block; nothing here hides anything.
 */

import { useEffect, useState } from 'preact/hooks';
import type {
  ControlPanel as ControlPanelData,
  PlayerSnapshot,
  RemoteSnapshot,
  RevealPayload,
  Standing,
  HostCommand,
} from '../../shared/protocol.js';
import { ControlPanel, ControlRequests } from './ControlPanel.js';
import { OrganizerMenu, LookBack } from './OrganizerMenu.js';
import { TimerBar } from './TimerBar.js';
import { getGameViews } from './gameViews.js';
import { mainActionFor } from './mainAction.js';
import { gt } from './t.js';
import '../styles/organizer.css';

/** How long a reveal stays up when the organizer asks for it to move on by itself. */
export const AUTO_ADVANCE_MS = 8000;

export interface OrganizerControlsProps {
  snapshot: RemoteSnapshot | PlayerSnapshot;
  panel: ControlPanelData;
  /** The latest reveal; earlier ones are kept here for "Back". */
  reveal: RevealPayload | null;
  fullStandings: readonly Standing[] | null;
  onCommand(command: HostCommand): void;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(next: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      class="organizer-toggle"
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span class="organizer-toggle-state">
        {checked ? gt('games.organizer.on', 'On') : gt('games.organizer.off', 'Off')}
      </span>
    </button>
  );
}

export function OrganizerControls({
  snapshot,
  panel,
  reveal,
  fullStandings,
  onCommand,
}: OrganizerControlsProps) {
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [showBack, setShowBack] = useState(false);
  // The room retires a reveal as the next round arrives, so the answers
  // already seen are held here for a look back.
  const [seen, setSeen] = useState<RevealPayload[]>([]);
  useEffect(() => {
    if (reveal === null) return;
    setSeen((previous) =>
      previous.some((entry) => entry.round === reveal.round) ? previous : [...previous, reveal].slice(-2)
    );
  }, [reveal]);

  const { phase, paused, round, totalRounds, settings, chrome } = snapshot;
  const inRound = phase === 'question' || phase === 'answering';
  const counted = inRound || phase === 'reveal';
  const action = mainActionFor(snapshot);
  const earlier = [...seen].reverse().find((entry) => entry.round !== round) ?? null;

  const menu = (
    <OrganizerMenu
      players={snapshot.players}
      settings={settings}
      fullStandings={fullStandings}
      onCommand={onCommand}
      canFinish={phase !== 'summary' && phase !== 'lobby'}
    />
  );

  if (phase === 'summary' || phase === 'lobby') {
    return (
      <div class="organizer">
        <ControlRequests requests={panel.requests} onCommand={onCommand} />
        <div class="organizer-menu-row">{menu}</div>
      </div>
    );
  }

  const Slot = getGameViews(settings.gameId)?.control;

  return (
    <section class="organizer" aria-label={gt('games.organizer.controls', 'Game controls')}>
      <ControlRequests requests={panel.requests} onCommand={onCommand} />

      <div class="organizer-head">
        {counted && (
          <span>
            {settings.openEnded
              ? gt('games.organizer.roundOpen', '{word} {number}', {
                  word: chrome?.roundWord ?? gt('games.organizer.question', 'Question'),
                  number: round + 1,
                })
              : gt('games.organizer.roundOf', '{word} {number} of {total}', {
                  word: chrome?.roundWord ?? gt('games.organizer.question', 'Question'),
                  number: round + 1,
                  total: totalRounds,
                })}
          </span>
        )}
        {phase === 'reveal' && <span>{gt('games.organizer.answerShown', 'Answer shown')}</span>}
      </div>
      <TimerBar endsAt={snapshot.phaseEndsAt} durationMs={snapshot.phaseDurationMs} paused={paused} />

      {panel.answer !== null && (
        <div class="organizer-private">
          <p class="organizer-private-label">{gt('games.organizer.onlyYou', 'Only you see this')}</p>
          <p class="organizer-private-answer">
            {gt('games.organizer.answerIs', 'Answer: {answer}', { answer: panel.answer })}
          </p>
        </div>
      )}

      {inRound && chrome?.hideAnswered !== true && (
        <p class="organizer-waiting">
          {gt('games.frame.answered', 'Answered {answered} / {total}', {
            answered: panel.answeredCount,
            total: snapshot.players.length,
          })}
        </p>
      )}

      {!(Slot !== undefined && getGameViews(settings.gameId)?.controlJudges === true) && (
        <ControlPanel pendingJudge={panel.pendingJudge} onCommand={onCommand} />
      )}
      {Slot !== undefined && (
        <Slot
          // A playing organizer's own view is a phone's; the slot reads the
          // screen's, which the panel carries for exactly this.
          snapshot={snapshot.viewer === 'player' ? { ...snapshot, view: panel.screenView ?? null } : snapshot}
          send={onCommand}
        />
      )}

      {phase === 'reveal' && (
        <>
          <Toggle
            label={gt('games.organizer.autoAdvance', 'Move on by itself after 8 seconds')}
            checked={settings.autoAdvanceMs !== null}
            onChange={(next) =>
              onCommand({ cmd: 'setSettings', settings: { autoAdvanceMs: next ? AUTO_ADVANCE_MS : null } })
            }
          />
          <Toggle
            label={gt('games.organizer.scoresAfterEach', 'Show scores after each question')}
            checked={settings.scoresAfterEachAnswer}
            onChange={(next) => onCommand({ cmd: 'setSettings', settings: { scoresAfterEachAnswer: next } })}
          />
        </>
      )}

      {action !== null && (
        <button type="button" class="btn-primary organizer-main" onClick={() => onCommand(action.command)}>
          {action.label}
        </button>
      )}

      <div class="organizer-row">
        <button type="button" onClick={() => onCommand({ cmd: paused ? 'resume' : 'pause' })}>
          {paused ? gt('games.organizer.resume', 'Resume') : gt('games.organizer.pause', 'Pause')}
        </button>

        {inRound &&
          !confirmFinish &&
          (confirmSkip ? (
            <span class="confirm">
              <button
                type="button"
                class="danger"
                onClick={() => {
                  onCommand({ cmd: 'skip' });
                  setConfirmSkip(false);
                }}
              >
                {gt('games.organizer.skipIt', 'Skip it')}
              </button>
              <button type="button" onClick={() => setConfirmSkip(false)}>
                {gt('games.organizer.keepGoing', 'Keep going')}
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmSkip(true)}>
              {gt('games.organizer.skip', 'Skip')}
            </button>
          ))}
        {phase === 'reveal' && (
          <button type="button" disabled={earlier === null} onClick={() => setShowBack(true)}>
            {gt('games.organizer.back', 'Back')}
          </button>
        )}
        {confirmFinish ? (
          <span class="confirm">
            <button
              type="button"
              class="danger"
              onClick={() => {
                onCommand({ cmd: 'finish' });
                setConfirmFinish(false);
              }}
            >
              {gt('games.organizer.finishConfirm', 'Finish')}
            </button>
            <button type="button" onClick={() => setConfirmFinish(false)}>
              {gt('games.organizer.keepPlaying', 'Keep playing')}
            </button>
          </span>
        ) : (
          !confirmSkip && (
            <button type="button" onClick={() => setConfirmFinish(true)}>
              {gt('games.organizer.finish', 'Finish')}
            </button>
          )
        )}
        {!confirmSkip && !confirmFinish && menu}
      </div>

      {showBack && earlier !== null && <LookBack reveal={earlier} onClose={() => setShowBack(false)} />}
    </section>
  );
}
