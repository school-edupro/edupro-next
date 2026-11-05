# 76 · Toppers: any number, a subject's own toppers, a % range

Status: built 5 Nov 2026 (no migration; **As built** at the end). Asked by the school on a mark register's
Run, Reports → Toppers (`/exams/schemes/:id/register?place=…&report=toppers&top=5`).

## What it does today (doc 68, phase 2)

- **Top** is a drop-down of 3, 5 or 10 (the API takes only those).
- **Overall Toppers — Top N · by Final Total**: students who passed, by their rank in the class (or the
  section), every tie at a position shown; a class adds **Top 3 of VIII-A**, **Top 3 of VIII-B** (always 3).
- **Subject Toppers**: each subject's single highest mark (all ties, "Full marks" marked).
- Picking a **subject** only narrows Subject Toppers to it: the overall and section lists still rank by
  the final total, so "English toppers" cannot be seen.

## Benchmark

- **Educore** Exam Analytics: class toppers = the top 10 by total; subject toppers = pick a subject, the
  top 10 in it (10 fixed).
- **NexTerp**, **MyClassBoard**: toppers by class, section and session filters, students in descending
  order of the marks of the subjects chosen, section-wise toppers, Excel.
- **PowerSchool**: honor roll levels by a GPA threshold (e.g. 3.5 and above) — a range, not a count.
- None found lets the user type the number _and_ a % range; EduPro can offer both.

## Decisions (user, 5 Nov 2026)

| Question                      | Answer                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| "Work as lower"               | A **Lowest first** switch: the same lists from the bottom                             |
| % range with Top N            | **The range first, then the top N** of those in it; Top empty = everyone in the range |
| A class's section lists       | **The same N** as the class                                                           |
| Who is in a subject's toppers | **Anyone with marks in it** (not only an overall pass)                                |

## Plan

1. **Top — any number**: a number box (1–100) instead of 3 / 5 / 10; empty = everyone (useful with a %
   range). The API takes `top` 1–100. The class's section lists take the same N (question 3).
2. **A subject picked → that subject's toppers** (by its total in the register, its % and grade):
   - a class: **"English toppers — Top N of the class"** (position, student, section, adm no, marks,
     %, grade), then **"English toppers — Top N of VIII-A"**, **"… of VIII-B"**;
   - a section: **"English toppers — Top N of VIII-A"**;
   - an elective slot (Third language): each language apart (German, French …), as Analysis does;
   - competition positions (1, 1, 3), every tie at the last position shown; students absent in it
     (a code that holds the total) or with marks missing are left out.
     With **All subjects** the report stays as it is (overall by the final, sections, subject toppers).
3. **% from – to**: two boxes (0–100) under Top; the lists keep only students whose % is in the range
   (the final % with All subjects, the subject's % with a subject), then take Top N (question 2). The
   titles say so: "Top 5 · 60%–80%".
4. **Lowest** (question 1): a switch **Highest first / Lowest first**: the same lists from the bottom
   ("Lowest 5 of the class"), every student with a final (pass, compartment or fail) or with marks in
   the subject counted.
5. The Run page keeps the filters in the link (Download and the PDF / Excel follow them); help and doc
   68 updated; unit tests (subject toppers, ties, range, lowest), the register e2e, a11y of the page.

## Built where

- `packages/db/src/mark-register-reports.ts` `toppers()` (`ReportInput`: `top` 1–100 or none,
  `pctFrom`, `pctTo`, `lowest`, `subject`); `apps/api/.../mark-schemes.dto.ts` `RegisterQuerySchema`
  (`top`, `pctFrom`, `pctTo`, `lowest`); `MarkSchemesService` passes them; the admin Run page
  (`/exams/schemes/[id]/register`): the number box, the two % boxes and the switch beside Reports.

## Questions for the school

Answered 5 Nov 2026 (Decisions above).

## As built (5 Nov 2026)

- **Engine** (`toppers()` in `packages/db/src/mark-register-reports.ts`; `ReportInput.top` 1–100 or null,
  `pctFrom`, `pctTo`, `lowest`): one `pick()` takes the first N of a pool by a value, highest or lowest
  first, with competition positions within the list (every tie at the last position kept); the % range
  filters the pool first; "Nobody in this range" when a list is empty. Toppers by the final: who passed;
  lowest: every final (pass, compartment, fail). A subject picked: its % (ties by name), every taker
  with marks (absent / missing left out), the class then each section, each language of a slot apart;
  "Full marks" only for the highest. Titles: "English toppers — Top 5 of the class · by the subject’s %
  · 60%–80%", "Overall — Lowest 5 of the class · by Final Total", "All of VIII-A, lowest first". Positions
  are now within each list (a compartment no longer leaves a gap in the toppers' positions).
- **API** (`RegisterQuerySchema`): `top` 1–100 or `all` / empty (= null), `pctFrom`, `pctTo` (0–100),
  `lowest`; `register()` refuses a "from" above the "to" (400).
- **Admin** Run page: **Top** a number box (empty = All), **% from**, **% to**, **Order** (Highest /
  Lowest first) and a **Show** button (number boxes do not send the form by themselves); a "from" above
  the "to" is swapped; the help line under the controls; the downloads carry the filters (the
  `/api/exam-register` route takes them).
- **Tests**: unit (a subject's toppers, ties, lowest with a range, all with a range, nobody, the lowest
  finals; the section lists take N); `mark-registers` e2e (English toppers of the class and sections, the
  lowest in a range, the 400); the Run page in the browser with axe (register 418, VIII, English, 2,
  60–80, Lowest first; the Excel link keeps the filters).
