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

## Part 2 — the book master (migrations 0207, 0208)

- **Data:** `library_titles` gains its links (material type, subject and sub-subject, publisher and
  place, language, class), subtitle, volume, call number and keywords; the title code is given
  (`T000001`) when none is typed. `library_title_authors` holds the people in the order printed (author,
  editor, translator, illustrator). `library_copies` gains library (every copy has one; an older call or
  an upload without one goes to the Main library), shelf and rack, barcode (unique in the school), how it
  came (purchase from a vendor with bill no., bill date and PO no.; or a donation and the donor), and the
  status date and reason. `library_copy_events` keeps each copy's history (accessioned, details changed,
  moved, withdrawn, lost, lost and paid with the amount, found again, damaged, back in use). The titles
  and copies already there were linked: their author, publisher, language and category (the old
  subject) became master rows; reference titles became the Reference type; copies went to the Main
  library. The text columns (author, publisher, language, category) stay as the names of the links.
- **Accession numbers:** `app.library_take_accessions(series, n)` locks the series of the copy's library
  and the title's material type, gives the next n numbers padded to its digits, skips any number a copy
  already has (one typed by hand) and moves the series on. Typed numbers are taken as written
  (capitals, no spaces) and refused when used. No series for the library and type: refused with the way
  to add one.
- **Checks:** ISBN 10 or 13 with the right check digit (kept without hyphens); the sub-subject one of the
  subject's; a shelf of the copy's library and a rack of that shelf; vendor and bill for a purchase only,
  donor for a donation only; bill date on or before the date of accession; a barcode for one copy at a
  time; masters that are switched off refused. A new author or publisher name joins its master.
- **API (library.catalogue.view / .manage):** `GET library/books` (search title, subtitle, author, code,
  call number, ISBN, accession number, barcode; filters library, material type, subject, copy status;
  copies, on the shelf, issued), `GET library/books/setup` (the form's lists and each series' next
  number), `GET library/books/suggest` (author or publisher names), `GET library/books/match` (the same
  ISBN or title), `GET library/books/:id`, `POST library/books` (a title with its first copies), `PUT
  library/books/:id`, `POST library/books/:id/copies`, `PUT library/copies/:id`, `POST
  library/copies/:id/status`.
- **Copy status:** withdrawn and damaged need the copy back; lost or lost and paid (the amount) while on
  loan closes the loan with the reason; found again only from lost; back in use from damaged or
  withdrawn; a sold copy stays sold. At the issue desk a title whose material type cannot be issued is
  refused as a reference title.
- **Screens:** Library → **Books** (`/library`): search and filters, the counts, Add a book. **Add a
  book** (`/library/books/new`, `?from=` clones another title without its ISBN): the book, authors and
  others in order (names suggested from the masters), publication, and the first copies (the number from
  the series shown, or the numbers typed; shelf and rack of the library; purchase or donation); a title
  already in the catalogue is shown before it is entered twice. **The book's page**
  (`/library/books/:id`): the book with its copies on the shelf, issued, lost and damaged; Edit, Clone;
  tabs Copies (where, status or who has it and when due, how it came, price; Edit and Status in a side
  panel; Add copies), Loans and History. The old Titles and Copies tabs of Library setup are hidden (the
  grid stays for Excel until part 4).
