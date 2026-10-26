# 48 — Merit score tables (school, distance, education, alumni, sibling) and number series (plan, 26 Oct 2026)

Merit points today (docs/design/40) are criteria on form answers: "when [question] [is / any of …]
[answer] → N points". One criterion gives one fixed number. That fits sibling, girl child or single
parent, but not the schools' scoring masters of the old system:

- **Qualification Master** — about 220 qualifications, each with a mother score and a father score
  (and weights, all 0 today); 220 criteria × 2 would be needed.
- **Distance Based Scoring** — per class and branch: locality / sector → distance band (0-8 km,
  8-15 km, 15-above) → score, an area letter, the branch it belongs to.
- **School List** — the alumni school and the class the parent passed out of (10, 12, Others, Both)
  → score; "Others DPS" for any other branch.
- The old formula: sibling 26 (or staff ward / sibling 20) + distance + father alumni + mother alumni,
  and a score report "out of 100".

Numbers today: the registration number is `APP/<session code>/00001`, one series per session, given
when the registration fee is paid; the admission number continues the school's last number, given when
the admission fee is paid. The old system set a series per admission year × class × board × round ×
student type, separately for registration and admission numbers (prefix + start number, preview
"Final RegNo will be: DP10001").

What the best do (Entab, Edunext, the Delhi nursery points system, admission CRMs): scoring tables as
masters, imported from Excel; a criterion "points from a table" for a form question; caps per
criterion and a published maximum (100); the breakdown per registration "x of y"; a score report with
a column per criterion and the rank; the point tables on the public admission page; number series per
class and round with a preview and no gaps or repeats.

## Decisions (asked and answered, 26 Oct 2026)

| #   | Question      | Decision                                                                                                                                                                                                                              |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Point tables  | **Score tables + criteria**: masters in Admission set-up (Qualifications, Localities, Schools), each importable from Excel; a merit criterion "points from a table" links a form question to a table, per session / class (doc 40)    |
| 2   | Distance      | **Locality list**: the family picks its locality / sector from the school's list; the list gives the band and score per class and branch; "Not in the list" goes to the office to place                                               |
| 3   | Education     | **Add both**: father's score + mother's score from the Qualifications table (the weights kept, unused while 0)                                                                                                                        |
| 4   | Alumni        | **Each parent, capped**: each alumni parent's points from the Schools table (school + pass-out class); both together up to a cap the school sets                                                                                      |
| 5   | Sibling etc.  | **Checked + proof**: a sibling is found in the student master by admission no. (active, same family); girl child from the gender; special child (CWSN) needs its certificate, confirmed at Document check                             |
| 6   | Number series | **Series per class**: per session × class (and optionally branch / board, round, student type): prefix, start number, digits, a live preview; separate for Registration no. and Admission no.; a class without one uses the session's |
| 7   | Number timing | **As today**: registration no. when the registration fee is paid (or none is due); admission no. when the admission fee is paid                                                                                                       |
| 8   | Extras (all)  | Total out of a maximum (e.g. 100) with each criterion's cap; a registration-wise score report (Excel / PDF); the point tables on the public page; a Recalculate button per class                                                      |

Defaults taken (change on request): the tables belong to the school and are reused across sessions
(a session's criteria point at them, so a change shows from then on; points already confirmed at
Document check stay); an answer not in a table gives 0 and is flagged on the registration ("Locality
not in the list", "Qualification not in the table") for the office to place; a cap cuts the points,
never adds; a series' next number never goes back (a cancelled registration keeps its number, as now);
two series may not give the same number (checked on save); the existing `APP/…` numbers stay.

## Parts

**Part 1 — The score tables (API, admin; built 26 Oct 2026, migration 0258).** Admission set-up gains a **Score tables** tab:
**Qualifications** (name, father score, mother score, father weight, mother weight), **Localities**
(name, distance band, area, score; for a class or every class; for a branch or every branch) and
**Schools** (school name, pass-out class — 10, 12, Others, Both —, score). Each: search, add, edit,
archive, Excel import with a check of every row and a sample sheet, Excel export. The form builder
offers these tables as option lists (`list: 'qualification' | 'locality' | 'alumni_school'`) so the
family picks from them; a locality answer may be "Not in the list" with a text box.

**Part 2 — Criteria that read the tables (packages/db engine, API, admin; built 26 Oct 2026).** A merit criterion gets a
kind: **fixed** (today's) or **from a table** (question → table → column: father score, mother score,
locality score, alumni score). Each criterion may have a **cap**; the session (or class) has a
**maximum** (e.g. 100). Ready starters for the old formula: Father's education, Mother's education
(add both), Distance (locality), Father alumni, Mother alumni with "Alumni together at most N",
Sibling (checked), Staff ward, Girl child, Special child (CWSN). The breakdown shows each line "x of
y", the reason a line is 0 ("not in the table"), and the total "of 100".

**Part 3 — Checks, recalculation and the office (API, admin, portal; built 26 Oct 2026).** Sibling: the admission no.
answered is looked up in the student master (active, same mobile / guardian, any class): found → the
points; not found → 0 with "Sibling not found" for Document check. Girl child from the gender answer;
CWSN needs its certificate uploaded, its points confirmed at Document check. "Not in the list" answers
are placed by the office (choose the locality / qualification; the points follow, audited). A
**Recalculate** button per class (and per session) works the points out again for registrations not
yet past Document check, showing how many changed. The public admission page shows each class's
criteria with the tables (distance bands with their localities, qualifications, alumni schools).

**Part 4 — The score report (API, admin; built 26 Oct 2026).** Admissions → Reports → **Score report**: a row per
registration of a session and class — registration no., candidate, each criterion's points as a
column, form points, test / interview marks, total, rank (the merit order of doc 40 with its tie-break)
— with filters (class, category, status, "has a line to check") and Excel / PDF on the letterhead. The
same columns are in the Admissions dataset for the lists and the report builder.

**Part 5 — Number series (API, admin; built 26 Oct 2026, migration 0258).** Admission set-up → **Numbers**: for Registration
no. and for Admission no., a list of series, each for a session and a class (or every class), and
optionally a branch / board, a round and a student type: prefix (e.g. `DP1`, `N2026`), start number,
digits (e.g. 4 → `0001`), the live preview "Next: DP10001", the last number given. A number is taken
from the most specific series that matches (class + round + type, then class, then the session's, then
today's default) under a lock, so two payments at once never share one. Saving refuses a series whose
numbers would meet another's or one already given. The registration page and the receipts show the
number as now.

As built (26 Oct 2026): classes do not belong to a branch in EduPro, so a locality is for a class or
every class (a branch-wise list is a class-wise one); a series' board, round or student type is an
answer of the form ("only for registrations whose answer is …"). Screens: Admission set-up → **Merit
score tables** (`/admissions/setup/score-tables`) and **Number series** (`/admissions/setup/numbers`);
the session's **Merit points** tab (kind, table, cap, total out of, Recalculate); Admissions → **Score
report**. The engine (`workPoints(criteria, answers, tables)`, `pointsTotal(lines, max)`) reads the
tables through `pointTablesFor` (apps/api …/score-tables.ts); a line carries `check` when the office
should look at it. The Admissions dataset gains Form points, Points by criterion and Points to check.
The office places an answer not in a table by correcting the answer on the registration (docs/design/37,
case 1b); the points follow.
