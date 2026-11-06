# 79 · Attendance report on a mark register's Run: A, P, X, Total and % between two dates

Status: built 6 Nov 2026 (no migration; **As built** at the end). Asked by the school on a mark register's Run (`/exams/schemes/417/register`,
Reports), with the old system's Excel (`~/Downloads/Attendance_Report.xls`; a real class's report: its
layout and wording only are used here).

## The old report

- **Heading**: the school, "Attendence Report", the class ("Class-XI-RKP": every section of it), "Date
  Range 06-Oct-2026 to 06-Nov-2026", "Session 2026-2027 | Generated on: 06-11-2026 05:41 AM".
- **A block per section**: "Section: XI-RKP-A", then a line per pupil: **SRN** · **Class** (the section)
  · **Roll No** · **Student ID** (admission no) · **Name** · **A** · **P** · **X** · **Total** ·
  **(P\*100)/(Total-X) = Per**. Total = A + P + X for every pupil; the % leaves X out (P × 100 ÷
  (Total − X)), to two decimals (100, 11.76, 12.5); a pupil with nothing marked in the range is listed
  with zeros (0 % printed).

## What EduPro has

- **Daily attendance** (`attendance_sessions` kind `day` per section and date, `attendance_marks` per
  pupil): P present, A absent, L late, SR short leave, H half day, OD on duty, SB stay back, LV leave.
- **Attendance → Registers** (the monthly register): a column per day; present = every mark but A and
  LV; % = present ÷ the days marked (leave lowers it).
- **The mark register's Run** has the place (a section, or a class: each section), its pupils in roll
  order, the letterhead and the Excel / PDF files; the exam attendance (per exam, counted from daily
  attendance) is a different figure and stays as it is.

## Decisions (user, 6 Nov 2026)

| Question                | Answer                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Where                   | **The register's Run → Reports → Attendance**, for the place picked, with From and To dates                    |
| The dates by default    | **The session's first day to today**; From and To change them                                                  |
| A / P / X               | **A = absent; P = present (late counted present); X = on leave; Total = A + P + X; % = P × 100 ÷ (Total − X)** |
| Not marked in the range | **Listed with zeros**, as the Excel                                                                            |

Decided here: P takes every mark but A and LV (late, short leave, half day, on duty, stay back), as the
monthly register counts them; a pupil with nothing marked shows 0s and a blank % (the Excel's "0.0"
reads as 0 %, which is not what it means); the % to two decimals, trailing zeros dropped (100, 11.76,
12.5); the Subject picker does not apply (attendance is the day's, not a subject's).

## Plan

1. **The report** (`report=attendance`): a table per section ("Attendance — VI-A · 01-Apr-2026 to
   06-Nov-2026"), every pupil of the section by roll: SRN · Class · Roll No · Student ID · Name · A · P ·
   X · Total · %. A note: "A = absent · P = present (late, short leave, half day, on duty and stay back
   count as present) · X = on leave · Total = A + P + X · % = P × 100 ÷ (Total − X) · a pupil with
   nothing marked: 0s, no %". A class: each section's table in turn (as the Excel), the class's pupils
   only (their enrolment, active).
2. **Dates**: **From** and **To** on the Run page for this report (date pickers), by default the
   session's first day and today; From after To refused; the heading and the file names say the range;
   the downloads carry it.
3. **API**: the kind `attendance` with `from`, `to` (dates); the day marks of the place's sections
   between them counted per pupil in one query (A, LV, the rest); the register's Run right, as the other
   reports.
4. **Help** (Mark registers → Run → Reports) and doc 68's report list.

## Parts

1. **The report**: `attendance()` in `packages/db/src/mark-register-reports.ts` from the counts given
   (`ReportInput.daily`, `from`, `to`); unit tests — the columns, Total and %, X out of the %, late in P,
   nothing marked, a class with two sections, roll order.
2. **The API, the Run page and the checks**: the query (`report=attendance`, `from`, `to`, the default
   dates, From after To refused), the counts loaded, the From / To pickers, the downloads; help and doc
   68; the register e2e (counts from marked days, the range, the 400); register 417 in the browser with
   axe.

## Not in scope

The Attendance module's own reports (Attendance → Registers stays as it is); period-wise (subject)
attendance; messages to parents.

## As built (6 Nov 2026)

- **Engine** (`attendance()` in `packages/db/src/mark-register-reports.ts`; `ReportInput.daily`, `from`,
  `to`): a table per section ("Attendance — VI-A · 06-Oct-2026 to 06-Nov-2026"), every pupil of the
  section by roll: SRN, Class, Roll No, Student ID, Name, A (red when some), P, X, Total, % (to two
  decimals, blank with nothing to count); the note gives the rule and how many pupils have nothing
  marked. "Total - X" is written with a hyphen: the PDF's font has no minus sign.
- **API**: `report=attendance`, `from` / `to` (YYYY-MM-DD; From after To refused, 400); by default the
  session's first day (`academic_years.start_date`) and today in IST; `dailyAttendance()` counts the day
  marks of the place's sections between them in one query (A, LV, every other code as present);
  returned as `range`; the marks' notes are not added for this report; the file names carry the dates.
- **Admin**: the Run page's **From** / **To** (date) and **Show** for this report, the help line; the
  result chips and the Subject picker hidden for it; the downloads take `from` / `to`.
- **Tests**: unit (3: the menu; the columns, Total, % without the leave, nothing marked and the note, a
  class with two sections; one section by roll); `mark-registers` e2e (three days marked for VI-A: the
  default range, a range and a shorter one with A / P / X / Total / %, From after To refused). Register
  417 on Alpha: Class VI from 01-Apr-2026 (VI-A 27 days marked), the Excel and the PDF (one page), the
  page in the browser with axe: clean.
