# 49 — General registration form 2027-28 made to fulfil the merit criteria, and 50 sample registrations (plan, 26 Oct 2026)

Dev data, school 1 (Alpha). The session "Admissions 2027-28" (Class I, VI, IX, form 1 "General
registration form 2027-28") has seven merit criteria, but they cannot all score:

- **Distance (locality)** reads a `locality` question the form does not ask; the Localities table is
  empty.
- **Alumni parents** names no school and the form does not ask which, so no row is found.
- **Parents' education**: the nine qualifications all score 0.
- **Sibling studies here (checked)** also has the condition "siblings = 1", so two siblings give 0.
- **Child of a staff member** reads `staff_child`, which is optional (blank gives nothing, unasked).
- No total out of 100; the special-child criterion is missing.

The purpose: about 50 registrations whose answers make every criterion score for some and not for
others, so the points can be checked end to end (registration page, score report, merit order).

## Decisions (asked and answered, 26 Oct 2026)

| #   | Question    | Decision                                                                                                                                                                                       |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Form fields | **All four**: Locality (required, from the Locality master, "Not in the list" allowed); CWSN certificate (required when CWSN = Yes); Staff ward required; Alumni school (when alumnus = Yes)   |
| 2   | Remove      | **Both sessions, all**: the 58 Alpha registrations with their receipts, queries, messages and the one admitted student; the families' sign-ins that have nothing else; other schools untouched |
| 3   | Sample set  | **Mixed, registered**: ~50 across Class I (20), VI (15), IX (15); fee paid and registered, waiting at Document check; a few answers for the office to check                                    |
| 4   | Tables      | **Fill + fix criteria**: qualification scores, ~15 localities in three bands, alumni rows; the criteria put right, with caps and a total out of 100                                            |

## The criteria after part 2 (the old formula, out of 100)

| Criterion                      | Reads                                                      | Points                                 |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------- |
| Parents' education             | father + mother from Qualifications                        | up to 20                               |
| Distance (locality)            | the locality from Localities                               | 30 / 20 / 10 by band                   |
| Alumni parents (school list)   | each alumni parent: school + pass-out class from the table | up to 20 together                      |
| Sibling studies here (checked) | a sibling admission no. found among the students           | 26 (the "= 1" condition dropped)       |
| Child of a staff member        | Staff ward = Yes                                           | 25 (staff ward and sibling never both) |
| Girl child                     | gender Female                                              | 5                                      |
| Single girl child              | Female and no sibling                                      | 10                                     |
| Child with special needs       | CWSN = Yes, with its certificate                           | 5                                      |

Total out of 100 (a registration with more is cut to 100).

## Parts

**Part 1 — The form.** Form 1 gains the four questions (with the hide / require rules above);
saved through the form builder's checks; the form PDF and the portal show them.

**Part 2 — Tables and criteria.** The Locality master and table (about 15 localities of Faridabad
in three bands), qualification scores for father and mother, alumni rows for Alpha Public School and
two other schools (X and XII); the session's criteria as in the table above.

**Part 3 — Clear and seed.** A dev-only script `scripts/seed-admission-merit.mjs` (refuses unless the
database is the local one; no message is queued — answers and numbers are written directly, the
points worked out by the API's own Recalculate) removes the Alpha registrations as decided and adds 50
with spread answers: about a third with a sibling (two with a sibling number that is not found), a
fifth staff wards, alumni parents of each kind, every locality band and two "Not in the list", a few
CWSN with and without the certificate. Registration numbers from the session's series; the class's
approval process started at Document check.

**Part 4 — The check.** The script works every registration's points out on its own from the
answers and the tables and compares them with what EduPro saved (each line and the total), then
prints a summary (per criterion: how many scored, the lowest / highest, mismatches = 0) and the score
report's top ten per class. The registration page and the score report are looked at in the browser.
