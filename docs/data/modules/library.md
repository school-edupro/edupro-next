# Library — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

A school sets up libraries, shelves, material types, accession series, name masters and borrowing rules. A book
is catalogued once as a **title**; each physical **copy** has an accession number, a place, how it came and a status.
The desk lends copies to pupils and staff as **loans** (issue, renew, return). Late, lost and damaged books make
charges that, since Oct 2026, are misc fees paid at the fees counter. Titles can be reserved; stock is verified in
cycles; books are sold; periodicals come on subscription with each issue received or missing; books arrive by
Excel import; a digital library lists links and files.

## Tables

| Table                        | One row is                                       | Key columns                                                                                                                                                                                                            | For reports                           |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `library_titles`             | a book (or other item) as catalogued once        | `code` (unique per school, T-numbers), `title`, `isbn`, `material_type_id`, `subject_id`, `publisher_id`, `language_id`, `class_id`, `price`, `is_reference`, `status` row_status                                      | **main (catalogue spine)**            |
| `library_copies`             | one physical copy                                | `title_id`, `accession_no` (unique per school), `library_id`, `shelf_id`, `rack`, `barcode`, `status` library_copy_status, `price`, `acquisition` Purchase/Donation, `vendor_id`, `accessioned_on`, `last_verified_on` | **main (stock spine)**                |
| `library_loans`              | one issue of one copy to one borrower            | `copy_id`, `borrower_kind` student/employee, `borrower_id`, `issued_on`, `due_on`, `returned_on` (NULL = out), `renewed`, `fine_amount`, `fine_waived`                                                                 | **main (circulation spine)**          |
| `library_loan_renewals`      | one renewal of a loan                            | `loan_id`, `renewed_on`, `from_due`, `to_due`                                                                                                                                                                          | history                               |
| `library_fine_waivers`       | a late fine waived at the desk                   | `loan_id`, `amount`, `reason`, `waived_on`                                                                                                                                                                             | history                               |
| `library_charges`            | a lost, damaged or late charge on a loan         | `loan_id` + `kind` (unique pair) lost/damaged/late, `copy_id`, `borrower_kind`, `borrower_id`, `on_date`, `price`, `processing_fee`, `late_fine`, `amount`, `misc_fee_id`, `misc_line_id`, `found_on`                  | main (money)                          |
| `library_reservations`       | a borrower waiting for a title                   | `title_id`, `borrower_kind`, `borrower_id`, `status`, `placed_at`, `copy_id` (held copy), `ready_until`, `loan_id`                                                                                                     | main                                  |
| `library_copy_events`        | something that happened to a copy                | `copy_id`, `what` (free text), `from_status`, `to_status`, `on_date`, `reason`, `amount`                                                                                                                               | history                               |
| `library_accession_changes`  | an accession number corrected                    | `copy_id`, `old_no`, `new_no`, `reason`, `changed_at`                                                                                                                                                                  | history                               |
| `library_title_authors`      | a person of a title, in order                    | `title_id`, `author_id`, `role` Author/Editor/Translator/Illustrator (unique set), `position`                                                                                                                          | detail                                |
| `library_libraries`          | a library of the school                          | `code` (unique per school), `name`, `campus_id`, `status`                                                                                                                                                              | master                                |
| `library_shelves`            | a shelf (almirah) of a library                   | `library_id`, `code` (unique per library), `racks` text[]                                                                                                                                                              | master                                |
| `library_material_types`     | what a copy is (book, textbook, CD…)             | `code`, `name`, `issuable`, `sort_order`                                                                                                                                                                               | master                                |
| `library_accession_series`   | the number series of a library and material type | `library_id`, `material_type_id` (unique per school), `prefix`, `digits`, `next_no`                                                                                                                                    | internal (sequence)                   |
| `library_authors`            | an author name                                   | `name` citext (unique per school)                                                                                                                                                                                      | master                                |
| `library_publishers`         | a publisher                                      | `name`, `place`                                                                                                                                                                                                        | master                                |
| `library_subjects`           | a subject (Fiction, Science…)                    | `name`, `class_no`, `sub_subjects` text[]                                                                                                                                                                              | master                                |
| `library_languages`          | a language                                       | `name`, `code`                                                                                                                                                                                                         | master                                |
| `library_vendors`            | a book seller / supplier                         | `code`, `name`, contact columns, `gstin`                                                                                                                                                                               | master                                |
| `library_borrow_rules`       | how many books, how long, what fine, for whom    | `applies_to` Student/Hostel student/Employee, `class_id`, `staff_group`, `employee_type_id`, `max_books`, `loan_days`, `renewals`, `fine_per_day`, `max_fine`, `grace_days`                                            | master                                |
| `library_staff`              | an employee named on a library                   | `library_id`, `employee_id` (unique pair)                                                                                                                                                                              | master (also limits what a user sees) |
| `library_periodicals`        | a magazine / newspaper master                    | `name` (unique per school), `frequency`, `kind_id`, `language_id`, `publisher_id`, `vendor_id`, `issn`                                                                                                                 | master                                |
| `library_periodical_kinds`   | a kind of periodical (newspaper, magazine…)      | `name`, `sort_order`                                                                                                                                                                                                   | master                                |
| `library_subscriptions`      | a periodical taken in a library for a period     | `periodical_id`, `library_id`, `vendor_id`, `frequency`, `starts_on`, `ends_on`, `first_issue_on`, `copies`, `cost`, `grace_days`, `status` active/cancelled, `renewed_from`                                           | main                                  |
| `library_periodical_issues`  | one expected issue of a subscription             | `subscription_id`, `expected_on`, `label` (unique set), `status` expected/received/missing, `received_on`, `copies_received`, `special`                                                                                | detail                                |
| `library_stock_checks`       | a stock verification cycle                       | `name`, `status` open/closed/cancelled, `started_on`, `finished_on`, scope arrays `library_ids` / `shelf_ids` / `material_type_ids`, cached `expected`, `found`, `missing`, `on_loan`, `gone`                          | main                                  |
| `library_stock_check_items`  | one copy in a cycle                              | `check_id`, `copy_id` (unique pair), `outcome` pending/found/missing/on_loan/gone, `found_on`, `method`                                                                                                                | detail                                |
| `library_stock_check_extras` | a number scanned that is not in the cycle        | `check_id`, `typed`, `copy_id` (NULL = unknown), `kind` outside/unknown, `method`                                                                                                                                      | detail                                |
| `library_stock_uploads`      | a file of book numbers for a cycle               | `check_id`, `file_name`, `rows` jsonb, `status` checked/applied/discarded                                                                                                                                              | internal (import)                     |
| `library_sale_orders`        | one sale (one buyer, one or more books)          | `sale_no` (unique per school, LS-0001…), `sold_on`, `buyer_kind` student/employee/other, `buyer_id`, `books`, `total`, `misc_fee_id`, `misc_line_id`, `misc_receipt_id`                                                | main                                  |
| `library_sales`              | one copy sold                                    | `order_id`, `copy_id`, `price`, `copy_price`, `from_status`, `sold_on`, `buyer_kind`, `buyer_id`                                                                                                                       | detail                                |
| `library_sale_uploads`       | a file of sales, checked before applying         | `file_name`, `rows` jsonb, `status` checked/applied/discarded                                                                                                                                                          | internal (import)                     |
| `library_imports`            | an Excel/CSV upload of books                     | `file_name`, `layout` edupro/legacy, `status` checked/importing/done/discarded, `total`, `summary` jsonb                                                                                                               | internal (import)                     |
| `library_import_rows`        | one line of an upload                            | `import_id`, `line`, `kind` new_title/new_copy/update/unchanged/error, `state` pending/done/failed/skipped, `data` jsonb, `errors`, `title_id`                                                                         | internal (import)                     |
| `library_digital_items`      | a link or file in the digital library            | `code` (unique per school), `title`, `kind` link/file, `url`, `file_id`, `audience` everyone/students/employees, `band`, `status`                                                                                      | master                                |

