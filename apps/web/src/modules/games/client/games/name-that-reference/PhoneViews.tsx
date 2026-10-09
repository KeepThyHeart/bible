/**
 * The phone.
 *
 * A tap target here is a whole row, because the person holding it is looking up
 * at the screen and down at their hand alternately, in a lit room, sometimes
 * with a toddler on their knee. Nothing is smaller than a thumb, and an answer
 * is acknowledged on the phone itself the moment it is sent — a person who is
 * not sure their tap registered taps again, and the room's clock does not owe
 * them the round trip.
 *
 * The picker exists because typing "1 Thessalonians" on a phone keyboard is a
 * spelling test, and this game is not one. Book and chapter are chosen from
 * what the canon actually has, so an impossible reference cannot be sent.
 *
 * Either shape stays open until time runs out: a tap, or a picked reference,
 * can be sent again and the later one replaces the earlier — read back from
 * the room when the phone has just reloaded. Only the tapped shape calls this
 * "voting" in its own wording, since only it can be counted for a team.
 *
 * A multiple-choice round also answers to the keyboard: `a`/`b`/`c`/`d`
 * (case-insensitive) select the matching option, for a host who has a
 * keyboard in front of them, or anyone who would rather not aim a thumb.
 */

import { useEffect, useState } from 'preact/hooks';
import type { AnswerValue, PersonalResult } from '../../../shared/protocol.js';
import { BOOK_NAMES, formatRef, toVerseId } from '../../../shared/verseId.js';
import type { PlayerViewProps } from '../../shell/gameViews.js';
import { AWAITING_REVEAL, AWAITING_ROUND } from '../../shell/waitingCopy.js';
import { chapterCount, chaptersOf } from './chapters.js';
import { indexForLetter, letterFor, readDetail, readQuestion } from './payload.js';

function Nothing({ line }: { line: string }) {
  return <p class="ntr-nothing">{line}</p>;
}

export function PhoneQuestion({ view }: PlayerViewProps) {
  const question = readQuestion(view);
  if (!question) return <Nothing line={AWAITING_ROUND} />;

  return (
    <section class="ntr ntr-phone">
      <p class="ntr-ask">Where is this from?</p>
      <blockquote class="ntr-verse">{question.text}</blockquote>
      <p class="ntr-hint">Answers open in a moment.</p>
    </section>
  );
}

