# Handoff

Everything a new contributor needs to pick this up. Read this first, then
the 0039 parallel-work plan (not carried over) for the ownership rules, then the decision
records in [adr/](adr/).

Status as of the fourth build wave, which built the detective game and
describe-it and integrated the seam changes every game left behind. The **Current state** section near the end is the part
that goes stale; the rest is durable.

---

## What this is

A website for playing Bible games as a group. The leader hosts from a laptop or
a TV; everyone else joins from their phone with a short room code. No accounts,
no installs. Think Kahoot or Jackbox, for church small groups, youth groups,
Sunday school and families.

The design brief and the wireframes live outside this repository, with the
owner. The decisions taken from them are recorded here, so you should not need
those documents to work.

---

## Decisions already made

These were settled in discussion with the owner. Several contradict the original
brief or the wireframes; where they do, **this document wins**.

### Architecture

| Decision | Where |
| --- | --- |
| Server-sent events downstream, plain POSTs upstream. No WebSockets. | [adr 0001](adr/0001-server-sent-events-not-websockets.md) |
| No dependency on the owner's Bible study codebase. Read the module *format*, share no code. | [adr 0002](adr/0002-module-format-not-shared-code.md) |
| Buzz queue ranks by clock-corrected client time, not by characters read and not by arrival. | [adr 0003](adr/0003-buzz-ordering.md) |
| Privacy enforced by server-side projection, never by hiding fields in the client. | [adr 0004](adr/0004-privacy-by-projection.md) |
| Judging is a suggestion; the null provider is the default and every game is playable without one. | [adr 0005](adr/0005-judging-is-a-suggestion.md) |
| A room distributes three capabilities — the screen, control, and a seat — across devices instead of assuming one device is all three. Control is granted by naming a session, never by handing out a token. | [adr 0006](adr/0006-screen-control-and-seat.md) |
| The game is a property of the room, not of the process. `createRoomPort` takes a resolver and looks the module up per intent from that room's own settings. | `server/room/port.ts` |
| Per-game settings live in `RoomSettings.gameOptions`, an opaque string map. Naming each game's options in the protocol would grow the type with every game and teach the shell what a difficulty is. | `src/shared/protocol.ts` |

Licence is GPL-3.0-or-later. Deployment target is a Linux VM — systemd plus
nginx, and the stream route needs `proxy_buffering off` or it dies silently.
Judging, when enabled, speaks the OpenAI-shaped chat-completions dialect that
Together and most other hosts accept.

### Game design

Resolved contradictions between the brief and the wireframes:

- **No hints.** The wireframes show a hint button on fill-in-the-blank. It is
  not being built.
- **Buzz-in uses a queue, not a single buzzer.** The wireframes say a wrong
  answer ends the question for everyone; it does not. First buzz freezes the
  stream for the room, others may still queue, a wrong answer passes to the next
  in queue from their own frozen position, and an empty queue resumes the
  stream.
- **Words, not characters, for streamed questions.** Characters were proposed
  for ranking precision, but ranking is by corrected time, so the argument is
  moot and words read better on a phone. Streaming itself should default OFF for
  mixed groups — whole question shown at once, buzz live immediately. Streaming
  is a "quiz bowl" mode for veterans. The wrong-interrupt penalty only has
  meaning while streaming.
- **Progressive clues are server-paced in group play, player-paced in solo.**
  The wireframes give the player a "next clue" button; that makes "answered at
  clue two" incomparable between players.
- **Sword drill: tap order sets the queue, not the score.** Tapping "found it"
  proves nothing — reading it aloud does. The host confirms down the list as far
  as they like, a wrong confirmation passes to the next, and anyone never
  reached sees "found it" with no score and no public mark. That removes the
  incentive to mash the button.
- **Detective: private clue per phone, majority vote decides.** Everyone
  submits, the majority answer is the team's, a correct majority scores the
  whole team. The reveal shows the split unattributed, so a dissenter is never
  named.
- **A wrong answer on progressive clues locks that player out of the whole
  question.** One guess per question. The owner settled this against the
  earlier recommendation of locking out only the clue tier, so what softens it
  has to be the reveal: the phone of a player who is out says so privately, and
  the big screen never shows who guessed wrong.
- **Sword drill: confirmed finds score.** Everyone the host confirms earns the
  same points; anyone never reached sees "found it" with no score and no mark.
- **Player rank appears on the phone only when it is top three.** Otherwise
  points and running total, no rank.
- **Solo is a room with one player who is also the host**, auto-advancing. It is
  a flag on the shell, not a second application.
