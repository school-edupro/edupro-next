# 36 — Library (rebuild of the legacy library on the Sprint 17 base)

The legacy library (`Admin/Library`, read for process only) has ten set-up tabs, a book master, circulation,
stock verification, a sell report, a digital library, barcode labels and per-library permissions. Its
masters are mostly name lists nothing reads (books keep author, publisher, subject, vendor and language
as free text), books are one row per copy and per financial year, accession numbers come from a prefix
per library and category without a lock, the book limit is per class (with a hostel count) and staff
are unlimited, there is no fine, and the custom report saves nothing. EduPro Next has had titles, copies
(accession), loans with fines, stock checks, sale and a digital library since Sprint 17 (doc 14, §4).
This module rebuilds the library on that base, benchmarked on library systems schools use (Koha, SOUL,
Libsys) and the larger Indian school ERPs.

## Decisions (21 Oct 2026)

- **Title and copies:** a title is entered once; each copy has its accession number, library, shelf
  and rack, purchase details and status. Editing a title changes every copy.
- **Accession numbers:** automatic, from a prefix per library and material type (B00125, T00031), one
  running series across the years, given under a lock; the librarian may type one instead (checked).
- **Borrowing rules (the legacy Book limit):** per class with a separate rule for hostel students, and
  per staff group: books at a time, loan days, renewals, fine per day (with a cap and grace days). The
  issue desk follows them.
- **Also in this round:** Excel import with a preview (the legacy 42-column layout and ours), barcode and
  spine labels, periodical subscriptions with issues received, and the legacy data import (free-text
  authors, publishers, subjects, languages and vendors cleaned into the masters).
- Masters are the school's, not a year's (the catalogue does not restart each year). Everything follows
  the Mobilise design (tokens only, the shared masters grid, the field picker of the candidates export).

## Parts

1. **Library set-up** (this part): the masters and the borrowing rules, applied at the issue desk.
2. **Book master:** title and copies with the masters linked; add N copies with accession numbers;
   clone; a title's page with its copies, loans and history; copy status (discard, lost and paid, lost
   and found, withdrawn) with a reason.
3. **Book list, custom report and Excel:** filters (library, material, subject, author, publisher,
   language, status, shelf, accession range, dates, stock checked), sorting, the field picker (layouts
   and my last), Excel with an About sheet, audited.
4. **Excel import with preview and the legacy import:** upload, preview new / update / no change /
   error, commit; the legacy layout mapped; free text matched to the masters (new names added).
5. **Barcode and spine labels:** a range or a list of accession numbers, label-sheet presets.
6. **Periodical subscriptions:** a subscription per periodical (from–to, vendor, cost, copies), the
   issues expected from its frequency, issues received or missing.

## Part 1 — Library set-up (migration 0206)

Library → **Library set-up** (`/masters/library`), a tab per master on the shared masters grid (search,
add, edit, active/inactive, Excel download and upload with the same checks):

| Tab | Table | Fields |
|---|---|---|
| Libraries | `library_libraries` | code, name, campus, room or place |
| Material types (the legacy Study materials and Book/Text category) | `library_material_types` | code, name, can be issued, order |
| Accession numbers | `library_accession_series` | library, material type, prefix, digits, next number |
| Subjects | `library_subjects` | name, class number (Dewey), sub-subjects |
| Authors | `library_authors` | name, note |
| Languages | `library_languages` | name, code |
| Publishers | `library_publishers` | name, place |
| Periodicals | `library_periodicals` | name, kind, frequency, language, publisher, vendor, ISSN |
| Shelves | `library_shelves` | library, code, name, racks |
| Vendors | `library_vendors` | code, name, contact person, mobile, phone, email, address, GSTIN |
| Borrowing rules (Book limit) | `library_borrow_rules` | who (student, hostel student, employee), class, staff group, books at a time, loan days, renewals, fine per day, highest fine, grace days |

- Names (subjects, authors, languages, publishers, periodicals) are unique in the school regardless of
  case. Every school starts with a Main library, the usual material types and their prefixes (B, T, R,
  M, AV, MP), the common languages, and three rules: students (all classes) 2 books for 14 days, hostel
  students the same, staff 5 books for 30 days; two renewals; ₹2 a day for students, none for staff.
- **The rule for a borrower** (`app.library_rule`): a student's class is the class of their active
  enrolment (the working year first); a student with a current hostel bed is a hostel student. The
  most specific active rule wins: a hostel rule (the class, then all classes) for a hostel student,
  then a student rule (the class, then all classes); for staff, the staff group, then all staff. No rule:
  the school settings as before (`library.max_loans`, `library.loan_days`, `library.fine_per_day`).
- **The issue desk:** 0 books means the borrower may not borrow; the due date is the rule's loan days;
  renewals stop at the rule's count; the fine on return is (days late − grace days) × the fine per day,
  up to the highest fine. (From part 2, a copy whose material type cannot be issued, such as
  Reference, is not issued, as reference titles are not today.)
- Library set-up is the page title (`/masters/library`); Titles, Copies and Digital library stay as tabs
  after the new ones until part 2 gives the book master its own screens.
- Tests: `library-setup.e2e-spec.ts` (the starting rows and tab order; names unique regardless of case;
  vendor code and GSTIN, ISSN, library of a shelf, accession prefix checked; the coordinator may not
  change the set-up; a class rule, a hostel rule before it, a staff group that may not borrow, the
  all-staff rule, no renewal, a fine after grace days held at the highest fine); `a11y.spec.ts` (the
  set-up tabs and the rule form).
