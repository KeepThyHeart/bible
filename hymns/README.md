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
