# 22. Student strength reports (2026-10-02)

Rebuilt from the school's current PDFs (class-wise student report, class-wise caste report by master
class, discount-wise summary, class-wise age report). Reports → Student strength (`/reports/strength`),
permission `people.student.view`; section-scoped users see their sections only.

## Decisions

| Question                           | Decision                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class XI–XII when grouped by class | Class + stream (XI-SC, XI-COM, XI-HUM; Science, Commerce, Humanities order)                                                                       |
| Caste report columns               | The Category list; short codes count as their value (GEN = General); other values on file (e.g. EWS) get their own column; "Not given" when blank |
| Age report date                    | Entered by the user before the report runs (no default)                                                                                           |
| Students counted                   | Active enrolments of the session; a tick includes students who left (withdrawn / transferred / left)                                              |

## Build

- `packages/db/src/strength-reports.ts`: `buildStrengthReport` (columns with optional group for the
  F / M / T two-row header, rows with section / class subtotals and a grand total, scope per row) and
  `strengthStudents` (the students behind one count). Concession columns come from `fee_discounts` of
  the session via `student_fee_profiles.discount_id`, plus General (none).
- API `reports/strength`: `GET options`, `GET` (table), `GET students`, `POST export` (dataset
  `strength_report`, formats xlsx / pdf).
- Workers `renderers/strength-report.ts`: school letterhead, merged two-row header, bold class subtotals,
  navy grand total; Excel freezes the header and the class column; PDF repeats the header, A4 portrait,
  landscape over 10 columns, A3 over 30 (age report).
- Filters: session, classes, sections of those classes, group by (section with class totals, class,
  class + stream), include left students, show empty sections, as-on date (age), discount (discount report).
