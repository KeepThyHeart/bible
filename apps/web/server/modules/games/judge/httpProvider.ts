/**
 * A judge that asks a hosted model, over the OpenAI-shaped
 * `/v1/chat/completions` dialect that Together and most other hosts accept.
 * Swapping hosts is then configuration rather than code.
 *
 * Everything here is written around one fact: a room is a group of people
 * standing in front of a screen, and none of them can wait on a model. So the
 * call is bounded by a timeout and cancelled when it expires, and *every*
 * failure — an unreachable host, a 429, a truncated body, prose where JSON was
 * asked for, a key that was revoked this morning — comes back as "no
 * suggestion", which is exactly the state the game is designed to play in. A
 * provider that throws would take the round down with it; a provider that stays
 * quiet costs the host nothing, because the host was going to tap anyway.
 *
 * The suggestion is never a verdict. Nothing in this file decides anything.
 */

import type { JudgeProvider, JudgeRequest, JudgeSuggestion } from '../../../../src/modules/games/shared/protocol.js';

/**
 * The shape of `fetch` this layer actually uses, narrowed to what it needs.
 *
 * Narrow rather than borrowing the platform type so a test can hand over a
 * three-property object literal: judging must be testable without a network,
 * and a seam that demands a whole `Response` invites someone to reach for a
 * real one.
 */
