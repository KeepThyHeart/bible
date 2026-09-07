Third-Party Notices
===================

This repository is licensed GPL-3.0-or-later (see `LICENSE` at the repo root). It also redistributes the following third-party material under its own terms.

The app icon
------------

The app icon is a derivative of the Font Awesome Free `book-bible` glyph (solid style), recoloured white and composited onto a rounded tile. CC BY 4.0 permits that modification, and GPL-distributed and commercial use, on condition of attribution:

> "book-bible" icon by Fonticons, Inc., from Font Awesome Free
> (<https://fontawesome.com>), licensed CC BY 4.0
> (<https://creativecommons.org/licenses/by/4.0/>). Modified: recoloured and
> composited onto a background tile.

The licence grants no rights to the Font Awesome name or logo, neither of which is used here.

The source artwork is `admin/brand/icon.svg`, which carries this attribution inline, as do the icons generated from it into `apps/web/public/icons/` -- so the credit ships with the files that are actually served.

Fonts
-----

The web app self-hosts its reading fonts and bundles the Font Awesome webfonts, all under SIL OFL 1.1, which requires the notice to accompany the fonts. `apps/web/scripts/fetch-fonts.mjs` generates `apps/web/public/fonts/FONT-LICENSES.md` alongside them, and it ships to `dist/client/fonts/`.
