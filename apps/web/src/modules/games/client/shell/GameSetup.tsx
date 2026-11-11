/**
 * A game's options: three choices up front, everything else behind "More
 * options". Only the options this game reads are shown.
 *
 * Used twice: before a room exists (it offers "I'm playing too" and its button
 * opens the game), and from the lobby (the same fields, prefilled from the
 * room, whose button applies them to the room that is already open).
 */

import { useState } from 'preact/hooks';
import type { Catalog, Familiarity, GameId, RoomSettings, TeamCount } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import '../styles/organize.css';
import { MAX_NAME_LENGTH, normaliseName } from './JoinScreen.js';
import { ThemeEditor } from './ThemeEditor.js';
import { gameTitle, hasBuzzModeOption, scopeName } from './gameLabels.js';
import { getGameViews } from './gameViews.js';
import { rememberedName } from './session.js';
import { gt } from './t.js';
import { useHeadingFocus } from './useHeadingFocus.js';

/** What the length choices stand for, as `rounds`. */
const LENGTHS = [
  { rounds: 5, key: 'Short', label: 'Short ({count})' },
  { rounds: 10, key: 'Normal', label: 'Normal ({count})' },
  { rounds: 15, key: 'Long', label: 'Long ({count})' },
] as const;

/** The length choice for a game with no set length. */
const OPEN_LENGTH = 'open';
type LengthChoice = number | typeof OPEN_LENGTH;

/** The three difficulty choices, as the verse pool they draw from. */
const DIFFICULTIES: readonly { value: Familiarity; key: string; label: string }[] = [
  { value: 'familiar', key: 'WellKnown', label: 'Well known' },
  { value: 'broad', key: 'Mixed', label: 'Mixed' },
  { value: 'deep', key: 'Hard', label: 'Hard' },
];

const TEAM_CHOICES = [null, 2, 3, 4] as const;
const SECOND_CHOICES = [10, 15, 20, 30, 45, 60, 90];

const DEFAULTS = {
  rounds: 10,
  familiarity: 'broad' as Familiarity,
  teamsEnabled: false,
  teamCount: 2 as TeamCount,
  groupVote: false,
  answerWindowMs: 20_000,
};

export interface GameSetupProps {
  gameId: GameId;
  catalog: Catalog;
  /** Values to start from: a room's settings when changing, otherwise the defaults. */
  initial?: Partial<RoomSettings>;
  /** `create` is before a room exists and offers "I'm playing too". */
  mode: 'create' | 'change';
  busy?: boolean;
  error?: string | null;
  /** The settings to apply, and the organizer's player name when they are playing too. */
  onSubmit(settings: Partial<RoomSettings>, player: { name: string } | null): void;
  onBack?(): void;
}

interface SegmentOption<T> {
  value: T;
  label: string;
  selected: boolean;
}

