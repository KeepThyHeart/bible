# Licences of the fixture data

Taken verbatim from each module's `module_info` (`license_spdx`, `license_url`, `copyright`).

| Module | File | `license_spdx` | `copyright` | `license_url` |
|---|---|---|---|---|
| ASV (American Standard Version 1901) | `modules/bible_asv.db` | PD | Public Domain | https://creativecommons.org/publicdomain/mark/1.0/ |
| KJV (1769, Strong's + morphology) | `modules/bible_kjv.db` | GPL-2.0-or-later | GPL | https://www.gnu.org/licenses/old-licenses/gpl-2.0.html |
| Barnes' New Testament Notes | `modules/commentary_barnes.db` | PD | Public Domain | https://creativecommons.org/publicdomain/mark/1.0/ |
| John Wesley's Notes on the Bible | `modules/commentary_wesley.db` | PD | Public Domain | https://creativecommons.org/publicdomain/mark/1.0/ |
| American Tract Society Bible Dictionary | `modules/dictionary_amtract.db` | PD | Public Domain | https://creativecommons.org/publicdomain/mark/1.0/ |

The KJV module is the SWORD KJV with Strong's numbers and morphology, licensed GPL-2.0-or-later
(compatible with this repository's GPL-3.0-or-later). Its own description notes that the rights to
the base text are held by the Crown in the UK (decision H1: accepted as-is).
`main.db` holds only reference tables (books, chapters, verse refs) and the five `module_metadata` rows.