35 tables.

## How the tables join

**Spines:** `library_copies` (stock questions), `library_loans` (circulation), `library_titles` (catalogue).

Catalogue and stock:

- `library_copies.title_id → library_titles.id`
- `library_copies.library_id → library_libraries.id`; `library_copies.shelf_id → library_shelves.id`
- `library_copies.vendor_id → library_vendors.id`
- `library_titles.material_type_id → library_material_types.id`; `subject_id → library_subjects.id`;
  `publisher_id → library_publishers.id`; `language_id → library_languages.id`
- `library_titles.class_id → classes.id` (a textbook's class)
- `library_title_authors.title_id → library_titles.id`; `library_title_authors.author_id → library_authors.id`
- `library_shelves.library_id → library_libraries.id`; `library_libraries.campus_id → campuses.id`
- `library_accession_series.library_id → library_libraries.id`; `material_type_id → library_material_types.id`
- `library_copy_events.copy_id → library_copies.id`; `library_accession_changes.copy_id → library_copies.id`

Circulation:

- `library_loans.copy_id → library_copies.id`
- `library_loans.borrower_id → students.id` when `borrower_kind = 'student'`, `→ employees.id` when `'employee'`
  (no foreign key: always join on both columns)
- pupil's class: `students.id → enrolments.student_id` (year, `status = 'active'`) `→ class_sections → classes`
- `library_loan_renewals.loan_id → library_loans.id`; `library_fine_waivers.loan_id → library_loans.id`
- `library_reservations.title_id → library_titles.id`; `copy_id → library_copies.id`; `loan_id → library_loans.id`;
  borrower as on loans
- `library_loans.issued_by / returned_by`, `*.by_user`, `created_by` → `users.id` (no FK)

Money (out to the fees module):

- `library_charges.loan_id → library_loans.id`; `copy_id → library_copies.id`
- `library_charges.misc_fee_id → misc_fees.id`; `library_charges.misc_line_id → misc_fee_students.id` (what the
  borrower owes and has paid: `amount`, `paid`, `status` open/paid/cancelled)
- receipts: `misc_receipts.misc_fee_student_id = library_charges.misc_line_id` (`status = 'posted'`)
- a lost book found again: `library_charges.found_request_id → misc_fee_requests.id`
- fines before 0217: `library_loans.fine_receipt_id → misc_receipts.id`
- sales: `library_sales.order_id → library_sale_orders.id`; `library_sales.copy_id → library_copies.id`;
  `library_sale_orders.misc_fee_id → misc_fees.id`, `misc_line_id → misc_fee_students.id` (pupil / staff buyer),
  `misc_receipt_id → misc_receipts.id` (outside buyer paid at the library); `buyer_id → students.id / employees.id`
  by `buyer_kind`
- misc fee heads used: `LIBBOOK` (lost / damaged), `LIBFINE` (late fine), `LIBSALE` (sale) in `fee_heads.code`.

Periodicals:

- `library_subscriptions.periodical_id → library_periodicals.id`; `library_id → library_libraries.id`;
  `vendor_id → library_vendors.id`; `renewed_from → library_subscriptions.id`
- `library_periodical_issues.subscription_id → library_subscriptions.id`
- `library_periodicals.kind_id → library_periodical_kinds.id`; `language_id`, `publisher_id`, `vendor_id` as above

Stock checks:

- `library_stock_check_items.check_id → library_stock_checks.id`; `copy_id → library_copies.id`
- `library_stock_check_extras.check_id → library_stock_checks.id`; `copy_id → library_copies.id`
- `library_stock_uploads.check_id → library_stock_checks.id`

Rules, staff, imports, digital:

- `library_borrow_rules.class_id → classes.id`; `employee_type_id → employee_types.id`; the rule a borrower follows
  is `app.library_rule(kind, id)` (most specific active rule; hostel students try the hostel rule first).
- `library_staff.library_id → library_libraries.id`; `library_staff.employee_id → employees.id`
- `library_import_rows.import_id → library_imports.id`; `library_import_rows.title_id → library_titles.id`
- `library_digital_items.file_id → files.id`

## Life-cycles and statuses

**Copy** `status` (enum library_copy_status):

- `available` on the shelf; `issued` on loan; `lost` (reported lost, or marked lost when a stock check closed);
  `damaged`; `withdrawn` (discarded from stock); `sold`.
- **Holdings = status NOT IN ('withdrawn', 'sold')** (the API's rule). Lost and damaged copies still count as
  holdings until withdrawn.
- `status_on` / `status_reason` hold the last change; `library_copy_events` is the full history (`what` is free
  text: accessioned, edited, moved, renumbered, issued, sold, lost, a status name, "returned elsewhere"…).

**Loan:**

- Out: `returned_on IS NULL` (at most one open loan per copy). Overdue: out and `due_on < today`.
- Renewal moves `due_on` and adds 1 to `renewed`; each renewal is a `library_loan_renewals` row (renewals before
  0218 were taken from the audit log, with `from_due` / `to_due` unknown).
- Return sets `returned_on`, `returned_by` and the late fine `fine_amount`; a desk waiver sets `fine_waived`
  (and a `library_fine_waivers` row).
- **Lost:** the loan is closed on the day the loss is reported (`returned_on` set, `fine_amount = 0`); the copy
  goes to `lost`; a `library_charges` row of kind `lost` carries price + processing fee + late fine.
- **Damaged:** the loan is returned; a `damaged` charge is raised; the late fine stays a late fine.

**Fine (late) flow:**

- Late fine = (days late − grace days) × fine per day, capped at `max_fine`, from the borrower's rule (else the
  setting `library.fine_per_day`). Calendar days.
- Since 0217: what is left after a desk waiver is raised at once as a `library_charges` row of kind `late` and a
  misc fee line; it is due at the fees counter. A later reduction goes through `misc_fee_requests`.
- Before 0217: fines were kept on the loan only — owed when `fine_amount > fine_waived AND fine_paid_on IS NULL
AND fine_receipt_id IS NULL` and no `late` charge exists; collected when `fine_paid_on` is set.

**Charge** `kind`: lost, damaged, late (one of each per loan). Status lives on the misc fee line
(`misc_fee_students.status` open/paid/cancelled, `paid`). `found_on` set = a lost book came back; the price and fee
come off through the misc fee change request.

**Reservation** `status`: waiting (in line, by `placed_at`) → ready (a copy is held: `copy_id`, `ready_at`,
`ready_until`) → collected (issued to them; `loan_id`) or lapsed (not collected by `ready_until`) or cancelled.
`end_reason`, `ended_at` record the end. One open (waiting/ready) reservation per title and borrower.

**Stock check** `status`: open → closed (or cancelled). A closed cycle may be reopened within
`library.stock_reopen_days` (count in `reopened`, history in `reopen_log`). Item `outcome`: pending (not seen yet),
found, missing, on_loan (out when it closed), gone (lost / withdrawn / sold during the cycle — not missing). The
cycle's `expected` / `found` / `missing` / `on_loan` / `gone` are written at close; while open, count the items.
`missing_marked_lost` = the close turned missing copies to `lost`.

**Subscription** `status`: active, cancelled (`cancelled_on`, `cancel_reason`); a renewal is a new row with
`renewed_from`. **Issue** `status`: expected, received (`received_on`, `copies_received`), missing (to claim). Late =
still expected and `expected_on + grace_days < today`.

**Sale:** an order and its lines; a pupil or staff buyer owes a misc fee (head `LIBSALE`), an outside buyer pays at
the library on a misc receipt. Sales made before 0220 were wrapped one per order as `LS-OLD-<id>`.

**Imports and uploads** (`library_imports`, `library_sale_uploads`, `library_stock_uploads`): checked → applied/done
or discarded; import rows done/failed/skipped. Work tables, not business records.

**Masters** use `status` row_status (active/inactive); inactive rows keep history.

## Amounts, dates and counting rules

- **Prices:** `library_copies.price` is the copy's cost; `library_titles.price` the list price. The API values a
  copy at `COALESCE(copy.price, title.price)` for lost charges; the stock value on the overview sums the copy price
  only. Say which one you use.
- **Charges:** for `lost`, `amount` usually = `price + processing_fee + late_fine`, but the librarian may change
  it with a reason, so report `amount`, not the sum. For `damaged`, `amount` is what was entered. For `late`,
  `amount` = the fine after the desk waiver. `amount > 0` always.
- **What was paid** is on the misc fee line (`misc_fee_students.paid`) and the receipts (`misc_receipts.amount −
refunded`, `status = 'posted'`), not in library tables.
- **Loan fine columns:** `fine_amount` = fine worked out at return; `fine_waived` = waived at the desk. Owed =
  difference, but since 0217 the owed part is a `late` charge — do not add both.
- **Sales:** `library_sale_orders.total` = sum of its `library_sales.price`; `library_sales.copy_price` is the
  copy's book value when sold.
- **Subscriptions:** `cost` is for the whole period (not per issue or per copy).
- **Dates:** issues by `issued_on`; returns by `returned_on` (lost loans also have it — see Traps); renewals by
  `library_loan_renewals.renewed_on`; charges by `on_date`; waivers by `waived_on`; accessions by
  `accessioned_on`; sales by `sold_on`; periodical issues by `expected_on` / `received_on`. All are plain dates
  (school day). `placed_at`, `changed_at`, `at` are timestamptz — convert to India time.
- **Year:** the library is not tied to an academic year (masters are the school's). For "this session", filter
  dates by `academic_years.start_date` / `end_date`. Misc fees carry `academic_year_id`.
- **One row per:** copy per accession number; open loan per copy; charge per loan and kind; reservation per
  borrower and title while open; stock item per cycle and copy.
- **Titles vs copies:** "how many books" usually means copies (holdings); "how many titles" = distinct
  `title_id` of holding copies.

## Answering report questions

**1. Holdings of each library: titles, copies, on loan, lost, damaged, value.**

```sql
SELECT lb.code, lb.name AS library,
       count(DISTINCT x.title_id) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold')) AS titles,
       count(*) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold')) AS copies,
       count(*) FILTER (WHERE x.status = 'available') AS available,
       count(*) FILTER (WHERE x.status = 'issued')    AS on_loan,
       count(*) FILTER (WHERE x.status = 'lost')      AS lost,
       count(*) FILTER (WHERE x.status = 'damaged')   AS damaged,
       COALESCE(sum(COALESCE(x.price, t.price)) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold')), 0) AS stock_value
  FROM library_libraries lb
  JOIN library_copies x ON x.library_id = lb.id
  JOIN library_titles t ON t.id = x.title_id
 GROUP BY lb.id, lb.code, lb.name
 ORDER BY lb.name
```

**2. Which books are overdue now, with whom?**

```sql
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d)
SELECT l.borrower_kind, COALESCE(st.admission_no, em.employee_code) AS ref,
       COALESCE(st.display_name, em.display_name) AS borrower,
       x.accession_no, t.title, l.issued_on, l.due_on, today.d - l.due_on AS days_late
  FROM library_loans l
  CROSS JOIN today
  JOIN library_copies x ON x.id = l.copy_id
  JOIN library_titles t ON t.id = x.title_id
  LEFT JOIN students st ON l.borrower_kind = 'student' AND st.id = l.borrower_id
  LEFT JOIN employees em ON l.borrower_kind = 'employee' AND em.id = l.borrower_id
 WHERE l.returned_on IS NULL AND l.due_on < today.d
 ORDER BY days_late DESC
```

**3. Books out and overdue by class and section (crosses into academics).**

```sql
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
     yr AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT k.name AS class, cs.name AS section,
       count(*) AS books_out,
       count(*) FILTER (WHERE l.due_on < today.d) AS overdue,
       count(DISTINCT l.borrower_id) FILTER (WHERE l.due_on < today.d) AS pupils_overdue
  FROM library_loans l
  CROSS JOIN today
  JOIN enrolments e ON e.student_id = l.borrower_id AND e.academic_year_id = (SELECT id FROM yr) AND e.status = 'active'
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE l.borrower_kind = 'student' AND l.returned_on IS NULL
 GROUP BY k.name, k.display_order, cs.name
 ORDER BY k.display_order, cs.name
```

Note: the `borrower_kind = 'student'` filter is what makes the `borrower_id → enrolments` join correct.

**4. Issues, returns and renewals per month this session.**

```sql
WITH ev AS (
  SELECT date_trunc('month', l.issued_on)::date AS m, 'issued' AS what FROM library_loans l
  UNION ALL
  SELECT date_trunc('month', l.returned_on)::date, 'returned' FROM library_loans l
   WHERE l.returned_on IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM library_charges ch WHERE ch.loan_id = l.id AND ch.kind = 'lost')
  UNION ALL
  SELECT date_trunc('month', r.renewed_on)::date, 'renewed' FROM library_loan_renewals r)
SELECT m, count(*) FILTER (WHERE what = 'issued') AS issued,
       count(*) FILTER (WHERE what = 'returned') AS returned,
       count(*) FILTER (WHERE what = 'renewed') AS renewed
  FROM ev
 WHERE m BETWEEN DATE '2026-04-01' AND DATE '2027-03-01'
 GROUP BY m ORDER BY m
```

Note: lost loans are closed with a `returned_on` too; they are left out of "returned" here.

**5. The 20 most borrowed titles this session.**

```sql
SELECT t.code, t.title, t.author, s.name AS subject, count(*) AS issues,
       count(DISTINCT (l.borrower_kind, l.borrower_id)) AS readers
  FROM library_loans l
  JOIN library_copies x ON x.id = l.copy_id
  JOIN library_titles t ON t.id = x.title_id
  LEFT JOIN library_subjects s ON s.id = t.subject_id
 WHERE l.issued_on BETWEEN DATE '2026-04-01' AND DATE '2027-03-31'
 GROUP BY t.id, t.code, t.title, t.author, s.name
 ORDER BY issues DESC
 LIMIT 20
```

**6. Late fines raised, paid, still due and waived per month (crosses into fees).**

```sql
WITH raised AS (
  SELECT date_trunc('month', ch.on_date)::date AS m, sum(ch.amount) AS late_fines_raised,
         sum(ml.paid) AS paid_so_far,
         sum(ml.amount - ml.paid) FILTER (WHERE ml.status = 'open') AS still_due
    FROM library_charges ch
    JOIN misc_fee_students ml ON ml.id = ch.misc_line_id
   WHERE ch.kind = 'late'
   GROUP BY 1),
waived AS (
  SELECT date_trunc('month', w.waived_on)::date AS m, sum(w.amount) AS waived_at_desk
    FROM library_fine_waivers w GROUP BY 1)
SELECT COALESCE(r.m, w.m) AS month, r.late_fines_raised, r.paid_so_far, r.still_due, w.waived_at_desk
  FROM raised r FULL JOIN waived w ON w.m = r.m
 ORDER BY 1
```

Note: fines from before 0217 are on `library_loans` only (see Life-cycles); add them separately if the period is older.

**7. Lost and damaged books charged this session, and whether they are paid.**

```sql
SELECT ch.kind, ch.on_date, ch.borrower_kind,
       COALESCE(st.admission_no, em.employee_code) AS ref,
       x.accession_no, t.title, ch.price, ch.processing_fee, ch.late_fine, ch.amount,
       ml.paid, ml.status AS line_status, ch.found_on
  FROM library_charges ch
  JOIN library_copies x ON x.id = ch.copy_id
  JOIN library_titles t ON t.id = x.title_id
  LEFT JOIN misc_fee_students ml ON ml.id = ch.misc_line_id
  LEFT JOIN students st ON ch.borrower_kind = 'student' AND st.id = ch.borrower_id
  LEFT JOIN employees em ON ch.borrower_kind = 'employee' AND em.id = ch.borrower_id
 WHERE ch.kind IN ('lost', 'damaged')
   AND ch.on_date BETWEEN DATE '2026-04-01' AND DATE '2027-03-31'
 ORDER BY ch.on_date DESC
```

**8. Titles people are waiting for.**

```sql
SELECT t.title, r.status, count(*) AS reservations,
       min(r.placed_at) AS oldest_placed,
       count(*) FILTER (WHERE r.status = 'ready' AND r.ready_until < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS ready_but_expired
  FROM library_reservations r
  JOIN library_titles t ON t.id = r.title_id
 WHERE r.status IN ('waiting', 'ready')
 GROUP BY t.title, r.status
 ORDER BY reservations DESC
```

Note: holds past `ready_until` are only turned to `lapsed` when the reservations screen runs; count them apart.

**9. Result of each stock verification cycle.**

```sql
SELECT k.id, k.name, k.status, k.started_on, k.finished_on,
       count(i.id) AS in_scope,
       count(i.id) FILTER (WHERE i.outcome = 'found')   AS found,
       count(i.id) FILTER (WHERE i.outcome = 'missing') AS missing,
       count(i.id) FILTER (WHERE i.outcome = 'on_loan') AS on_loan,
       count(i.id) FILTER (WHERE i.outcome = 'gone')    AS gone,
       count(i.id) FILTER (WHERE i.outcome = 'pending') AS not_yet_seen,
       (SELECT count(*) FROM library_stock_check_extras e WHERE e.check_id = k.id) AS extras_scanned
  FROM library_stock_checks k
  LEFT JOIN library_stock_check_items i ON i.check_id = k.id
 WHERE k.status <> 'cancelled'
 GROUP BY k.id
 ORDER BY k.started_on DESC
```

Note: counting the items works for open and closed cycles; the cached columns are filled only at close.

**10. Periodicals: issues received, missing and late per active subscription.**

```sql
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d)
SELECT p.name AS periodical, s.frequency, v.name AS vendor, s.starts_on, s.ends_on,
       count(i.id) FILTER (WHERE i.status = 'received') AS received,
       count(i.id) FILTER (WHERE i.status = 'missing') AS missing,
       count(i.id) FILTER (WHERE i.status = 'expected' AND i.expected_on + s.grace_days < today.d) AS late,
       count(i.id) FILTER (WHERE i.status = 'expected' AND i.expected_on >= today.d) AS still_to_come
  FROM library_subscriptions s
  CROSS JOIN today
  JOIN library_periodicals p ON p.id = s.periodical_id
  LEFT JOIN library_vendors v ON v.id = s.vendor_id
  LEFT JOIN library_periodical_issues i ON i.subscription_id = s.id
 WHERE s.status = 'active'
 GROUP BY p.name, s.id, s.frequency, v.name, s.starts_on, s.ends_on
 ORDER BY late DESC, p.name
```

**11. Book sales per month by kind of buyer.**

```sql
SELECT date_trunc('month', o.sold_on)::date AS month, o.buyer_kind,
       count(*) AS sales, sum(o.books) AS books, sum(o.total) AS amount,
       sum(o.total) FILTER (WHERE o.misc_receipt_id IS NOT NULL) AS paid_at_library
  FROM library_sale_orders o
 WHERE o.sold_on BETWEEN DATE '2026-04-01' AND DATE '2027-03-31'
 GROUP BY 1, 2
 ORDER BY 1, 2
```

**12. Pupils who have not borrowed a book this session, by class (crosses into academics).**

```sql
WITH yr AS (SELECT id, start_date, end_date FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT k.name AS class, cs.name AS section,
       count(*) AS pupils,
       count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM library_loans l
          WHERE l.borrower_kind = 'student' AND l.borrower_id = e.student_id
            AND l.issued_on BETWEEN yr.start_date AND yr.end_date)) AS never_borrowed
  FROM enrolments e
  JOIN yr ON yr.id = e.academic_year_id
  JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
  JOIN class_sections cs ON cs.id = e.class_section_id
  JOIN classes k ON k.id = cs.class_id
 WHERE e.status = 'active'
 GROUP BY k.name, k.display_order, cs.name
 ORDER BY k.display_order, cs.name
```

## Traps

- **`returned_on` does not always mean the book came back.** A lost book closes its loan on the day reported. Check
  `library_charges.kind = 'lost'` (or the copy status) before counting returns.
- **Two fine systems.** Since 0217 a late fine is a `library_charges` row (kind `late`) and a misc fee line; before
  that it lived only on `library_loans.fine_*`. Adding `fine_amount − fine_waived` to the charges double-counts.
- **What is paid is in the fees tables.** `library_charges.amount` is what was raised; read `misc_fee_students.paid`
  / `status` (and skip `cancelled` lines) for what was collected or is still due.
- **Borrower ids have no foreign key.** `borrower_id` is a student id or an employee id depending on
  `borrower_kind`; joining `students` without the kind filter matches the wrong people. Same for `buyer_id`.
- **Holdings exclude withdrawn and sold copies,** but include lost and damaged. Say which you count.
- **Library staff see only their libraries.** A restrictive row rule (0221) hides other libraries' copies, shelves,
  series and subscriptions from a user named in `library_staff`. Loans, charges and reservations are not limited
  themselves, so a query on `library_loans` alone shows every library while one joined to `library_copies` does
  not: totals can differ by who runs them. Admins (named on no library) see all.
- **Lazy status changes.** Reservations past `ready_until` stay `ready` until the reservations screen runs;
  stock-cycle cached counts are filled at close.
- **Title text columns are copies.** `library_titles.author`, `publisher`, `language`, `category` repeat the
  names of the linked masters for search; group by the ids (`publisher_id`, `language_id`, `subject_id`,
  `library_title_authors`) for clean counts. `category` is the old subject; `location` is the old rack text.
- **Accession numbers change.** A corrected number is kept in `library_accession_changes`; the old number still
  names the copy at the desk. Search both `library_copies.accession_no` and `library_accession_changes.old_no`.
- **Renewal history before 0218 has no due dates** (`from_due` / `to_due` NULL); `library_loans.renewed` is the count.
- **`is_reference` titles and non-`issuable` material types** are not lent; leave them out of "circulation per
  copy" ratios.
- **Merged / deleted pupils:** merges move loans, charges, reservations and sales to the kept record; still exclude
  `students.deleted_at IS NOT NULL` and `merged_into_id IS NOT NULL` in lists.
- **Dates on timestamptz columns** (`placed_at`, `changed_at`, `at`, `marked_at`) are UTC in storage: convert with
  `AT TIME ZONE 'Asia/Kolkata'` before taking the date.
- **Import and upload tables are work files.** Do not count books from `library_import_rows`; count
  `library_copies`.
- **Purchase or donation.** `library_copies.acquisition` was filled from the older free-text `source` only where it
  began with "pur" or "don"; other older copies have it empty. Group accessions by `accessioned_on` and treat an
  empty `acquisition` as "not given".

## Personal and sensitive data

Mask these, or never send them to an AI model:

- **Who read what:** `library_loans.borrower_id` with `borrower_kind` (a pupil's reading history is personal),
  `library_reservations` borrowers, `library_charges` borrowers. Aggregate by class rather than by named pupil
  where possible.
- **Buyers:** `library_sale_orders.buyer_name`, `buyer_mobile`, `buyer_id`; `library_sales.buyer_name`, `buyer_id`.
- **Vendors (people and firms):** `library_vendors.contact_person`, `mobile`, `phone`, `email`, `address`, `gstin`.
- **Staff names copied into rows:** `*_by_name` columns (`changed_by_name`, `created_by_name`, `by_name`,
  `sold_by_name`, `added_by_name`, `found_by_name`, `started_by_name`, `closed_by_name`, `ended_by_name`,
  `marked_by_name`); `library_staff.employee_id`.
- **Free text:** `library_loans.note`, `library_charges.reason`, `library_fine_waivers.reason`,
  `library_reservations.end_reason`, `library_copy_events.reason`, `library_accession_changes.reason`,
  `library_copies.remarks` / `status_reason` / `donor`, `library_sale_orders.note`, `library_stock_checks.note` /
  `cancel_reason` / `reopen_log`, `library_stock_check_items.remark`, `library_stock_check_extras.remark`.
- **Raw uploads** may hold names and numbers: `library_import_rows.data`, `library_sale_uploads.rows` / `result`,
  `library_stock_uploads.rows` / `result`, `library_imports.summary`.