- **Default translation is the King James Version.** Its archaic vocabulary is
  why `src/shared/answers/` carries a normalisation layer for `thou`, `-eth`,
  `shew` and friends: a player typing the modern equivalent must be credited.

### Content

- First batch is **300 questions across five types**, not two thousand. Playtest
  first, learn what breaks — the likely answers are distractor quality and
  difficulty calibration — fix the generator, then scale.
- Generation must be a committed, re-runnable script, with an automated
  validator beside it. The validator is the highest-leverage piece of tooling in
  the project.
- Fill-in-the-blank and name-that-reference need **no curated content at all** —
  both generate from verse text. Do not let content authoring block them.
- Questions carry: prompt, canonical answer, accepted alternates, a context note
  for a judge, eight or more distractors with the first three being the most
  plausible, difficulty, categories and tags.

---

## Rules that are not negotiable

From the owner, and they apply to every contributor including agents.

1. **Never commit to a mainline branch** without being asked in that specific
   moment. The current branch is `main` and nothing has been committed yet.
2. **Never commit generated or loaded-in artefacts.** Bible modules, `dist/`,
   `node_modules/`, logs, coverage. If something should be ignored and is not,
   add it to `.gitignore` in the same change.
3. **No spec, phase, task or work-item identifiers in code** — not in names, not
   in comments, not in test descriptions. A comment must stand on its own.
   Games are identified descriptively: `fill-in-the-blank`, never a number.
4. **No try/catch** unless you expect a specific exception and handle it
   meaningfully. Masked bugs are worse than crashes.
5. **Never interpolate untrusted input into SQL.** Parameterise everything.
6. **Run targeted tests during development**, the full suite only at the end of
   a wave. Capture expensive output to a file and grep the file rather than
   piping a long run into `grep`.
7. **Relative imports carry a `.js` extension** even in TypeScript source. The
   server emits real Node ESM; Vite resolves a `.js` specifier to `x.ts`, so one spelling
   works on both sides.
8. **No test may sleep.** Use fake timers or injected clocks.

---

## How it fits together

```
intent  ->  transport (authenticates, corrects buzz time)
        ->  reducer   (pure: state + intent -> state + effects)
        ->  effects   (scheduler arms timers, persistence, judge requests)
        ->  projection (per viewer)  ->  event stream  ->  clients
```

The seams that matter:

- **The reducer is pure.** No clock, no sockets, no database, no randomness
  except a seeded generator carried in state. It returns *requests* for
  side effects and the runtime performs them. That is why a timing bug
  reproduces in a unit test instead of hiding behind a swallowed exception.
- **The scheduler owns every server timer.** The reducer emits
  `{ type: 'timer', at, round, tag }`; the scheduler fires a matching intent
  back. Clients derive countdowns from `phaseEndsAt`, never from when a message
  happened to arrive, so a late timer costs precision but never desynchronises
  the room.
- **Projection is where privacy is enforced.** A player's score reaches only
  that player's snapshot. Host standings are trimmed to three on the server
  unless the host turned individual scores on, so the big screen physically
  cannot render a last place.
- **A game module gets `buildRound` and `scoreRound`, and a few optional
  hooks.** It sees the round's seats — ids and teams, never names — and never
  the sockets or the clock. That narrowness is what lets several games be built
  in parallel. Per-phone views, changeable answers and team votes are opt-ins;
  see the 0039 parallel-work plan (not carried over).
- **Reconnection recovers by snapshot.** Every stream opens with a full one and
  there is no replay buffer. A phone waking from lock is the common case, not
  the exception.

---

## Current state

**Nine games are registered and playable: fill in the blank, name that
reference, sword drill, who said it, who am I, put in order, the category
board, the detective game and describe-it.** 1,860 tests across 85 files,
`npm run typecheck` clean across all three projects, `npx eslint .` clean,
`npx vite build` clean, and `npm run content -- check` on freshly generated
content reports 0 errors and 5 warnings (answers much the longest of their
options). Nothing is committed — the branch is `main`.