export interface JudgeHttpRequest {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface JudgeHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type JudgeFetch = (url: string, init: JudgeHttpRequest) => Promise<JudgeHttpResponse>;

export interface HttpJudgeSettings {
  /** Chat-completions base, without the `/chat/completions` tail. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** How long the room is willing to wait. See `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Injected by tests; the platform's `fetch` otherwise. */
  fetch?: JudgeFetch;
}

export const HTTP_JUDGE_ID = 'chat-completions';

/**
 * Long enough for a small model on a warm connection, short enough that a host
 * who has already decided is never watching a spinner. The suggestion arrives
 * beside a decision the host can make without it, so waiting longer buys
 * nothing that anyone in the room can use.
 */
export const DEFAULT_TIMEOUT_MS = 4_000;

/**
 * A cap on how much of the model's reasoning reaches the host screen. The
 * suggestion sits under a live question on a projector, and a paragraph there
 * would be read by the room instead of the answer being adjudicated.
 */
const MAX_REASON_CHARS = 160;

/** Two sentences of justification is all the response format asks for. */
const MAX_RESPONSE_TOKENS = 200;

const VERDICTS: readonly JudgeSuggestion['verdict'][] = ['correct', 'incorrect', 'ambiguous'];

/**
 * The rubric. It is deliberately generous and deliberately timid: the accepted
 * alternates are authored by whoever wrote the question and are the real
 * source of truth, so the model's job is to catch the phrasings that list
 * missed, not to re-adjudicate what it already covers. `ambiguous` exists so a
 * near-miss becomes "ask them to be specific" — a second, shorter window —
 * instead of a coin flip dressed up as a verdict.
 */
const SYSTEM_PROMPT = [
  'You help the host of a Bible quiz decide whether a spoken answer counts.',
  'The host makes the final call; you only advise.',
  'Credit an answer that means the same thing as the expected answer, allowing for',
  'spelling, modern wording in place of archaic wording, a missing article, and extra',
  'words that do not change the meaning. Do not require the exact words.',
  'Answer "correct" when it clearly means the expected answer, "incorrect" when it',
  'clearly does not, and "ambiguous" when it is too vague to tell and the player',
  'should be asked to be more specific.',
  'Reply with JSON only, in the form {"verdict":"correct|incorrect|ambiguous","reason":"..."}.',
  'Keep the reason to one short sentence a host can read at a glance.',
].join(' ');

export function createHttpJudge(settings: HttpJudgeSettings): JudgeProvider {
  // Tolerate a trailing slash: the base URL is typed into an environment file
  // by a person, and a doubled slash is a 404 on some hosts.
  const endpoint = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const send = settings.fetch ?? (globalThis.fetch as JudgeFetch);
  const timeoutMs =
    settings.timeoutMs !== undefined && settings.timeoutMs > 0 ? settings.timeoutMs : DEFAULT_TIMEOUT_MS;

  return {
    id: HTTP_JUDGE_ID,

    async suggest(request: JudgeRequest): Promise<JudgeSuggestion | null> {
      const abort = new AbortController();
      // Abort rather than merely stop waiting: an answer that arrives after the
      // host has already tapped is worthless, and leaving the socket open means
      // a slow host accumulates one dead connection per adjudication.
      const expiry = setTimeout(() => abort.abort(), timeoutMs);

      try {
        const response = await send(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${settings.apiKey}`,
          },
          body: JSON.stringify(requestBody(settings.model, request)),
          signal: abort.signal,
        });

        // A non-200 is a fact, not an exception: a bad key, a rate limit and a
        // host outage all mean the same thing here, which is that the host
        // adjudicates unaided this time.
        if (!response.ok) return null;

        return readSuggestion(await response.json());
      } catch {
        // The one place in this project where a bare catch is right, and it is
        // right because of what is on the other side of it: a room mid-round.
        // The throwing cases are a refused or dropped connection, the abort
        // above firing, a body that ends mid-JSON, and `JSON.parse` on model
        // output that turned out to be prose. Every one of them is a judge that
        // has nothing useful to say, and the game plays correctly when the
        // judge says nothing — so there is no bug being masked, only a
        // suggestion not being offered.
        return null;
      } finally {
        // Otherwise a fast reply still holds the event loop open for the rest
        // of the timeout, which on a short-lived process delays exit.
        clearTimeout(expiry);
      }
    },
  };
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

function requestBody(model: string, request: JudgeRequest): Record<string, unknown> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(request) },
  ];
  return {
    model,
    messages,
    // Adjudication must not vary between two players who said the same thing.
    temperature: 0,
    max_tokens: MAX_RESPONSE_TOKENS,
    // Honoured by Together, OpenAI and the common self-hosted servers. A host
    // that ignores it still works, because the parser below tolerates a model
    // that wraps its JSON in chatter.
    response_format: { type: 'json_object' },
  };
}

/**
 * What the model is given. The context note and the accepted alternates are the
 * valuable part — they are the question author's own words about what counts —
 * so they go in verbatim. `seenPrefix` matters because a player who buzzed
 * early answered a question they had only partly heard, and an answer to the
 * first half of a question is a different thing from a wrong answer.
 */
function userPrompt(request: JudgeRequest): string {
  const lines = [
    `Question: ${request.question}`,
    `Expected answer: ${request.canonicalAnswer}`,
  ];
  if (request.accept.length > 0) {
    lines.push(`Also accepted: ${request.accept.join('; ')}`);
  }
  if (request.contextNote !== null && request.contextNote.trim() !== '') {
    lines.push(`Note from the question's author: ${request.contextNote}`);
  }
  if (request.seenPrefix !== '' && request.seenPrefix !== request.question) {
    lines.push(`The player buzzed having read only: ${request.seenPrefix}`);
  }
  lines.push(`The player said: ${request.playerAnswer}`);
  return lines.join('\n');
}

/**
 * Pull a suggestion out of a chat-completions body, or decide there isn't one.
 *
 * Every step here can fail on well-formed JSON from a healthy host — a model
 * that returned an empty choice list, a refusal, a verdict word nobody asked
 * for — and each of those is a `null` rather than a throw, because a strange
 * reply and an unreachable host are the same event as far as the room is
 * concerned. `JSON.parse` is the exception: it throws, and the caller's catch
 * is where that lands.
 */
function readSuggestion(body: unknown): JudgeSuggestion | null {
  const content = contentOf(body);
  if (content === null) return null;

  const object = firstJsonObject(content);
  if (object === null) return null;

  const parsed: unknown = JSON.parse(object);
  if (typeof parsed !== 'object' || parsed === null) return null;

  const fields = parsed as { verdict?: unknown; reason?: unknown };
  if (typeof fields.verdict !== 'string') return null;

  const verdict = fields.verdict.trim().toLowerCase();
  if (!isVerdict(verdict)) return null;

  return { verdict, reason: cleanReason(fields.reason) };
}

function isVerdict(value: string): value is JudgeSuggestion['verdict'] {
  return (VERDICTS as readonly string[]).includes(value);
}

function contentOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) return null;

  const message = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return null;

  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : null;
}

/**
 * The outermost `{...}` in the reply. Models that were asked for JSON still
 * routinely fence it or introduce it, and a suggestion is too cheap to discard
 * over punctuation the host will never see.
 */
function firstJsonObject(content: string): string | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return content.slice(start, end + 1);
}

/** Collapsed and clipped, because this is going on a projector mid-question. */
function cleanReason(value: unknown): string {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_REASON_CHARS ? `${collapsed.slice(0, MAX_REASON_CHARS - 1)}…` : collapsed;
}
