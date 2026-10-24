# 40 — Session fee table and merit points (plan, 24 Oct 2026)

Two gaps found on the admission session page (`/admissions/cycles/:id`), benchmarked against Entab
CampusCare, Edunext, MyClassboard and the Delhi nursery points system:

1. **Fee tab** — the five categories (EWS/DG, Staff ward, Sibling, Alumni, General) × registration fee,
   admission fee and seats make a table ~2.8× the screen width; General, the default, is the last
   column and off screen. Nothing says the categories live in Admission set-up.
2. **Merit points** — points can only be entered when a session is created, cannot be edited, and only
   the old Applications flow scores them (it reads fixed keys such as `alumniParent`, `distanceKm`).
   Registrations made with form-builder forms never get points; the merit list is test/interview
   marks only, ties broken by registration time.

What the best ERPs do: criteria are their own set-up screen, editable until registrations close; each
criterion hangs on a form answer; points are worked out on submit with a breakdown, confirmed at
document check; the merit list adds test marks where there is a test and applies a published
tie-break; the criteria are shown on the public admission page.

## Decisions (asked and answered, 24 Oct 2026)

| #   | Question                          | Decision                                                                                                                 |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Fee tab layout                    | **A card per class**: rows = categories (General first), columns = Registration, Admission, Seats; "copy to all classes" |
| 2   | Points scope                      | **Session-wide, with a per-class override** (e.g. Nursery differs from IX)                                               |
| 3   | Points and test / interview marks | **Added**: merit = form points + marks; classes without a test rank on points alone                                      |
| 4   | Tie-break                         | **Older child first, then a draw of lots** with a recorded seed                                                          |

Defaults taken (change on request): criteria editable while the session is draft or open, and points
of registrations not yet past Document check are worked out again when a criterion changes; after
Document check the points are frozen unless the office adjusts them; an adjustment needs a reason and
is audited; the old Applications flow keeps its own scoring untouched.

## Parts

**Part 1 — Fee tab as class cards (built 24 Oct 2026).** One card per class: categories as rows in their sort order with the
default (General) first, each row Registration fee, Admission fee, Seats (blank = from the class's
seats); "Copy to all classes" on a card; a line "Categories are set in Admission set-up" with a link;
the total of category seats against the class's seats shown, with a warning when it is more. No
sideways scroll. Remove the merit section from the New session form (part 2 replaces it).

**Part 2 — Merit points set-up (built 24 Oct 2026, migration 0240).** Table `admission_point_rules` (session, class or null for all, name,
logic all/any, conditions on form answers, points, sort, active). New tab **Merit points** on the
session page: the session's list, and per class "Use the session's points" or "Own points for this
class" (copied from the session's to start). Each criterion: a name, "when [question] [is / is not /
at most / at least / any of] [answer]" on the questions of the forms the session's classes use (the
same builder as form rules), points (negative allowed for deductions). Ready starters: sibling,
alumni parent, staff ward, girl child, first child, distance bands, single parent, transfer case.
The public admission page lists each class's criteria and points.

**Part 3 — Points worked out (built 24 Oct 2026, migration 0241).** On submit (and on a criteria change, for registrations before Document
check) the points are worked out from the answers: `form_points` and `points_breakdown` on the
registration. The registration page and the candidate's portal show the breakdown. At Document check
the office confirms or adjusts a criterion (with a reason, audited). Merit = form points + live
test / interview marks (`meritOf`), so Selection and the stage lists rank on it.

**Part 4 — Merit list and tie-break.** Selection orders by merit, then date of birth (older first), then
a draw of lots for those still equal (seed recorded on the list, reproducible). The list shows the
points, marks and total columns and marks tied candidates; the merit list PDF / export carries the
criteria and the tie-break rule.