- Tests: `library-books.e2e-spec.ts` (a title with people and links and three copies from the series;
  the new names in the masters; the checks; the same book found; copies typed and from the series with a
  typed number skipped; a copy moved and its barcode unique; the title changed and the names others show;
  copy status with the loan closed; a reference type not issued; the list's search and filters);
  `a11y.spec.ts` (the list, the form, the book's tabs, the edit page, a copy's status panel).

## Part 3 — the book list's filters, the register of copies, custom report and Excel (migration 0209)

- **Filters** (`bookFilter`, shared by every view and the export): find (title, subtitle, author, code,
  call number, keywords, ISBN, accession number, barcode), library, material type, subject, language,
  class, shelf and rack, author (part of a name, any of the title's people), publisher, copy status,
  purchase or donation, vendor, accession numbers from–to (the same prefix; compared by their number, so
  B00002–B00010 holds B00009), accessioned from–to, year from–to, stock check (never, or checked since a
  day). A title is kept when one of its copies matches; its counts are of the copies that match.
- **Sort** (`bookSort`): title, author, accession number (its prefix, then its number: 1, 2, 1001, B00001
  …), call number, year, publisher, price, date of accession, status, library; up or down; 25, 50 or 100
  a page.
- **Books** (`/library`): tabs **Titles** and **Copies (accession register)** with their counts; the
  main filters, "More filters" folded (open when one of them is set), sort, order, per page, Clear.
  `GET library/books/copies` gives the register (each copy with its title, place, status and borrower
  with the due date, how it came, the last stock check, the price).
- **Excel:** "Export to Excel" gives every field of the tab's level, as filtered and sorted; "Customise
  export" opens the shared field picker (`components/FieldPicker.tsx`, also behind the candidates'
  export): one row per copy or per title (the fields of the other kind leave; "every field" follows the
  kind), start from my last choice, every field, nothing or a school layout, the fields by group (the
  book, publication, the copy, how it came, loan; for titles the copies counted: copies, on the shelf,
  issued, lost, damaged, withdrawn, value of the copies, times issued), the order arranged, save as a
  layout, download. The file: Copies or Titles (header frozen, a filter on every column, dates as dates)
  and "About this export" (school, when, by whom, rows and their kind, the filters in words, the fields);
  up to 20,000 rows. Every export is in the audit log (`library.export`).
- **API:** `GET library/books/export/setup`, `POST library/books/export` (filters, sort, `level`,
  `columns`, `layout`), `POST/DELETE library/books/export/layouts` (`report_layouts`, 0209, for any
  report by name; the maker or the library manager changes or removes one, else 409/403); the user's
  last choice is `user_preferences` `library.books.export.last`. Admin route `/api/library-export`
  (GET for every field, POST from the picker, same origin only).
- Tests: `library-report.e2e-spec.ts` (each filter, sort by author, counts of the matching copies,
  accession ranges and their order, the register's borrower; Excel per copy and per title with the About
  sheet; picked fields in order for the level; my last per user; layouts and their rights; audit);
  `a11y.spec.ts` (the register, more filters, the picker open; the candidates' picker still).

## Part 4 — books from Excel, our layout or the legacy one (migration 0210)

- **Library → Import books** (`/library/import`, library.catalogue.manage): upload an .xlsx or .csv
  (up to 15 MB, 50,000 rows), our template (`/api/library-import/template`: the columns, drop-downs for
  library, reference, purchase or donation and status, a "How to fill" sheet) or the legacy library's
  book file as it is. The file goes to the API as its bytes (`POST library/imports?fileName=`), not as
  JSON, so a large file fits.
- **Columns** are read by their names (no case, spaces, signs or a bracketed note): ours and the legacy
  import template's and book export's (BookCode or Book Id, BookName, Author, Author 2, Editors,
  Booktype, Category, Subject, Subject Subcategory, Publisher, Publisher Place, Publication Year, Call
  No, Keyword, Vendor/Source, Source Name, Procurement Type, DonatedBook, IsBorrowable, Location,
  ShelfRack, ShelfRow, Language/Langugage, ISBNNo, Date of Accession, BillDate, BillNo,
  PurchaseOrderNo, EditionNo, Volume, Pages, Price, Barcode, Remarks, Status and Status1). S.No, Class
  No, Book No, Source Code, Copy/Set and the verification columns are not read; other unknown columns
  are listed.
- **Each row is one copy.** Checked: an accession number (capitals, no spaces; once in the file); a
  title; the library by code or name (none: the only library, or the Main one); the material type
  (legacy BOOK and Text/TEXTBOOK, or a code or name; none: Book); a barcode once. Left out with a
  warning: an ISBN with a wrong check digit, a year, pages or price that are not numbers ("Rs.199",
  "₹ 1,250" read as numbers), a date that is not a day or is in the future, an unknown class. Legacy:
  Donated Yes or Procurement "Donation" is a donation (Source Name the donor), a vendor or bill a
  purchase, IsBorrowable No or Category Reference is reference only, other categories become keywords,
  Location goes to the copy's remarks, ShelfRack and ShelfRow are the shelf and rack, Discard is
  withdrawn, LAP lost, Sold withdrawn ("Sold (the old library)"), a copy Issued comes in on the shelf
  with a warning.
- **What a row does:** an accession number already in the library updates that copy and its title,
  only the cells given (or no change); else a new copy of the title found by ISBN, or by title, first
  author, edition and volume, already there or made by an earlier row of the file (a row without the
  ISBN joins the title an earlier row of it gave one); else a new title. Refused rows stay out.
- **The preview** (`/library/import/:id`): new titles, new copies, updates, no change, refused, with
  warnings; the names it adds to Library setup (authors, publishers, subjects, languages, vendors,
  shelves); the columns not read; the rows by what they do, with the reasons, the changes and the
  warnings. **Import** runs batch after batch (300 rows a call, with a progress bar; stopped, it
  carries on), each row on its own: one that fails keeps its reason and the rest go on. New names join
  the masters (a vendor by its name or code, a new one with a code made from its name; a shelf of the
  library with its racks; a sub-subject added to its subject). When all is done the accession series
  move past the highest number that came in with their prefix. **Discard** leaves a checked upload out.
  **Download the rows not imported** gives them with the reason, to correct and upload again.
- Every copy that comes in has its history (accessioned, "Imported from <file>"; an update "Updated
  from <file>: the changes"); the check and the import are audited.
- Tests: `library-import.e2e-spec.ts` (a legacy file: grouping, a copy of a title already there, an
  update with only the cells given, no change, refusals and warnings; the import, the masters filled,
  the series moved and the next copy continuing it, the rows not imported as a file; our template
  round trip with a status and a date cell; a discarded upload; a file without the two needed columns;
  650 rows in three batches with a title made in the first taking copies in the next); `a11y.spec.ts`.

## Part 5 — barcode and spine labels

- **Library → Labels** (`/library/labels`, library.catalogue.manage; also "Print labels" on a book's
  copies and "Print their labels" after adding copies): which copies (accession numbers from–to of one
  prefix, a list typed or scanned and printed in its order with the numbers not found named, the copies
  added between two days, or a title's copies; a library; withdrawn copies only when asked), which
  labels (a barcode label, a spine label, or both one after the other; the line above: the library's
  name, the school's or nothing; the title when the label has room; one to three of each), the sheet (A4
  3 × 8, A4 4 × 10, Avery L7651 5 × 13, A4 2 × 7, or one's own measurements, checked to fit A4) and the
  label to start at on a used sheet (a grid of the sheet to click). **Count the labels** first (copies,
  labels, sheets, first and last number), then **Open the PDF** (inline, in a new tab) or **Download**.
  Each user's last settings come back.
- **The barcode** is Code 128 of the accession number (bwip-js chooses the shortest code sets; a run of
  digits goes two to a symbol), drawn as bars in the PDF with quiet zones; the issue desk reads the
  accession number. The **spine label** gives the call number in lines (class, author mark…) and the
  accession number under it. The PDF fonts carry Latin letters: a title in another script is left off.
- **API:** `GET library/labels/setup` (the sheets, the libraries, my last settings), `POST
  library/labels` (the choice; `dry` for the count; else the PDF in base64), at most 3,000 copies at a
  time. Admin route `/api/library-labels` (POST from the form, same origin only; `save=1` downloads).
- Tests: `library-labels.e2e-spec.ts` (the bars as bwip-js encodes them; counts for a range, both
  labels, withdrawn copies, a used sheet, two of each; a list with a number not found, copies added
  between days, a title's copies; the PDF's A4 pages; the settings kept; sheets that do not fit A4, a
  start beyond the sheet, nothing to print and the right to print refused); `a11y.spec.ts`.

## Part 6 — periodical subscriptions (migration 0211)

- **A subscription** (`library_subscriptions`): a periodical of Library setup taken in a library from a
  day to a day (at most five years), its frequency (the periodical's unless another is chosen) and first
  issue (the first day unless another), the copies of each issue, the vendor (the periodical's unless
  another), the cost, the order no., the bill no. and date, the grace days before an issue is late, notes.
  Current, not started, ending (30 days left), ended or cancelled.
- **Its issues** (`library_periodical_issues`, `app.library_issue_dates`): expected from the first issue at
  the frequency to the end, each step counted from the first so a monthly issue keeps its day (31 January,
  28 February, 31 March …); named by the day (daily, weekly, fortnightly), the month (monthly to
  half-yearly) or the year. An issue is received (the day, not a day to come; the copies, the subscribed
  number unless another; volume, number, remarks), marked missing (what happened), or put back to expected
  (undo). Late: still expected after its grace days. A special issue can be added on a day of the period.
- **Changes:** a subscription changed (dates, frequency, first issue …) rebuilds its expected issues and
  keeps the received and missing ones (a new day that falls on one of them is not doubled); new dates that
  leave a received or missing issue outside are refused. **Renew** makes the next period from the day
  after the end, as long (whole months kept as months), with the same frequency, copies, vendor, cost and
  grace, its first issue as far from its start as before; once. **Cancel** from a day within the period,
  with the reason: the issues expected after it go; a cancelled subscription is not changed.
- **Library → Periodicals** (`/library/periodicals`, library.catalogue.view; changes need
  library.catalogue.manage): the figures (to receive, late, current subscriptions, ending in 30 days,
  cost of the current); **To receive** (the morning's check-in: the issues expected by today or the next
  seven days, late first with how late, by library; tick and "Received today", or Received / Missing on a
  row); **Subscriptions** (current, ending, not started, ended, cancelled or all; by library and name;
  received of those due so far, late and missing, the next issue, copies, cost). **Subscribe** and the
  subscription's page (its facts and counts, Edit, Renew, + Special issue, Cancel; every issue with its
  status and Received / Missing / Undo). **Issues to claim (Excel)**: the late and missing issues by vendor
  with the periodical, ISSN, library, issue, day, order no. and remarks.
- **API:** `GET library/subscriptions/setup`, `GET library/subscriptions` (status, library, q; with the
  figures), `GET library/subscriptions/:id`, `POST library/subscriptions`, `PUT library/subscriptions/:id`,
  `POST …/:id/renew`, `POST …/:id/cancel`, `POST …/:id/issues` (special), `GET library/issues/due`
  (`ahead` days), `POST library/issues/receive` (many), `POST library/issues/:id/receive|missing|undo`,
  `GET library/subscriptions/claims` (`vendorId`; base64 .xlsx; admin route `/api/library-claims`).
- Tests: `library-periodicals.e2e-spec.ts` (twelve monthly issues and the periodical's vendor; received,
  many at once, missing, undone, a day to come refused; the issues to receive and the figures; the claims
  file; a longer period and then quarterly keeping the issues received; dates leaving one out refused; a
  special issue, twice or outside refused; renewal once; cancellation; a daily newspaper; a periodical
  without a frequency; the first issue outside, five years, the wrong order of days; the rights);
  `a11y.spec.ts`.

## The library, rebuilt (parts 1–6)

Set-up masters of the school with borrowing rules the issue desk follows; the book master as titles and
copies with accession series; the book list with its filters, the accession register, a custom report and
Excel; Excel import in our layout or the legacy one; barcode and spine labels; periodical subscriptions.
Left for later (not asked in this round): the circulation desk's own screen redesign (it already follows
the rules), due-date reminders by email and SMS, reservations, the library dashboard, per-library staff
rights (the legacy's per-library permissions), and labels with titles in Indian scripts (a Unicode font).

## The Librarian role (migration 0212)

A system role `librarian` (kind module) for the library staff: library set-up, books and copies, import,
labels, periodicals, circulation and fines, stock checks (`library.catalogue.view`/`manage`,
`library.loan.circulate`, `library.stock.verify`), with finding a person and viewing students and staff
(to pick a borrower), file upload and view, and the privacy and hypercare reports every staff role has.
Nothing in fees, recruitment, exams or administration. On a development machine, sign in as
`dev-librarian · Librarian` (Lata Librarian, Alpha) to test the module.

## Set-up review (migration 0213, 21 Oct 2026)

The librarian could not correct a name on the set-up tabs: the field that tells rows apart (an author's,
subject's, language's, publisher's or periodical's name; a series' library and material type; a shelf's
library and code) was locked on edit. Books point at these rows by id, so a name is now put right in
place; the names a title keeps for its list and search (author, publisher, language, subject) follow
through a trigger. Decisions (asked): rename and merge; keys change until first use; staff rules by
employee type; periodical kinds as a tab.

- **Merge a duplicate** (authors, subjects, languages, publishers, periodicals): on the edit panel, pick
  the duplicate; `app.library_merge` moves every row that points at it (any foreign key), keeps one line
  when a title named both authors, joins a subject's sub-subjects, refreshes the titles' names and removes
  the duplicate (audited as `masters.row.merge`). `POST /masters/:master/rows/:id/merge {from}`.
- **Until first use**: an accession series keeps its library and material type once a copy of that library
  and type exists; a shelf keeps its library once copies sit on it (its code can always change). The grid
  shows the counts (Copies numbered, Copies) and the edit form locks the field with the reason; triggers
  refuse it too. Authors, subjects, languages and publishers show a Books count; periodicals,
  Subscriptions.
- **Periodical kinds**: a tab of the school's own list (Magazine, Newspaper, Journal, Bulletin to start);
  `library_periodicals.kind` became `kind_id`. Frequency stays a fixed list: it sets the issues expected.
- **Staff borrowing rules** may name an employee type (Staff setup › Employee types, matched by the type
  on the employee record) or a staff group, not both; the employee type wins over the group, then all staff.
- **Where a list comes from**: under every drop-down that points at another tab, "List from <setup> ›
  <tab>" with a Manage list link (a new tab) when the user may open it; fixed lists say so.
- The edit form opens its row by id (`GET /masters/:master/rows?id=`), not from the first 500 rows.

## The register, accession corrections and lost-book recovery (21 Oct 2026)

Asked: the copies register with the Employees list's tools; a way to correct a wrong accession number; a
way to recover a lost or damaged book from the student or employee. Decisions (asked): both tabs get the
list; a corrected accession number retires the old one (never given out again, still found by search), a
wrongly entered range is corrected in one go with a preview; a lost book charges the copy's price (else
the title's) + a processing fee (Library settings) + the late fine to that day, the librarian may change
it with a reason, a damaged book is charged what the librarian enters (a share of the price suggested);
the charge is announced at once as a misc fee (no approval step) for students and for staff (misc fees
extended to employees) and the librarian sees it due or paid; a lost book found before the charge is paid:
the price and fee come off through a misc fee change request the fees office approves (the late fine
stays). Not chosen: replacing the book with a copy, a waiver at the library desk.

- **Part 1 — the list (done).** The Books page's Titles and Copies tabs are the shared list of the
  Students and Employees pages (`PeopleList`, now with a first column of its own, a direct download and
  the view passed to its tools): status, quick filters (library, material, subject / language), search,
  More filters on any field with conditions, Columns (choose, order, rename; kept per user under
  `library.copies.list` / `library.titles.list`), Reset view, the school's counts, sortable headers,
  pages, Export Excel / PDF of exactly the view (made at once, no workers). The field catalogue is SQL
  (`library-register.ts`): every filter, the sort (accession numbers in their natural order) and the
  pages run in the database. `GET library/register/:copies|titles/fields`, `POST library/register/:level`,
  `POST library/register/:level/export`. Customise export (named layouts) takes the list's filters at
  the same level (`view` on `POST library/books/export`).
- **Part 2 — correcting an accession number (done, migration 0214).** Library → Correct accession nos.
  (`/library/accession`, also from a copy's "Correct no." and the register's row menu): the number now
  (or the first and last of a range) and the correct number (the first; the rest follow in order, padded
  like it), a preview of each copy's old and new number with what stands in the way (another copy has
  it, a copy had it before, it is the old number of another copy in the same correction, two copies would
  get it), then applied with a reason, all or nothing (`POST library/accession/preview|apply`). Each change
  is kept (`library_accession_changes`), in the copy's history ("Accession number corrected") and in the
  audit log. The old number is retired: a trigger refuses it to any other copy, the series skip it, a
  typed or imported number is refused; a copy may go back to a number it had. `app.library_copy_by_number`
  finds a copy by its old number at the desk (issue, renew, return) and in a stock check; the search of
  the lists finds it, the copies list has a Former accession nos. column and the book page says
  "formerly …". After applying, the new labels are a click away.
- **Part 3 — lost and damaged books, students (done, migration 0215).** Library → Lost and damaged
  (`/library/charges`): the accession number of a book on loan (an old number too) and the day; the charge
  worked out (`GET library/charges/preview`): lost = the copy's price (else the title's) + the processing
  fee (setting `library.lost_processing_fee`, ₹50) + the late fine to that day by the borrower's rule;
  damaged = a share of the price suggested (setting `library.damage_share_pct`, 25%), what is damaged
  said, the late fine staying a library fine (it may be waived). A lost book's changed amount needs its
  reason. Applied (`POST library/charges`): the loan closes, the copy is lost or damaged, and a misc fee is
  announced at once on the pupil under the head LIBBOOK "Library: lost or damaged book" (no approval, as
  hostel damages and bounce charges): the parent sees it, the fees counter collects it with a misc
  receipt. `library_charges` keeps the library's record (breakdown, misc fee and line); the list shows due,
  paid or cancelled from the misc line. `app.library_charges_due` stops new issues
  (`library.charge_due`) and counts in the leaving check (which now also counts a fine collected at the
  library as paid: it looked at the receipt only). A lost copy found again (its status on the book page)
  while unpaid: `MiscFeesService.requestChangeIn` asks the fees office to bring the line down to the late
  fine (or close the fee when there is none), the copy's history says so. A pupil's book marked lost at
  Circulation or on the book page is refused with a pointer here; staff keep the old ways until part 4.
  The Fines page lists the charges due; Circulation's conditions read Good / Damaged (no charge) / Lost
  (staff).
- **Part 4 — staff (done, migration 0216).** A misc fee line names a pupil or an employee (exactly one;
  `misc_fee_students.employee_id`). Fees → Misc fees → Counter collection finds a staff member by name,
  code or mobile (`GET fees/misc-fees/staff`, `GET fees/misc-fees/employee/:id`) and takes the fee on a
  misc receipt paid by the employee (`POST fees/misc-fees/collect {employeeId}`); the receipt prints with
  the employee code and designation in the pupil's place (all four receipt layouts); a fee's lines and the
  requests name staff too; online payment stays for families. The library charges a staff borrower exactly
  as a pupil, and a book on loan is now marked lost only at Lost and damaged books, for every borrower
  (Circulation's Lost and the copy's lost-on-loan status are refused with a pointer there).

## The circulation desk (21 Oct 2026)

Asked: rebuild Library → Circulation on the functions of the legacy desk (Issue Book, Return Book, Return
by Adm/Emp, Return by Class), in the Mobilise design. Decisions (asked): the desk has Issue · Return ·
Return by borrower · Return by class, with Lost and damaged, Fines and Stock verification and sales linked
from the tab row; a late fine shows on return and is collected (receipt reference), waived (note) or left
for the Fines page; the due date is the rule's, changeable for the whole batch; no messages to families
now (due reminders stay on the list for later).

- **Issue**: the borrower by admission no. or employee code (any case) or by name (pupils and staff to
  pick from); the card shows the class and roll no. or designation, the rule, the books held against the
  limit, unpaid fines and lost-book charges, and what blocks an issue. Books are scanned or typed one
  after another and checked as each is added (`GET library/desk/book?for=issue`: on the shelf, not
  reference only, an old number found too); Issue all issues them together, all or none, the failing book
  named (`POST library/desk/issue`, `LibraryService.issueIn` per book in one transaction).
- **Return**: a scanned book shows its borrower, class, dates, days late and the fine to today
  (`for=return`); returned good or damaged (no charge), the fine waived or settled after, renewed instead,
  or sent to Lost and damaged; "Return as soon as scanned" returns a book with nothing to settle on the
  scan. **Return by borrower** lists a borrower's books (return, renew, return all); **Return by class**
  lists the books a class or section holds (`GET library/desk/class-loans`, filter, ticks, return ticked
  or all shown; `POST library/desk/return`).

## Library reports (22 Oct 2026)

Asked: on Fines, the waivers and the late fines collected, a date filter, Excel and PDF; on Lost and
damaged books (Paid), a date filter, Excel and PDF; Stock verification rebuilt (cycles, an Excel upload,
verified and pending copies shown on the copies register); selling books (one or from Excel) with the sale
amount as a misc fee and a report; circulation history between two days; each pupil's and staff member's
borrowing history; each with Excel and PDF. Decisions (asked): a late fine goes to the fees counter as a
misc fee when the book comes back (the library takes no fine money); a stock cycle covers the libraries,
shelves and material types chosen; a book sold to someone outside the school is paid on a misc receipt
(payer "other"); fines and charges first, then circulation history, stock, sales.

- **Part 1 — fines at the fees counter; fines and charges history (done, migration 0217).** A book
  returned late announces its fine at once as a misc fee on the borrower, pupil or staff, under the head
  LIBFINE "Library: late fine" (`library_charges` kind `late`, one per loan; "Late fine: title (book no.)",
  the days late in its remark), so the parent sees it and the fees counter collects it on a misc receipt;
  a damaged book returned late gets its damage charge and its late fine as two fees. A fine waived at the
  desk needs its reason and is kept with who and when (`library_fine_waivers`; the waivers made before
  were copied from the loans). Collecting at the library is refused (`library.fines_at_counter`); a fine
  already at the counter is waived through the fees office (`POST library/charges/:id/waive-request`: a
  misc fee change request for part, the fee closed for all). Old fines left at the library before 0217
  still stop issues (`app.library_fines_unsent`, `library.fine_pending`) until sent to the counter
  (`POST library/fines/send`, one or all) or waived with a reason; a fine at the counter stops issues as a
  lost book does (`library.charge_due`), and both count in the leaving check. **Late fines**
  (`/library/fines`): three figures that are also the tabs, Outstanding (due at the counter, a waiver the
  fees office is deciding, old fines not sent), Collected (the counter's receipts: day, amount, receipt
  no., mode, who; old fines collected at the library) and Waived (at the desk with the reason and who, or
  by the fees office); between two days (the day returned, paid or waived), pupils or staff, a class or
  section, a search; totals; the tab as Excel or PDF (`GET library/fines/report|export`). **Lost and
  damaged books**: late fines left the list (they are on Late fines); a date filter (the day charged; on
  Paid, the day paid, with the receipt nos.), pupils or staff, a search, totals, Excel or PDF
  (`GET library/charges/export`). The files are made at once by `libraryFile` (Excel with an "About this
  report" sheet; PDF A4 landscape, Rs. for ₹) through `/api/library-report`. The desk says the fine went
  to the counter instead of collecting it.
- **Part 2 — circulation and borrowers' history (done, migration 0218).** Each renewal is now kept
  (`library_loan_renewals`: the day, the due date before and after, who; the renewals made before were
  copied from the audit log, without their due dates). **Circulation history** (`/library/history`, in
  the Library menu and on the desk's links), three tabs. *Circulation*: four figures (issued, returned,
  renewed between the days; out now with how many are overdue) that also pick the list; every issue,
  return and renewal between two days (this month until days are chosen; both empty: every day), or
  the books out or overdue now (not by day); by pupils or staff, class or section, library (when there
  are several) and a search over book, book no., author, borrower and admission or employee no.
  (`GET library/history/circulation`). *Pupils* and *Staff*: each borrower with the books borrowed,
  returned and returned late between the days, held and overdue now, the late fines and the last issue
  (`GET library/history/borrowers?kind=`): those active between the days or holding now, holding now,
  overdue now, or everyone who ever borrowed; pupils by class and section; in class order and roll no.,
  most held or most borrowed; totals. A borrower's own page (`/library/history/student|employee/:id`,
  also from the desk's borrower card): the desk card (rule, books held, dues), four figures, and every
  book held between two days (or every loan) with the dates, renewals, days late, how the loan ended
  (returned, returned damaged, lost, out, overdue, with any charge) and the fine and where it is now
  (`GET library/history/borrowers/:kind/:id`). Each list as Excel or PDF (`…/export`, through
  `/api/library-report`).
- **Part 3 — stock verification in cycles (done, migration 0219).** **Stock verification**
  (`/library/stock`): the cycles, open first with how far each has come, and a new cycle over the
  libraries, shelves and material types ticked (none ticked in a group: all of it). A cycle takes the
  copies on the shelves, damaged or on loan in its scope; a copy can be in one open cycle at a time
  (`library.stock_overlap`), several cycles may run side by side (`POST library/stock/cycles`). A cycle's
  page (`/library/stock/:id`): four figures (verified; pending, or missing once closed; on loan; numbers
  not in the cycle) and the share accounted for; while open, a scan box (a number and Enter verifies it at
  once and says what it was: verified, verified already, from another shelf or library, no such book,
  scanned twice, on the shelf though issued; several may be pasted; `POST …/verify`) and a file of book
  numbers (.xlsx with a column headed Accession no., Book no. or Barcode and an optional Remarks; or a
  scanner's .csv / .txt, one number a line; checked first, kept in `library_stock_uploads`, then applied
  or discarded; the layout from `GET library/stock/template`). A number is found by its accession number
  in any case, an old number or, now, the barcode (`app.library_copy_by_number`). Each verified copy keeps
  the day, who and how (scan, file, by hand) and the remark, and its last check date; numbers outside the
  cycle are kept (`library_stock_check_extras`). The lists by state (pending, verified, on loan, missing,
  lost/withdrawn/sold since, not in the cycle, every copy) by library, shelf, material type and search,
  with Excel or PDF; a pending copy verified by hand, a verified one taken back. Close: pending copies
  become missing (marked lost with the reason and the copy's history, if ticked), those issued then are
  counted on loan; a cycle started by mistake is cancelled with its reason. A book on loan is counted at
  the close, not at the start (an open cycle's earlier on-loan rows were reset). **The copies register**
  has a Stock verification section (the copy's latest cycle, not cancelled: Stock check — Verified,
  Pending, On loan, Missing, Lost/withdrawn/sold since, Not in a cycle; cycle; verified on and by;
  remarks), Stock check is a default column, and the Status box takes Stock check: verified, pending or
  missing; the cycle's lists open it (`/library?view=copies&status=stock_pending`). The old single stock
  check routes (`library/stock-checks`) are replaced; book sales moved to their own page
  (`/library/sales`) until part 4 rebuilds them.
- **Part 4 — books sold (done, migration 0220).** A sale is one buyer and one or more books, numbered
  LS-0001 on (`library_sale_orders`; each book in `library_sales` with its price, its price as bought and
  the status it was sold from; the sales made before became one sale each, LS-OLD-<id>). Only copies on
  the shelf, damaged or withdrawn are sold (`library.cannot_sell` names the book: on loan, sold already,
  lost); the copy becomes sold with the reason and its history. A pupil or a staff member owes the total
  as a misc fee announced at once under the head LIBSALE "Library: book sale" (one book: "Book bought:
  title (book no.)", several: "Books bought: N books (LS-…)"), paid at the fees counter; someone outside
  pays at the library on a numbered misc receipt (payer "other", head LIBSALE, the mode and reference;
  `FeeAdjustmentsService.postMiscReceiptIn` in the sale's transaction), printed from the sale's page
  (`GET library/sales/orders/:id/receipt`; the receipt layouts now print a payer outside the school by
  name and mobile); a book given for nothing has neither. **Book sales** (`/library/sales`): four figures
  (books sold, sold for, paid, due), the books sold between two days (this month until days are chosen)
  by buyer, payment (due at the fees counter, paid, no price, cancelled) and a search; totals; Excel or PDF
  (`GET library/sales`, `…/export`). **Sell books** (`/library/sales/new`): the buyer (a pupil or staff
  member found as at the desk, or someone outside by name and mobile), the books scanned with the price of
  each (the price as bought shown), the mode and reference for someone outside, the day and a note
  (`GET library/sales/book`, `POST library/sales`). **Upload sales** (`/library/sales/upload`): an .xlsx
  or .csv (Accession no., Buyer: Pupil/Staff/Outside, Admission or employee no., Buyer name, Mobile, Price,
  Pay mode, Reference, Remarks; the layout from `GET library/sales/template`) checked row by row and kept
  (`library_sale_uploads`); the good rows are sold together, one sale a buyer (someone outside: the same
  name, mobile, mode and reference), the rows with a problem listed and left out. Not built: taking a
  sale back (a misc fee is cancelled, a receipt reversed, by the fees office).

## Library round 3 (22 Oct 2026)

Asked: how "Ask to waive" works; Import to update existing books by accession number like the employee
bulk page; the pupil/parent portal and the staff app to show the books held, the history, a home tile and
a book's status; staff tied to particular libraries working only there; the Pupils/Staff history Excel to
carry each person's books. Decisions (asked): the library staff are set on each library (Library setup),
a tied user works only in those libraries, an untied one (the admin) in all; a book of another library may
be returned at any desk (noted), everything else is limited; the Excel update may change copy and title
fields (a title change reaches every copy of the title, warned), never the status or the accession no.;
the portals get my books and history, a home tile, the catalogue with each book's status (borrowers never
named) and reservations (pupils and staff, 2 at a time by a setting, only when every copy is issued, the
returned book kept for the first in line for a setting of 3 days, told in the portal only). Parts: 1
waiver requests + the per-person sheet, 2 update from Excel, 3 library staff, 4 portals and reservations.

- **Part 1 — waiver requests; each person's books in the history Excel (done).** "Ask to waive" (Late
  fines → Outstanding, a fine at the fees counter) makes a misc fee change request: it follows Fee setup →
  Approval levels (or waits under Fees → Misc fees → Requests), the fine stays due meanwhile, and once
  approved the misc fee comes down (all of it: the fee closes) and the fine moves to Waived as "Waived by
  the fees office". Late fines now has a fourth figure, **Waiver requests** (waiting), opening their list:
  all, waiting, approved, rejected; asked on and by, the borrower, the book, the fine and what is to be
  waived, the reason, who it waits with or who decided and the note; the same filters; Excel or PDF
  (`GET library/fines/requests`, `…/export`). The Pupils and Staff history Excel has a second sheet,
  **Books by pupil** / **Books by staff member**: a heading row a person (name, number, class or
  designation, how many books) and their books held between the days (issued, due, renewed, returned,
  days late, how it ended, the fine and where it is); `libraryFile` takes more sheets with heading rows.
- **Part 2 — update existing books from Excel (done).** Library → Import books has two tabs, **Add new
  books** (as before) and **Update existing books** (`?mode=update`), the employees' bulk upload's way:
  1. the template (`GET library/books/update/template`, through `/api/library-import/update-template`) is
  filled with the copies of the library, shelf and material type chosen (up to 5,000), one row per
  accession no., in the columns ticked by section (the book, publication, the copy, how it came; none
  ticked: all), list columns with drop-downs of Library setup's names; 2. the filled .xlsx or .csv is
  checked (`POST library/books/update`, kept in `master_imports` as `library_books_update`): Accession No.
  finds the copy (an old number too), a blank cell is no change, CLEAR empties a field (not Title,
  Material type, Library, Reference only, Date of accession), names are matched to Library setup, dates
  as DD-MM-YYYY, Authors as names separated by ; (editors and the rest kept); each row is tried with the
  book form's own rules and undone (a savepoint), so a shelf of another library, a vendor without a
  purchase, a taken barcode are caught; the same copy twice, a sold copy, one title given two values are
  refused; a copy moved to another library leaves its shelf unless the file gives one; old → new by row,
  and a note when a book field reaches copies not in the file; 3. applied all together (`POST
  library/books/update/:id/apply`): each title once over what it has now, then each copy (its history
  says moved or edited), all or nothing; the update files so far. Status and the accession no. keep
  their own screens.
- **Part 3 — library staff (done, migration 0221).** **Library staff** (`/library/staff`, a tab of
  Library setup and in the Library menu): each library with its staff (employees), added from a list
  and taken off (`GET/POST library/staff`, `POST library/staff/remove`); only someone who works in every
  library names them (`library.staff_limited`). A signed-in user whose employee record is named on one or
  more libraries works only in those, kept by the database: `app.my_libraries()` (the user's libraries,
  worked out once a transaction; none: all) and restrictive row rules on libraries, shelves, accession
  series, copies and subscriptions, so everything reached through a copy follows (the register and the
  book page, adding and editing copies, Import, labels, accession corrections, the desk, fines and
  charges, stock checks, sales, the history and reports). A book of another library: the desk says "It
  belongs to … : issue it there" (sales: "sell it there"), a stock scan names its library, and it is taken
  back at any desk (`withEveryLibrary` turns the rule off for the return's transaction; the borrower's
  card and a class's books show every library's) with "Taken back at …, not at …: to be sent back there"
  in its history. A cycle over every library made by a limited user covers their libraries; cycles of
  other libraries are not listed. The library defaults are seeded only by someone who works in every
  library. Pages a limited user opens say which libraries they work in (`GET library/staff/me`).
- **Part 4 — the library in the portals; reservations (done, migration 0222).** The family portal's
  **Library** (`/library`) and the staff app's **My library books** (`/library`, under Office): **Books
  now** (each book with the due day, late days and the fine to today; a book kept for them on top; what
  is due at the fees counter and old fines at the library), **Read before** (returned, late days, fine),
  **Reservations** (place in line, kept until a day, collected, not collected in time, cancelled with the
  library's reason; cancel an open one), **Find a book** (the catalogue by title, author, subject, ISBN or
  publisher: on the shelf and in which libraries, all copies out and the next due back, read in the
  library only, how many wait; never who has it) with **Reserve** when every copy is out; the family
  portal's digital library stays. The family home has a **Library books** tile (held, overdue or ready to
  collect, next due) and the staff home a figure when they hold or have a book kept. API (any signed-in
  person, their own borrowers only: a parent's children, a pupil, a staff member): `GET
  library/portal/summary`, `GET library/portal/borrowers/:kind/:id`, `GET library/portal/catalogue`,
  `POST library/portal/reservations`, `POST library/portal/reservations/:id/cancel`. **Reservations**
  (`library_reservations`: waiting → ready → collected, or cancelled or lapsed): a title, not a copy; only
  when no copy is on the shelf (`library.on_shelf`), never a reference book, not one held already, one open
  per title a borrower, `library.reservations_per_borrower` (2) at a time. A copy taken back is kept for
  the first in line for `library.hold_days` (3) days: the desk says "Keep … aside: … reserved it, until
  …" (return, a borrower's returns, a class's returns); the desk will not issue it to anyone else
  (`library.copy_held`, and the desk's book check says so), issuing the title to them collects the
  reservation (and frees another copy kept for them); a renewal is refused while anyone waits
  (`library.reserved`). A hold past its day lapses when anyone looks (the portals, the list, the desk)
  and the copy goes to the next in line or back to the shelf; this works across libraries
  (`withEveryLibrary`, now safe inside itself). **Reservations** at the library (`/library/reservations`,
  Library menu and the desk's links; `GET library/reservations`, `POST library/reservations/:id/cancel`
  with a reason): open, kept for collection (the copy and the day), waiting (place in line), ended in
  the last 60 days; by title or borrower. A librarian tied to some libraries sees the reservations of
  titles with copies there, not copies kept at another library, and cancels only those. Told in the
  portal only: no SMS or e-mail.
