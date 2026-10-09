# Content

Everything a game asks about comes from one of two places, and they are not the
same kind of thing:

- **A Bible module** (`modules/*.db`) is somebody else's asset — read only,
  interchangeable, never committed. `docs/features/modules.md` covers installing one.
- **The content library** (`data/content.db`) is the work of the people running
  the games: the curated verse pool, questions, ordered lists and prompt cards.
  It is generated from the files in `content/` and is not committed either —
  the files are the source, the database is the build.

## The verse pool, and why it exists

Two of the games generate their questions from verse text alone, which meant
they could draw from the whole canon. Playing a few rounds showed exactly what
that produces: Job, obscure Jeremiah, and the back half of Judges. Nothing was
wrong — that genuinely is where most of the 31,102 verses live — but it is not a
game a mixed group enjoys, and no amount of difficulty tuning inside a game
fixes it, because the difficulty was never in the question.

So a room now draws from a curated pool, tiered by how far a verse sits from
common knowledge:

| Tier | Meaning | Roughly |
| ---- | ------- | ------- |
| 1 | The verses a group can finish out loud | John 3:16, Psalm 23:1 |
| 2 | Well known | Romans 8:28, Isaiah 40:31 |
| 3 | Recognisable to a regular reader | Hebrews 11:6, James 4:8 |
| 4 | A well-read adult knows it | Micah 7:18, Ezekiel 22:30 |
| 5 | For a group that reads closely | Haggai 1:5, 1 Chronicles 12:32 |

`RoomSettings.familiarity` picks the **ceiling**, not the tier: `core` draws tier
1, `familiar` draws 1–2, `broad` (the default) draws 1–3, `deep` draws
everything curated. A mixed quiz is a better quiz, and a group that asked to go
deep still enjoys John 3:16 turning up.

`any` is the odd one out, and deliberately so: it means no pool at all, the
whole canon drawn uniformly. That is a real choice for a group that wants
Obadiah, and it is also what a server falls back to when nothing has been
imported — so an unconfigured server still plays, it just plays worse.

Difficulty here is a property of the **verse**, never of the people. `deep` does
not mean the group is clever; it means the verses come from further in.

## Authoring

`content/verses/*.csv` — one row per verse:

```csv
reference,difficulty,tags
Romans 8:28,1,promise
```

References are written the way people write them (`Romans 8:28`, `1 Cor 13:4`,
`Ps. 23:1`, `Jude 24`), because a list of eight-digit verse ids is a list nobody
will ever proof-read. Book and section are **derived**, never authored: a
hand-typed book number that disagreed with the reference would make a host's
"gospels" filter quietly wrong.

`content/prompt-cards/*.json` — cards for the clue-giving game:

```json
{ "concept": "Noah's ark", "category": "event", "difficulty": 1,
  "forbidden": ["flood", "boat", "animals", "rain"] }
```

The concept's own words are always forbidden, so none of them is ever listed:
"Jonah and the great fish" does not forbid "fish". The importer refuses a card
that lists one, as `forbidden-repeats-concept`, and names the word. It compares
words the way it compares text everywhere (case and punctuation aside), reads a
possessive as its base word ("lions'" is "lions", "Balaam's" is "Balaam"), and
ignores small words like "the" and "of". The four forbidden words should be the
*obvious* ones: taking away what a person would actually reach for is what
makes the game, while taking away an obscure synonym only makes it feel unfair.

Questions, sets and ordered lists use the same importer; `server/content/importer.ts`
documents every field and every rejection reason.

## Generated questions

Five of the games — who said it, who am I, the detective game, put in order
and the category board — ask about content no verse generates on its own. Their
questions are not written one by one. Facts are written once, in
`content/source/`, and a generator turns them into rounds:

| File | Holds | Feeds |
| ---- | ----- | ----- |
| `people.json` | people: sex, era, roles, how well known, and up to five clues | who am I, the detective game, and every wrong answer that is a person |
| `places.json` | places: kind, testament, how well known | wrong answers that are places |
| `sayings.json` | a verse, who spoke it, and the words exactly as the verse has them | who said it |
| `timelines.json` | stories in the order they happened | put in order |
| `board.json` | categories of five questions, easiest first | the category board |

The split exists so that a playtest's findings are fixed in one place. Wrong
answers are *chosen*, not written: each candidate is scored by how much it
resembles the true answer — same sex first, then the same part of the story,
then shared roles — and the most plausible three lead. When a group finds them
too easy, the fix is a weight in `server/content/generator/distractors.ts` and a
regeneration, not three hundred hand edits.

A game finds its own material by tag: `who-said-it`, `who-am-i`, `detective`,
`category-board` on questions, and one set per board category. Put-in-order
reads the ordered lists. A who-am-I reveals all five clues in order; a detective
case shows the first clue to the room and deals the other four out to phones.

Generation is deterministic, and each item draws from its own seed, so adding a
saying changes that saying's question and nothing else. The output in
`content/generated/` is rebuilt from the sources and is not committed; edit the
sources.

## The tool

```
npm run content -- generate                         # rebuild content/generated from content/source
npm run content -- check  content/verses content/prompt-cards content/generated
npm run content -- import content/verses content/prompt-cards content/generated
npm run content -- stats                            # what the library holds
```

A directory stands for the `.csv` and `.json` files directly inside it, because
a Windows shell will not expand `*.json` for you.

After importing, `check` and `import` run the content checks in
`server/content/validate.ts` over everything the database holds. These fail the
run:

- a who-said-it quotation that is not, word for word, in the verse it cites;
- a prompt or clue that names its own answer, in a game where that ends the
  round;
- a wrong answer the typed-answer matcher would mark right;
- a reference to a verse the installed module does not carry.

And these are reported for a person to judge: a clue whose chapter never names
its person (usually a wrong reference, occasionally a pronoun), an answer much
longer than every wrong option, a board column that does not climb, and a game
with too little material or nothing easy in it.

`check` is a verb rather than a flag because the expensive failure in content is
never the file that refuses to import — it is the file that imports quietly and
puts a broken question in front of thirty people. It imports into a throwaway
in-memory database, so it runs exactly the validation the real import runs and
cannot touch anything, and it then does the one thing the importer itself cannot:
opens the installed module and confirms every curated verse exists there and is
long enough to ask about. That check has already caught four verses too short to
play — `In your patience possess ye your souls` is seven words and a hopeless
fill-in-the-blank.

Anything rejected exits non-zero, so this can gate a deploy rather than merely
inform one.

## Re-tiering

Move the line to another file, change its `difficulty`, and re-import. A verse
is identified by its verse id, so a second import re-tiers rather than
duplicating. Two rows for the same verse *inside one file* are rejected, because
those two rows usually disagree and there is no way to tell which pass the
author meant.
