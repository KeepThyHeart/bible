Hymns
=====

A small public-domain hymn library, in the format the presenter reads.

This is a **seed**, not the library. It exists so the hymn path is exercised
end to end by real files rather than fixtures, and so the format has something
concrete to be judged against. The intent recorded in
`admin/blackboard/controller-viewer/hymn-format.md` is that the library grows up
into a repository of its own, independently versioned and separately
contributable.

Nothing here has to move for that to happen. The layout below is the layout that
repository would have, and the server reads whatever directory it is pointed at:

    BIBLE_HYMNS_DIR=/path/to/hymns-repo

Falling back to this directory, and then to `<data>/hymns` so an install can add
its own without touching the checkout. There is no submodule, no build step and
no compiled index -- a few hundred hymns parse in milliseconds at startup, which
is why `index.json` is a good idea later and a pointless one now.


Layout
------

    hymns/
      en/
        amazing-grace.hymn
      PROVENANCE.md          why each hymn is public domain, and from which edition
      README.md

`.hymn` rather than `.txt` so a validator can glob unambiguously and editors can
be pointed at the format.


Format
------

Specified in `admin/blackboard/controller-viewer/hymn-format.md`. In brief:

    ===
    id: amazing-grace
    title: Amazing Grace
    first-line: Amazing grace! how sweet the sound
    author: John Newton
    text-year: 1779
    tune: NEW BRITAIN
    copyright: public-domain
    verse-order: 1 R 2 R
    ===

    [verse 1]
    Amazing grace! how sweet the sound

    [refrain]
    ...

Sections are named -- `[verse N]`, `[refrain]` (or `[chorus]`), `[bridge]`,
`[coda]`, `[interlude]` -- so a refrain sung between every verse is written once
and ordered by `verse-order`, rather than copied three times and corrected in
three places.

Two parser rules are worth knowing before adding a file:

  * **An unrecognised bracketed directive is a hard error.** Only `[T:10.3]` and
    `[T:1:01.4]` timestamps are directives. The old format silently stripped
    anything else, which is how a whole file's timings were lost without anyone
    noticing.
  * **An unrecognised metadata key is kept, not dropped.** The field set is open
    on purpose. A typo produces a warning, never a silent deletion of somebody's
    contribution.

`copyright: public-domain` is required. The parser refuses anything else rather
than assuming, which is the point of the field.


Timestamps and audio
--------------------

Optional, and only worth doing for a hymn that will be sung to a recording. A
congregation singing to a piano advances by hand, which is the normal case.

    [T:0.0] Amazing grace! how sweet the sound
    [T:10.3] That saved a wretch like me!
    [T:1:01.4] I once was lost, but now am found,

Seconds (`10.3`) or minutes and seconds (`1:01.4`), always prefixed `T:`. There
is one syntax and anything else in brackets is a parse error, deliberately: the
system this format descends from accepted `[T:10.3]` in its parser but stripped
*any* bracketed token from the text, and its own sample file used a bare
`[10.3]` -- so every timestamp in it was silently discarded and the file still
rendered, so nothing ever complained.

Three rules that are easy to get wrong:

  * **Timestamp every line, not every slide.** Slides are packed at display time
    from a character budget, so where they break is not known when the file is
    written. Each slide takes its cue from its own first line.
  * **Record when the line is *sung*, not when you want it shown.** The lead
    time -- currently two seconds, so the words are up slightly before they are
    needed -- is applied when slides are packed. Pre-offsetting applies it twice.
  * **Within about half a second is close enough.** Slides change every ten to
    twenty seconds and there is a two-second lead absorbing the difference.
    Precision beyond that is wasted effort.


### Capturing them

There was a purpose-built tool for this once. There does not need to be one
again: it is a page with an `<audio>` element and a key listener. Save this
beside the audio file, open it, play, and press Enter at the start of each line.

    <audio id="track" src="./amazing-grace.mp3" controls></audio>
    <pre id="out"></pre>
    <script>
      const stamps = [];
      addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        stamps.push(`[T:${track.currentTime.toFixed(1)}]`);
        out.textContent = stamps.join('\n');
      });
    </script>

That prints one prefix per line, in order, ready to paste onto the front of each
line of the hymn. Enter rather than the space bar, because space toggles
playback when the audio element has focus.

Two refinements if a hymn is long enough to be worth it: paste the hymn's lines
into the page and emit finished lines rather than bare prefixes, and add a key
that drops the last stamp so one mistimed press does not mean starting over.

Getting it wrong is cheap to find. The parser requires timestamps to increase
monotonically through a file, and the test suite parses every hymn in this
directory, so a bad one fails:

    cd apps/web && npx vitest run server/__tests__/hymns.test.ts


### The audio files themselves

Public-domain or self-recorded only. A recording is a separate work from the
text and the tune, and a modern performance of a public-domain hymn is under
copyright like any other recording. The `audio:` path is relative to the hymn
file.

Audio does not belong in git: it is large, it does not diff, and it is better
distributed as a release artifact or fetched at install time, the way this app
already fetches its fonts and its embedding model.

**Nothing plays audio yet.** The format carries timestamps and the packer puts a
lead-adjusted cue on every slide, but the viewer ignores it and advances only
when the presenter says so. The data is there for when that is built; until
then these fields are inert, and a hymn is no worse off without them.


Adding a hymn
-------------

1. Transcribe from a dated edition, and prefer a scan to a lyrics site -- those
   routinely carry modern edits that are themselves under copyright.
2. Record in `PROVENANCE.md` where the text came from and why it is public
   domain: publication before 1929, the author's death date plus term, or an
   explicit dedication. Do the same for the tune, separately, because they are
   separate works.
3. Watch for the three traps in particular: a modern **translation** of an old
   text, a modern **arrangement** of an old tune, and a hymnal's **updated
   wording**. Each is a new work with its own copyright. The parser enforces the
   first two by requiring `translator-year` and `arrangement-year` whenever
   `translator` or `arranger` is present; it cannot detect the third, so that
   one is on the transcriber.

A hymn that cannot clear this does not belong here. The presenter's **custom
text** item exists for anything a church projects under its own licence, which
keeps the obligation with whoever actually holds it.