function Segments<T extends string | number | null>({
  label,
  options,
  onPick,
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  onPick(value: T): void;
}) {
  return (
    <div class="field">
      <span class="field-label">{label}</span>
      <div class="org-seg" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={option.selected}
            onClick={() => onPick(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GameSetup({ gameId, catalog, initial, mode, busy = false, error = null, onSubmit, onBack }: GameSetupProps) {
  const [draft, setDraft] = useState<Partial<RoomSettings>>(initial ?? {});
  const [playingToo, setPlayingToo] = useState(false);
  const [playerName, setPlayerName] = useState(() => rememberedName());
  const headingRef = useHeadingFocus();

  const game = catalog.games.find((candidate) => candidate.id === gameId);
  const card = getGameViews(gameId)?.card;
  // Before the catalog answers, show every option rather than guess one away.
  const showFamiliarity = game?.usesFamiliarity ?? true;
  const showTranslation = game?.usesTranslation ?? true;
  const showSet = game?.usesSet ?? true;
  const voteMode = game?.groupVote ?? 'none';

  const rounds = draft.rounds ?? DEFAULTS.rounds;
  const openEnded = draft.openEnded ?? false;
  const familiarity = draft.familiarity ?? DEFAULTS.familiarity;
  const teamsEnabled = draft.teamsEnabled ?? DEFAULTS.teamsEnabled;
  const teamCount = draft.teamCount ?? DEFAULTS.teamCount;
  const groupVote = draft.groupVote ?? DEFAULTS.groupVote;
  const answerWindowMs = draft.answerWindowMs ?? DEFAULTS.answerWindowMs;
  const translation = draft.translation ?? catalog.translations[0] ?? 'KJV';
  const gameOptions = draft.gameOptions ?? {};
  const buzzMode = gameOptions['buzzMode'] === 'buttons' ? 'buttons' : 'hostCalls';

  const translations = catalog.translations.includes(translation)
    ? catalog.translations
    : [translation, ...catalog.translations];
  const sets = catalog.sets.filter((set) => set.gameId === null || set.gameId === gameId);
  const seconds = Math.round(answerWindowMs / 1000);
  const secondChoices = SECOND_CHOICES.includes(seconds)
    ? SECOND_CHOICES
    : [...SECOND_CHOICES, seconds].sort((a, b) => a - b);

  const trimmedName = normaliseName(playerName);
  const needsName = mode === 'create' && playingToo && trimmedName.length === 0;

  const patch = (change: Partial<RoomSettings>): void => setDraft((current) => ({ ...current, ...change }));

  const submit = (): void => {
    const settings: Partial<RoomSettings> = {
      ...draft,
      gameId,
      rounds,
      openEnded,
      familiarity,
      teamsEnabled,
      teamCount,
      answerWindowMs,
    };
    if (voteMode === 'optional') settings.groupVote = groupVote;
    onSubmit(settings, mode === 'create' && playingToo ? { name: trimmedName } : null);
  };

  return (
    <main class="screen org-screen">
      <header class="org-header">
        <h1 class="org-title" tabIndex={-1} ref={headingRef}>
          {gameTitle(catalog, gameId)}
        </h1>
        {card !== undefined && <p class="muted">{gt(card.descriptionKey, card.descriptionFallback)}</p>}
        {game?.scopeLabel !== undefined && <p class="field-hint">{scopeName(game.scopeLabel)}</p>}
      </header>

      <form
        class="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !needsName) submit();
        }}
      >
        <Segments<LengthChoice>
          label={gt('games.organize.lengthLabel', 'Length')}
          options={[
            ...LENGTHS.map((length) => ({
              value: length.rounds as LengthChoice,
              label: gt(`games.organize.length${length.key}`, length.label, { count: length.rounds }),
              selected: !openEnded && rounds === length.rounds,
            })),
            {
              value: OPEN_LENGTH,
              label: gt('games.organize.lengthOpen', 'Keep going'),
              selected: openEnded,
            },
          ]}
          onPick={(value) =>
            patch(value === OPEN_LENGTH ? { openEnded: true, rounds: DEFAULTS.rounds } : { openEnded: false, rounds: value })
          }
        />
        {openEnded && <p class="field-hint">{gt('games.organize.lengthOpenHint', 'No set length. Finish whenever.')}</p>}

        {showFamiliarity && (
          <Segments
            label={gt('games.organize.difficultyLabel', 'Difficulty')}
            options={DIFFICULTIES.map((choice) => ({
              value: choice.value,
              label: gt(`games.organize.difficulty${choice.key}`, choice.label),
              selected: familiarity === choice.value,
            }))}
            onPick={(value) => patch({ familiarity: value })}
          />
        )}

        <Segments
          label={gt('games.organize.teamsLabel', 'Teams')}
          options={TEAM_CHOICES.map((choice) => ({
            value: choice,
            label: choice === null ? gt('games.organize.teamsNone', 'None') : String(choice),
            selected: choice === null ? !teamsEnabled : teamsEnabled && teamCount === choice,
          }))}
          onPick={(value) =>
            value === null ? patch({ teamsEnabled: false }) : patch({ teamsEnabled: true, teamCount: value })
          }
        />

        {voteMode === 'optional' && (
          <label class="org-check">
            <input
              type="checkbox"
              name="group-vote"
              checked={groupVote}
              onChange={(event) => patch({ groupVote: event.currentTarget.checked })}
            />
            <span>{gt('games.organize.groupVote', 'Teams answer together')}</span>
          </label>
        )}
        {voteMode === 'always' && (
          <p class="muted" role="note">
            {teamsEnabled
              ? gt('games.organize.groupVoteAlwaysTeams', 'Each team answers together: the majority answer is everyone’s.')
              : gt('games.organize.groupVoteAlwaysRoom', 'The group answers together: the majority answer is everyone’s.')}
          </p>
        )}

        {mode === 'create' && (
          <>
            <label class="org-check">
              <input
                type="checkbox"
                name="playing-too"
                checked={playingToo}
                onChange={(event) => setPlayingToo(event.currentTarget.checked)}
              />
              <span>{gt('games.organize.playingToo', 'Playing too')}</span>
            </label>
            {playingToo && (
              <label class="field">
                <span class="field-label">{gt('games.organize.yourName', 'Your name')}</span>
                <input
                  type="text"
                  name="display-name"
                  autoComplete="nickname"
                  autoCapitalize="words"
                  maxLength={MAX_NAME_LENGTH}
                  value={playerName}
                  onInput={(event) => setPlayerName(event.currentTarget.value)}
                />
              </label>
            )}
          </>
        )}

        <details class="org-more">
          <summary>{gt('games.organize.more', 'More options')}</summary>
          <div class="stack">
            <label class="field">
              <span class="field-label">{gt('games.organize.timePerQuestion', 'Time per question')}</span>
              <select
                name="time-per-question"
                value={String(seconds)}
                onChange={(event) => patch({ answerWindowMs: Number(event.currentTarget.value) * 1000 })}
              >
                {secondChoices.map((value) => (
                  <option key={value} value={String(value)}>
                    {gt('games.organize.seconds', '{value} seconds', { value })}
                  </option>
                ))}
              </select>
            </label>

            {showTranslation && (
              <label class="field">
                <span class="field-label">{gt('games.organize.translation', 'Translation')}</span>
                <select
                  name="translation"
                  value={translation}
                  onChange={(event) => patch({ translation: event.currentTarget.value })}
                >
                  {translations.map((abbreviation) => (
                    <option key={abbreviation} value={abbreviation}>
                      {abbreviation}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {showSet && (
              <label class="field">
                <span class="field-label">{gt('games.organize.topic', 'Topic')}</span>
                <select
                  name="topic"
                  value={draft.setId ?? ''}
                  onChange={(event) =>
                    patch({ setId: event.currentTarget.value === '' ? null : event.currentTarget.value })
                  }
                >
                  <option value="">{gt('games.organize.topicAny', 'Pick for me')}</option>
                  {sets.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {hasBuzzModeOption(gameId) && (
              <Segments
                label={gt('games.organize.buzz', 'How players buzz in')}
                options={[
                  {
                    value: 'hostCalls',
                    label: gt('games.organize.buzzHostCalls', 'Organizer calls on them'),
                    selected: buzzMode === 'hostCalls',
                  },
                  {
                    value: 'buttons',
                    label: gt('games.organize.buzzButtons', 'Phone buttons'),
                    selected: buzzMode === 'buttons',
                  },
                ]}
                onPick={(value) => patch({ gameOptions: { ...gameOptions, buzzMode: value } })}
              />
            )}

            <ThemeEditor
              theme={draft.theme ?? DEFAULT_THEME}
              onChange={(theme) => patch({ theme })}
              label={gt('games.organize.theme', 'Game theme')}
            />
          </div>
        </details>

        {error !== null && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}

        <button type="submit" class="btn-primary" disabled={busy || needsName}>
          {mode === 'change'
            ? gt('games.organize.save', 'Save changes')
            : busy
              ? gt('games.organize.opening', 'Opening…')
              : gt('games.organize.open', 'Open the game')}
        </button>
        {onBack !== undefined && (
          <button type="button" class="btn-quiet" onClick={onBack} disabled={busy}>
            {mode === 'change' ? gt('games.organize.cancel', 'Cancel') : gt('games.organize.otherGame', 'Pick another game')}
          </button>
        )}
      </form>
    </main>
  );
}
