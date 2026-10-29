# 63 — Number series made easy (placeholders, test, renumber); every candidate in the score report's views (plan, 29 Oct 2026)

Asked:

1. `/admissions/setup/numbers` "is not working": check it and say how it works.
2. `/admissions/score-report`: show every registered candidate of the class (Class I: all 20).

## What was found

- **Number series** works: a new registration (or admission) takes the most specific active series
  that fits it (its class and answers first, then the class, then the session's; none: the default
  APP/ADM-<session>/00001), numbers already given are stepped over, and the e2e tests pass. It feels
  broken because:
  - Save stays grey until a Name of 2+ letters is written, and nothing says so;
  - the form opens on the newest session, "Admission form 2026- 2027", which has no registrations;
  - a series only numbers registrations made after it, so saving one changes nothing on screen (and
    Admissions 2027-28 is closed to new registrations);
  - the prefix is plain text: no session, year or class in it (no prefix: "0001").
  The table already keeps how many numbers a series gave and the last one (`given`, `last_given`).
- **Score report**: the Merit list shows every registration of the class (Class I: 20 rows, 2 of them
  cancelled / not selected and unranked). The **Written test** and **Interview** views list only those
  who reached the stage (Class IX written test: 3 of 15).

## Benchmark

Entab, Fedena, Edunext: the number format is a pattern with session, year and class parts and a
running number, shown as a live sample; the screen says what is missing; a series shows its last
number and how many it gave; re-numbering is an admin action with the old number kept. Result sheets
list the whole class, absentees and those not yet tested included.

## Decisions (asked 29 Oct 2026)

1. **Clear form and guidance**: the form says what is missing ("Write a name"), opens on the session
   with registrations, a short "How it works" box; each series shows how many numbers it gave and the
   last one.
2. **Placeholders in the prefix**: `{SESSION}` (2027-28), `{YYYY}` (2027), `{YY}` (27), `{CLASS}` (the
   class code: I, VI, IX, NUR), with a live preview, e.g. `REG/{SESSION}/{CLASS}/` gives
   `REG/2027-28/I/0001`.
3. **Test a series**: pick a class and answers, see which series it takes and the number it would get,
   without using it.
4. **Renumber existing**: registrations already made get numbers from their series, the old number kept.
5. **Score report views list every registered candidate** of the class.

Decided here, change any before building:

- `{SESSION}` is the session's academic year (as the default numbers use); `{CLASS}` the class's code;
  `{YYYY}` / `{YY}` the session's first year. The prefix may be up to 40 characters once filled.
- Renumbering is for **registration numbers** only, for the registrations of the series' session (and
  class) not yet admitted, in registration order; each keeps its old number in its history and stays
  findable by it (searches look at old numbers too); receipts already printed keep the old number, a
  reprint shows the new one. Admission numbers are never renumbered (they are on students' records).
  A preview lists old → new before anything changes; it needs a reason.
- In a stage view, candidates without marks come after the ranked ones with "-" and no rank;
  cancelled and withdrawn ones last.

## Parts

### Part 1 — Number series

- Migration 0273: `applications.previous_numbers TEXT[]`; the prefix check allows `{}` placeholders.
- API: placeholders filled when a number is given (`seriesNumber`) and in the preview; `POST
  admissions/number-series/test` (class, answers → series, number); `POST admissions/number-series/
  :id/renumber` (preview, then apply with a reason); searches match old numbers.
- Page: the form's hints, default session, How it works, given / last number on each series, the
  placeholder help with a live sample, Test a series, Renumber (preview list, reason, apply).
- Tests: e2e (placeholders filled per class and session; test gives the same series as a real
  registration; renumber keeps old numbers, skips admitted, is found by the old number); a11y; browser.

### Part 2 — Score report views with every candidate

- API: a stage view lists every registration of the class (as the Merit list), the marks where given,
  rank only for those with a total.
- Tests: e2e (Class IX written test view lists all 15, 3 ranked); a11y; browser.

## Not in this plan

Renumbering admission numbers; number formats for receipts or other documents.

## As built (29 Oct 2026)

- **Part 1**: migration 0273 (prefix up to 40 characters; `applications.previous_numbers`).
  `number-series.ts`: `fillPrefix` ({SESSION} = academic year without "Session ", {YYYY}, {YY},
  {CLASS} = class code), `seriesPlace`, `seriesPick` (the most specific series, nothing locked),
  `seriesPreview`, and `seriesNumber` filling the placeholders; unknown `{…}` refused on save. A
  series for every class with {CLASS} keeps one running number for the session (each class its own
  code); its sample shows the first class (`perClass`). `POST admissions/number-series/test` and
  `POST admissions/number-series/:id/renumber` (preview; apply needs a reason; registration series
  only; registrations of the session / class not admitted whose best series it is, in registration
  order; numbers already in the series stay; old number appended to `previous_numbers`, history line
  "Registration no. A → B (renumbered from “name”): reason"). Searches (registrations list, desk,
  counter, approvals, Admissions list grid) match old numbers. Page: How it works (open while there
  is no series), form opens on the session with registrations, placeholder buttons + live sample, the
  missing-name hint, Renumber (old → new list, reason), Test a series (number, session, class, the
  answers the series look at).
- **Part 2**: a score report stage view lists every registration of the class (ranked first, then
  those not yet marked, cancelled / withdrawn last). Alpha Class IX written test: 15 rows, 3 ranked.
- Tests: admission-number-series e2e 4; all admission suites + permission coverage 120; a11y numbers
  page and score report views.
