# Read the Bible module format; share no code

## Decision

This project reads Bible module files directly and depends on no library from
the Bible study application that produces them. It adopts that format's verse
identity scheme — `book * 1000000 + chapter * 1000 + verse` — deliberately and
exactly.

## Why

What the games need from a Bible library is small and stable: the verse
identity formula, a table of book names, and a way to read verse text. All of
it fits in two files here.

What depending on that library would cost is not small. It is an unpublished
workspace package with a build step of its own, a browser and node export
split, and a release cadence tied to a different application. Every one of
those becomes a permanent tax on a project whose actual difficulty lies in
real-time synchronisation, not in Bible data access.

Sharing the *format* keeps the valuable part of the compatibility. Content
authored here — question sets, ordered lists, curated reference pools — stays
meaningful against any module, and a module produced by that application drops
straight in.

## Consequences

- Verse identity is duplicated, in about forty lines. That is the trade, and it
  is worth it.
- If the library is ever published, adopting it becomes an ordinary dependency
  decision rather than a rescue.
- Modules are read only, and only two of their tables are touched, so a module
  gaining new apparatus cannot break the games.