export function PhoneAnswering({ snapshot, view, send }: PlayerViewProps) {
  const question = readQuestion(view);
  /** Remembered with its round, so the next question starts clean by itself. */
  const [sent, setSent] = useState<{ round: number; label: string } | null>(null);
  /** The option this phone last tapped, for a vote that can still change. */
  const [tapped, setTapped] = useState<{ round: number; index: number } | null>(null);
  const [book, setBook] = useState(1);
  const [chapter, setChapter] = useState(1);
  const [verse, setVerse] = useState(1);

  const mine = sent?.round === snapshot.round ? sent : null;
  const changeable = snapshot.canChangeAnswer;
  // Both shapes can be replaced until time runs out; only the tapped one is
  // ever counted as a team's vote, which is what "voting" means below.
  const voting = changeable && question?.answerShape === 'choice';
  const done = !changeable && (snapshot.youAnswered || mine !== null);
  // This phone's own last tap first, since the room's echo of it may still be
  // on its way; the echo alone for a phone that has just reloaded.
  const echoed = snapshot.yourAnswer?.type === 'choice' ? snapshot.yourAnswer.index : null;
  const chosen = (tapped?.round === snapshot.round ? tapped.index : null) ?? echoed;

  const submit = (value: AnswerValue, label: string): void => {
    if (done) return;
    setSent({ round: snapshot.round, label });
    send({ kind: 'answer', round: snapshot.round, value });
  };

  const tapChoice = (index: number, label: string): void => {
    // The vote already standing, tapped again, would only be sent twice.
    if (done || (voting && index === chosen)) return;
    setTapped({ round: snapshot.round, index });
    submit({ type: 'choice', index }, label);
  };

  // A/B/C/D (case-insensitive) select the matching option through the exact
  // same path a tap takes, so it respects whatever answer policy is in
  // effect — locked after one answer, or open to a changeable vote — the
  // same way a tap does. A hook cannot come after an early return, so this is
  // registered on every render and is simply a no-op once there is nothing to
  // answer with a letter (no question yet, or a typed round with no options).
  useEffect(() => {
    if (!question || question.answerShape !== 'choice') return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      // A held modifier means a browser or OS shortcut, not an answer.
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const index = indexForLetter(event.key);
      if (index === null) return;
      const option = question.options.find((candidate) => candidate.index === index);
      if (!option) return;
      tapChoice(option.index, option.label);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [question, done, chosen, voting, snapshot.round]);

  if (!question) return <Nothing line={AWAITING_ROUND} />;

  if (question.answerShape === 'choice') {
    const chosenLabel = question.options.find((option) => option.index === chosen)?.label ?? null;

    return (
      <section class="ntr ntr-phone">
        <blockquote class="ntr-verse ntr-verse-small">{question.text}</blockquote>
        <ul class="ntr-taps">
          {question.options.map((option) => (
            <li key={option.index}>
              <button
                type="button"
                class="ntr-tap"
                disabled={done}
                aria-pressed={chosen === option.index}
                onClick={() => tapChoice(option.index, option.label)}
              >
                <span class="ntr-letter">{letterFor(option.index)}</span>
                <span class="ntr-ref">{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
        {voting ? (
          <p class="ntr-sent" role="status">
            {chosenLabel === null
              ? 'Tap a reference to vote. You can change it until time runs out.'
              : `Your vote: ${chosenLabel}. Tap another reference to change it until time runs out.`}
          </p>
        ) : (
          done && <p class="ntr-sent">{mine ? `Sent: ${mine.label}` : 'Answer sent.'}</p>
        )}
      </section>
    );
  }

  // A chapter the chosen book does not have can be left over from the last
  // book, so the picker answers with what it is showing rather than with what
  // it last stored.
  const safeChapter = Math.min(chapter, chapterCount(book));
  const picked = toVerseId(book, safeChapter, Math.max(1, verse));
  // The room's own record, for a phone that reloaded after sending — this
  // session's own `mine` covers the ordinary case, where it was sent just now.
  const echoedLabel =
    snapshot.yourAnswer?.type === 'reference'
      ? formatRef(toVerseId(snapshot.yourAnswer.book, snapshot.yourAnswer.chapter, snapshot.yourAnswer.verse))
      : null;
  const sentLabel = mine?.label ?? echoedLabel;

  return (
    <section class="ntr ntr-phone">
      <blockquote class="ntr-verse ntr-verse-small">{question.text}</blockquote>
      <div class="ntr-picker">
        <label class="ntr-field">
          <span class="ntr-field-label">Book</span>
          <select
            class="ntr-select"
            disabled={done}
            value={String(book)}
            onChange={(event) => setBook(Number((event.currentTarget as HTMLSelectElement).value))}
          >
            {BOOK_NAMES.map((name, index) => (
              <option key={name} value={String(index + 1)}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label class="ntr-field">
          <span class="ntr-field-label">Chapter</span>
          <select
            class="ntr-select"
            disabled={done || chapterCount(book) === 1}
            value={String(safeChapter)}
            onChange={(event) =>
              setChapter(Number((event.currentTarget as HTMLSelectElement).value))
            }
          >
            {chaptersOf(book).map((number) => (
              <option key={number} value={String(number)}>
                {number}
              </option>
            ))}
          </select>
        </label>

        <label class="ntr-field">
          <span class="ntr-field-label">Verse</span>
          <input
            class="ntr-number"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            disabled={done}
            value={String(verse)}
            onInput={(event) =>
              setVerse(Math.max(1, Number((event.currentTarget as HTMLInputElement).value) || 1))
            }
          />
        </label>
      </div>

      <button
        type="button"
        class="ntr-send"
        disabled={done}
        onClick={() =>
          submit(
            { type: 'reference', book, chapter: safeChapter, verse: Math.max(1, verse) },
            formatRef(picked)
          )
        }
      >
        Send {formatRef(picked)}
      </button>
      {changeable
        ? sentLabel && (
            <p class="ntr-sent" role="status">
              Sent: {sentLabel}. You can change it until time runs out.
            </p>
          )
        : done && <p class="ntr-sent">{sentLabel ? `Sent: ${sentLabel}` : 'Answer sent.'}</p>}
    </section>
  );
}

/**
 * What a team vote came to, on this phone: what the team chose, then whether
 * that was right. The result is the team's, so every phone on it reads the same.
 */
function teamVerdict(result: PersonalResult): string {
  const verdict = result.correct ? 'Right.' : 'Not this time.';
  return result.note === null ? verdict : `${result.note}. ${verdict}`;
}

export function PhoneReveal({ reveal, yourResult }: PlayerViewProps) {
  const detail = readDetail(reveal?.detail);
  if (!reveal || !detail) return <Nothing line={AWAITING_REVEAL} />;

  const submitted = yourResult?.submitted ?? null;
  const picked = submitted?.type === 'choice' ? (detail.options[submitted.index] ?? null) : null;
  const yours =
    submitted === null
      ? null
      : submitted.type === 'choice'
        ? (picked?.label ?? null)
        : submitted.type === 'reference'
          ? formatRef(toVerseId(submitted.book, submitted.chapter, submitted.verse))
          : null;
  // Only a round decided by team vote carries the teams' splits.
  const teamVote = reveal.groups !== undefined;

  return (
    <section class="ntr ntr-phone">
      <p class="ntr-answer-label">The answer</p>
      <h2 class="ntr-answer">{reveal.correctLabel}</h2>
      {detail.text.length > 0 && (
        <blockquote class="ntr-verse ntr-verse-small">{detail.text}</blockquote>
      )}

      {yourResult === null ? (
        <p class="ntr-yours">No answer from this phone.</p>
      ) : teamVote ? (
        <p class="ntr-yours" data-correct={yourResult.correct ? 'true' : 'false'}>
          {teamVerdict(yourResult)}
          {picked !== null && !(yourResult.correct && picked.correct) && (
            <span class="ntr-muted"> You voted {picked.label}.</span>
          )}
        </p>
      ) : (
        <p class="ntr-yours" data-correct={yourResult.correct ? 'true' : 'false'}>
          {yourResult.correct ? 'Right.' : (yourResult.note ?? 'Not this time.')}
          {yours !== null && !yourResult.correct && <span class="ntr-muted"> You said {yours}.</span>}
        </p>
      )}
    </section>
  );
}
