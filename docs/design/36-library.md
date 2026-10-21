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