**Group voting** is a room mode (`RoomSettings.groupVote`) that the room carries
out around a game: each team's clear majority is its answer, a tie scores
nobody, and everyone on a team scores the team's answer. The detective game is
always played this way; who am I, who said it, name that reference and the
category board offer it as a lobby switch. Each phone's note leads with the
team's choice and adds the game's own line ("Your team chose Moses. Got it at
clue 2"). A vote's split is drawn once: the shell draws a card per group under
the game's reveal, except that a game whose reveal draws the room's vote itself
(the detective game) keeps a room of one group to itself.

**A room now distributes three capabilities across devices** — the screen, the
authority to run it (control), and a seat — instead of assuming one device is
all three (see [ADR 0006](adr/0006-screen-control-and-seat.md)). `/screen` (the
`/host` path still works, as an alias) opens the projector or TV as before,
storing the room's owner token and a second, display-only token; a QR built
from the display token adds a second screen to a room that already has one,
carrying no authority at all. A phone in the lobby offers "Run the game",
which asks the current controller to hand it over; once granted, that phone
carries the control bar and the judge card above its own player view, and can
start the room itself if it was still in the lobby. The screen lobby offers
"Play too, and run it from here" for the phone-led case: it joins the owner's
own device as a player, grants it control, and switches routes — the same
three calls solo already made, now with no mode flag anywhere. An
unattended controller (the owner's screen gone, or a controlling player's
phone dropped) loses control to a waiting request after 45 seconds, which is
what lets a room whose screen went to sleep still be finished; the owner
credential may always reclaim it regardless. `fill-in-the-blank` and
`who-said-it` adopt `questionOnScreen` to leave the verse or quote to the
screen when one is present, rather than repeating it on every phone; no other
game was changed. Alongside this, `BuzzState.spent` — a pre-existing leak that
named a player who had already answered wrong to the whole room — was fixed
the same way: it now reaches only that player's own snapshot
(`youAreSpent`) and the controller's (`ControlPanel.spent`), never the public
`buzz`.

Owner decisions in this wave:

- **The detective and describe-it screens are approved** and built to them,
  including the detective reveal's own split and describe-it's "Turn 3 / 8",
  "End turn" and "Start Blue's turn".
- **Who am I, voting as teams, pays a team at the clue its majority first
  formed**: the vote that took its answer past half the seated team. A
  straggler who comes round later costs nothing. A team that hedges across
  every name has no majority early, so it earns nothing early. An answer that
  wins without ever holding more than half the team is paid at its latest vote.
- **Describe-it stays at 50 points per card got.**

The seam grew to carry these: `viewFor` is told the phase, `roundComplete` lets
a game end a round early, `hostChrome` words the host's chrome, and
`GroupVoteSpec.represent` picks which vote stands for a team. See
the 0039 parallel-work plan (not carried over).

Played over the real HTTP surface, not only in tests: the detective game and
describe-it, with two phones and a host on one machine. Each phone's stream
carried its own clue or card and nobody else's, the big screen carried no dealt
clue, no card in play and no name beside a slip, and each result reached only
its own phone. Sword drill, who said it, who am I, put in order and the
category board are proven through the real reducer but **have not been played
over HTTP**. Caveats worth knowing before a playtest:

- **Detective.** The vaguest clue goes to the big screen and the rest are dealt
  one to a phone, so with more phones than clues some repeat, and the phone
  says so. A case stays open for at least ninety seconds. No solo.
- **Describe-it.** The card reaches the describer's and the other team's
  phones only when the turn's clock starts. The turn ends on the last card of
  its 40-card deck. A server with no prompt cards deals an empty deck, which
  takes no taps, so that turn waits for the timer or End turn. With teams off
  nobody can call a slip. "Start Blue's turn" and the reveal's "Up next" are
  read from the seats of the turn just played, so someone joining between
  turns can change who actually goes next. Standings wait for the summary.
- **Group voting counts standing votes only.** The room keeps each player's
  latest vote, so for who am I a player who backed the answer, moved off it
  and came back is counted from when they came back.

- **Sword drill.** The host confirms down the queue: each confirmation passes
  the turn on rather than ending the round, and when nobody is left in line the
  search resumes, with the time spent listening given back, until the timer or
  Reveal now ends it. Confirm and Next in line stay disabled until the reader's
  phone has reported in, and the server ignores a confirmation with nothing on
  file. Phones now post their measured clock offset beside every buzz, so this
  is the first game ranked by genuinely corrected time. A second (or third)
  phone can always queue behind a reader already answering — that was already
  true before `buzzMode` existed. What `gameOptions.buzzMode` (default
  `hostCalls`) adds is a second way *onto* the queue: the host taps a
  connected player's own name on the big screen (`{cmd: 'callOn'}`), which the
  reducer treats exactly as that player's own buzz — no phone button at all in
  this mode. `buttons` keeps the original "everyone races to tap Found it"
  mechanic. `admitsBuzzFrom`/`admitBuzz` in `reducer.ts` are the one gate and
  the one queue-insertion path an ordinary buzz and a `callOn` both go
  through, so neither can bypass a rule the other is held to.
- **Who am I.** Group rounds are credited against the server's clock, using the
  opening each answer carries. Solo rounds trust the clue the phone turned to.
  All five clues travel in the payload from the start, so a player reading raw
  JSON could see clue five early; the module's own comment explains why.
- **Category board.** The host picks the next tile on the reveal screen, and the
  room goes straight to it. Next question without a pick plays the next tile
  along the board's own walk. The first tile of a game cannot be picked, because
  the board is drawn when that round is built.
- **Who said it** and **put in order** needed no seam changes.

Verified against a built server over the real HTTP surface, not only in tests: a
room is created, a phone joins, the game starts, a real King James verse arrives
on the phone, an answer is submitted and scored, and the reveal comes back. The
phone receives its own result and the host receives `null` in its place, which
is privacy-by-projection working where it is supposed to.

The pool was verified the same way. A room set to `core` asked about Psalm
139:14, Genesis 1:27, Philippians 4:13 and Ecclesiastes 3:1; the same room set
to `any` asked about Dedan. That contrast is the whole feature.

| Layer | State |
| --- | --- |
| `src/shared/` | protocol (including the screen/control/seat split — `Controller`, `ControlPanel`, `PublicBuzzState`, see [adr 0006](adr/0006-screen-control-and-seat.md)), verse identity, game seam (answer opening and a controller's ruling on each scored answer, confirm-every-buzz, host choices, per-player views told the phase, answer policies, group voting and which vote stands for a team, ending a round early, host chrome wording), answer matching |
| `server/room/` | reducer, phases, scoring, projection, the port factory; tracks `controller`/`controlRequests`/screen presence and the §5.1 authorisation rule; rebuilds the rounds after a host's choice; freezes the seats per round; carries out group votes (`groupVote.ts`); ends a round when the game says it is complete; projects the game's chrome wording and the control panel to whichever device holds control |
| `server/transport/` | streams, registry (owner and display tokens), sessions, auth, broadcast; resolves a stream credential to a screen (owner or display) or a player, and accepts a host command from a session token as well as the owner token |
| `server/clock/`, `src/client/clock/` | offsets, scheduler, clamping, `showAt` |
| `server/content/` | module reader, catalog, content database (clues since schema 2), importer, verse pool |
| `server/content/generator/` | question generator: facts in, importer JSON out, wrong answers ranked by resemblance |
| `server/content/validate.ts` | content checks: quotations against verses, giveaways, wrong answers the matcher credits |
| `server/tools/content.ts` | generate, check, import and stats |
| `content/` | 566 curated verses in five tiers, 107 prompt cards |
| `content/source/` | facts for five games: 96 people with five clues each and more as wrong answers, places, 84 sayings, 17 timelines, 12 board categories |
| `server/judge/` | provider interface, null provider, chat-completions provider |
| `src/client/shell/` | join, both lobbies, the screen frame (`ScreenApp`, `/screen` with `/host` as an alias) and the phone route (`PlayApp`), `ControlBar`/`ControlPanel` (shared between whichever device holds control), timer, routes, solo; posts the clock offset beside every buzz; draws each group's vote under a reveal; takes a game's wording for the host chrome |
| `server/games/`, `src/client/games/` | fill in the blank, name that reference, sword drill, who said it, who am I, put in order, category board, detective, describe-it |
| `deploy/`, the deployment notes | systemd unit, nginx site, `.env.example` |

`npm run content -- generate` builds 84 who-said-it questions, 96 who-am-I and
96 detective cases, 85 put-in-order lists and a twelve-column category board
from `content/source/`, and `check` passes all of it against the KJV module
with no errors: every quotation verbatim, every clue reference real, no clue
naming its own answer, no wrong answer the typed-answer matcher would credit.
Describe-it deals from the 107 prompt cards. How a game finds its material is
in [content.md](content.md). The facts were written in one pass by one reader;
expect a playtest to argue with some of them.

**Not started**:

- **A real playtest on phones over cellular.** Every run so far has been on one
  machine or in tests; sync and reconnect bugs do not show there.
- **A first real deploy.** See below.

**A Bible module must be installed to play**, though not to run the tests — the
content layer builds its own fixtures. Drop a `.db` in `modules/`; see
[modules.md](modules.md). One is never committed. To make one from a full
module: `npm run slim-module <source.db> modules/kjv.db`, which trims about
50 MB to 4.4 MB by keeping only the two tables the games read.

**Deployment is untested on a real VM.** The unit has never been through
`systemd-analyze verify` and the site never through `nginx -t`; both were
written on Windows. Expect to fix a path on the first deploy.

### Things deliberately left for the next person

- **`server/games/index.ts` holds a stand-in game module** whose rounds carry
  nothing. It is what a room gets when it names a game this build does not
  carry — deliberately, rather than quietly substituting a real game, because a
  room playing something nobody chose is worse than blank screens that say so.
- **`CatalogSet.gameId` is always null.** A question set is authored against
  content, not against a game, so nothing on the server can honestly fill it in.
- **`src/shared/verseId.ts` could use a range-containment helper**
  (`isWithin(id, range)`); the module reader, the importer and the distractor
  arithmetic all re-derive bounds. Separately, `sectionOf` silently returns
  `law` for an out-of-canon book rather than signalling, so every caller in
  name-that-reference has to guard the book number first.
- **Two test helpers ship in the build.** `server/content/fixtures.ts` and
  `server/games/name-that-reference/fixtureCanon.ts` are not named `*.test.ts`,
  so `tsc` emits them into `dist`. Harmless; if they should stay out, both want
  the same exclusion.

---

## What comes next

The goal the owner set is **all eight games testable in one sitting**: with a
group convened, the marginal cost of the seventh game is a few minutes, so one
consolidated round of feedback beats four serial ones.

That makes **content the critical path, not the game modules.** Only three of
the eight generate everything they need from verse text — fill in the blank,
name that reference, and sword drill. The other five (who said it, who am I,
put in order, the category board, the detective game) render nothing without
curated questions in the database.

1. ~~The content generation script and its validator.~~ **Done**, with a first
   batch of 336 questions and 85 orderings. What remains here is tuning after
   the playtest: wrong-answer quality is one function
   (`server/content/generator/distractors.ts`), difficulty is a field in the
   source files, and both are fixed by regenerating.
2. ~~The remaining games.~~ **Done**: all nine are registered, built in one
   shared working tree with no baseline commit, each agent owning
   `server/games/<id>/` and `src/client/games/<id>/`, per
   the 0039 parallel-work plan (not carried over), with the registry lines and the seam
   changes added by the integrator.
3. **Playtest with a real group on real phones over cellular.** Sync and
   reconnect bugs do not appear on a desk with three laptops on wifi, and no
   interface protects against a game simply not being fun. Expect this to change
   the design.

The two games that had no wireframes, describe-it and the detective game, were
built to screens the owner approved.

---

## Open questions for the owner

Answer matching, from the module that now judges every typed answer:

- **A leading article in free text.** `good shepherd` typed for `the good
  shepherd` currently fails — four edits against a budget of two. Stripping a
  leading `the`/`a`/`an` from both sides for buzz-in answers would fix it. The
  recommendation is to do it: a correct answer marked wrong is what makes a room
  lose faith in the scoring.
- **`-est` is also the modern superlative**, so `great` is credited for
  `greatest`. Generosity was chosen deliberately — a wrong rejection costs
  someone their turn and reads as a bug. An exception list is one line of data.
- **Glosses are interchangeable everywhere**, not only beside the archaic word:
  `listen` is credited for `hear` in any question.

Game design:

- ~~Verses are drawn uniformly across all 31,102.~~ **Settled.** There is now a
  curated pool of 566 verses tiered 1–5 by how far each sits from common
  knowledge, and `RoomSettings.familiarity` picks the ceiling a room draws
  under. What is left for the owner is the curation itself: the tiers were
  written in one pass by one reader, and which verse belongs in which tier is a
  judgement a group will disagree with out loud. Moving a line between the CSVs
  and re-importing is the whole of the fix.
- ~~Progressive-clue lockout~~ and ~~sword drill scoring~~: **settled**, see
  Game design above.
- Whether the content database should be committed for convenience, or stay
  generated. Currently generated and ignored, as is `content/generated/`.

Content, from the second wave:

- **The detective game deals as proposed**: the vaguest clue goes to the room
  and the other four one to a phone, so with more than four phones some clues
  repeat. It is built that way to the approved screens; a playtest will say
  whether repeats matter.
- **Who-am-I and the detective game share their 96 people.** Playing both in
  one sitting will bring people round twice. Splitting them halves each game.
- **The clue-giving game is describe-it, the ninth**, dealing from the prompt
  cards.
- **Five answers are picked out by their length** — `John the Baptist` against
  `Andrew`. The check warns on them. The fix is either a length term in the
  resemblance score or wrong answers of similar shape on file.
