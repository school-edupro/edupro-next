# MySQL to PostgreSQL mapping catalogue

Source: the legacy MySQL schemas (per school) as observed in the blueprint. Target: the PostgreSQL 16 schema in `packages/db`. This catalogue drives the ETL transforms in `packages/etl/src/transforms.ts`.

## 1. Column types

| Legacy MySQL | Target PostgreSQL | Rule |
|---|---|---|
| `INT AUTO_INCREMENT` (`srno`) | `BIGINT GENERATED ALWAYS AS IDENTITY` | never reuse legacy ids; keep them in `legacy_ref` and `etl.legacy_map` |
| `VARCHAR(n)` free text | `TEXT` | trim; empty string to `NULL` unless the column is `NOT NULL`; collapse internal double spaces |
| `VARCHAR` used as enum (`'Active'`, `'Yes'`) | enum or `BOOLEAN` | `normaliseStatus`, `yesNoToBoolean` |
| `TINYINT(1)` | `BOOLEAN` | `0/1` to `false/true` |
| `INT` amounts, `DOUBLE`, `FLOAT`, `VARCHAR` money | `NUMERIC(12,2)` | `toMoney`: strip commas and currency, round half up to 2 dp; reject non-numeric |
| `DATE` with `0000-00-00` | `DATE NULL` | zero dates to `NULL` |
| `DATETIME` naive IST | `TIMESTAMPTZ` | interpret as `Asia/Kolkata`, store UTC |
| split `LoginDate` + `LoginTime` | one `TIMESTAMPTZ` | combine, IST |
| `VARCHAR` dates (`dd/mm/yyyy`, `dd-mm-yyyy`, `yyyy-mm-dd`) | `DATE` | `normaliseDate`, day-first when ambiguous (Indian convention), reject invalid |
| `ENUM(...)` | PostgreSQL enum or `TEXT` with `CHECK` | map values case-insensitively |
| `TEXT` JSON-ish or serialised PHP arrays | `JSONB` | parse; PHP `serialize()` output is converted with `phpUnserialize` (limited to arrays and scalars) |
| `VARCHAR` mobile (`+91 98765-43210`, `9876543210,9876543211`) | `TEXT` E.164-ish 10 digits | `normaliseMobile`: first valid Indian 10-digit number; extras to a second column or dropped with a report line |
| `VARCHAR` email | `CITEXT` | lower-case, validate loosely, invalid to `NULL` with report |
| `utf8` / `latin1` columns with mojibake | `UTF8` | detect double-encoded UTF-8 and repair |
| `FinancialYear VARCHAR` (`'2025'`, `'2025-26'`, `'2025-2026'`) | `academic_years.id` via code `'2025-26'` | `normaliseYearCode` then lookup |
| `sclass VARCHAR` (`'VI-A'`, `'XI-Sci-A'`, `'Nursery-A'`) | `classes.code` + `class_sections.name` | `splitLegacySection`: last hyphen splits section; the rest is the class code |
| `MasterClass VARCHAR` (`'VI'`) | `classes.code` | trim, upper-case Roman numerals, map `'Nur'`/`'Nursery'` variants to one code per school mapping file |
| `Month VARCHAR` (`'April'`, `'Apr'`, `'4'`) and `Quarter VARCHAR` | `fee_periods` rows | `normaliseMonth` to 1..12; quarters from school settings |
| `isTrash TINYINT` | `deleted_at TIMESTAMPTZ` | `1` to the row's last update time or the migration time |
| `Status` string workflow values (`Approved`, `Pending`, `Rejected`) | workflow instance state | mapped per module in its ETL step, not by the generic status rule |

## 2. Keys and identity

| Legacy | Target | Rule |
|---|---|---|
| `sadmission` (also `sadmissionno`, `student_admission`, `adm`) | `students.admission_no`, unique per school | trim, upper-case; the same admission number across FinancialYear rows is one student |
| `EmpId` (`EmpID`, `empID`, `EmployeeId`, `emp_id`) | `employees.employee_code`, unique per school | as above; `'Admin'` is not an employee, it becomes a Group Admin user |
| `srno` | `legacy_ref` and `etl.legacy_map` | never a foreign key in the target |
| `class` + `MasterClass` | `class_sections` (per year) + `classes` | via `splitLegacySection` |
| `suser` (`admin` table) | `users` | one user, memberships in every school of the group |
| mobile numbers as login identity | `users.mobile` and One Auth | provisioning list, not a key |

## 3. Yearly copies to dimensions (ADR-003)

| Legacy pattern | Target |
|---|---|
| `student_master` row per (sadmission, FinancialYear) | one `students` row; one `student_enrollments` row per year with class section, roll no, status, transport, hostel, category, discount |
| `employee_master` row per (EmpId, FinancialYear) | one `employees` row; one `employee_postings` row per year |
| `fees_master` per year | `fee_structures` per year |
| `menu_master`, `user_menu_master` per year | dropped; replaced by roles (see catalogue section 5) |
| `FYmaster` | `academic_years` and `financial_years` |

## 4. Statuses

| Legacy value | Target |
|---|---|
| `1`, `'1'`, `'Active'`, `'active'`, `'Yes'`, `'Y'`, `true` | `active` (or `true` for booleans) |
| `0`, `'0'`, `'Inactive'`, `'inactive'`, `'No'`, `'N'`, `false`, `'InActive'` | `inactive` (or `false`) |
| `''`, `NULL` | column default; reported |
| anything else | rejected with a report line; the module ETL decides |

## 5. Money and receipts

| Legacy | Target |
|---|---|
| `'TF' + MAX+1` receipt numbers | kept verbatim in `receipts.receipt_no` for history; `receipt_sequences.next_no` set past the maximum per ledger and financial year |
| `fees` header + `fees_transaction` lines | `receipts` + `receipt_lines`; totals must equal per receipt or the receipt is quarantined |
| `fees_student` demand rows | `fee_demands`; per (student, year) totals reconciled against legacy `SUM(amount)` |
| late fee columns (`ActualLateFee`, `AdjustedLateFee`) | `receipt_lines` with head `late_fee` and `fee_adjustments` for overrides |
| `hostel_fees*` mirrors | same tables with `ledger_type = 'hostel'` |

## 6. Reporting of rejects

Every transform returns either a value or a `Reject { table, legacyKey, column, reason, raw }`. Rejects go to `etl.rejects` and the reconciliation report; a school cutover is blocked while any reject touches money, marks or identity.
