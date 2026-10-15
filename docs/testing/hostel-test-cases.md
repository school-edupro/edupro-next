# Hostel module — test cases (H1–H4)

Scope: hostel set-up and allotment (H1), roll-call and hostel leave (H2), visitors and mess (H3),
complaints, incidents, sick bay and dashboard (H4), and the hostel fee they drive. Apps: **Admin**
(localhost:3000), **Parent** (3001), **Staff app** (3002), **API** (4000).

- **Auto** = covered by the API e2e tests (`apps/api/test/hostel-*.e2e-spec.ts`, plus
  `gatepass`, `helpdesk`, `hostel-fee`). **UI** = walked through in the browser.
- Roles: Admin (school_admin), Warden (warden role + employee linked to a hostel), Other warden
  (warden of another hostel), Gate (gate_security), Parent (guardian of the boarder), Clerk.

## H1 · Set-up and allotment

| ID | Area | Steps | Expected | Auto |
|---|---|---|---|---|
| H1-01 | Hostel | Set-up → Hostels: add "Boys Hostel", code BH, for Boys | Saved; appears in the list and on Occupancy | ✔ |
| H1-02 | Hostel | Add a second hostel with the same code | Refused: "Hostel code BH is already used" | ✔ |
| H1-03 | Block | Add block A with 3 floors | Saved; block appears under the hostel | ✔ |
| H1-04 | Room type | Add "AC double", seater 2, AC, fee group `ac_two` | Saved | ✔ |
| H1-05 | Room | Add room 101, block A, floor 1, type Non-AC triple | Room made with beds A, B, C | ✔ |
| H1-06 | Room | Add a room on floor 5 of a 3-floor block | Refused: floor out of range | ✔ |
| H1-07 | Rights | Clerk opens Set-up / adds a hostel | Not in the menu; API 403 | ✔ |
| H1-08 | Wardens | Set W1 as head warden of Boys Hostel | Saved; shown on the hostel and on the pupil's stay | ✔ |
| H1-09 | Allot | Allot a boy to 101-A from 15 June | Pupil becomes hosteller from June; hostel fee from June at the room type's group | ✔ |
| H1-10 | Allot | Allot another pupil to a held bed | Refused, names the holder | ✔ |
| H1-11 | Allot | Allot a pupil who already holds a bed | Refused: use Transfer | ✔ |
| H1-12 | Allot | Allot a boy to a girls' hostel bed | Refused: gender mismatch, says to correct the record if wrong | ✔ UI |
| H1-13 | Transfer | Move the pupil to an AC double from 10 Sep | Old stay ends 9 Sep; June–Aug at old rate, Sep on at new rate; paid months named | ✔ |
| H1-14 | Vacate | End the stay on 5 Dec | Hostel fee up to December only; stay closed in the history | ✔ |
| H1-15 | No bed | Hosteller by fee profile with no bed | Listed under "Hostellers with no bed" | ✔ |
| H1-16 | Occupancy | Open Occupancy for a hostel on a date | Beds / taken / free / blocked; rooms by block and floor; free bed links to Allot | ✔ UI |
| H1-17 | Register | Register, filter "Staying now" | Only current and future stays | ✔ UI |
| H1-18 | Warden scope | Warden opens hostels / board | Only their hostel | ✔ |
| H1-19 | Beds | Block a held bed; delete a used bed; close an occupied room | All refused | ✔ |
| H1-20 | Excel | Download the format; upload with Check | Nothing kept; problems listed by Excel row | ✔ UI |
| H1-21 | Excel | Upload with Apply | Blocks / rooms / beds made; pupils allotted; block floors raised | ✔ |
| H1-22 | Profile | Pupil → Fees tab | "Hostel bed: <hostel · room · bed>, since …" | UI |
| H1-23 | Fee | A school with no room types allots a hosteller | Hostel fee unchanged | ✔ UI |

## H2 · Roll-call and hostel leave

| ID | Area | Steps | Expected | Auto |
|---|---|---|---|---|
| H2-01 | Rules | Set-up → Roll-call and leave rules: grace 15, escalate 3 h, outing 20:00 | Saved; warden cannot change them | ✔ |
| H2-02 | Sessions | Add Night 21:30; add Night again | Second refused | ✔ |
| H2-03 | Roll | Warden opens Night roll today | Every boarder, present by default | ✔ |
| H2-04 | Roll | Other hostel's warden opens it | 403 | ✔ |
| H2-05 | Roll | Mark one absent with a note, save | Counts shown; head warden (and parent by rule) alerted once | ✔ |
| H2-06 | Roll | Save the same roll again | No second alert | ✔ |
| H2-07 | Roll | Put a day scholar in the roll / roll for tomorrow | Both refused | ✔ |
| H2-08 | Report | Hostel → Roll-call, today | Session, present/absent/leave/sick, absentees; sessions not taken | ✔ UI |
| H2-09 | Leave | Parent asks Home leave without a return day | Refused | ✔ |
| H2-10 | Leave | Parent asks Home leave (today → +2 days, 17:00, father) | Pending with the boy's hostel wardens only | ✔ |
| H2-11 | Leave | Warden approves | "Approved: the warden hands over" | ✔ |
| H2-12 | Leave | Gate tries to let out before hand-over | Refused: warden has not handed over | ✔ |
| H2-13 | Leave | Other warden hands over | 403 | ✔ |
| H2-14 | Leave | Warden hands over (live photo) | Handed over; gate lets out; "Out on leave" | ✔ |
| H2-15 | Roll | Roll while the boy is out | He is On leave whatever is ticked | ✔ |
| H2-16 | Overdue | Return time passes (+grace) | Listed as overdue; tick tells parent + head warden once, principal after the hours | ✔ |
| H2-17 | Return | Gate marks back in late | "Back in the hostel"; late minutes recorded | ✔ |
| H2-18 | Outing | Outing back after the latest time / next day | Refused | ✔ |
| H2-19 | Outing | Outing today | No hand-over; gate out and in | ✔ |
| H2-20 | Day scholar | Parent of a day scholar asks hostel leave | Refused: not a boarder; choices not offered | ✔ UI |
| H2-21 | Admin | Hostel → Leave and outings tabs | Away / overdue / to hand over / waiting / all | UI |

## H3 · Visitors and mess

| ID | Area | Steps | Expected | Auto |
|---|---|---|---|---|
| H3-01 | List | Parent adds Uncle Raj with photo | Pending; duplicate mobile refused | ✔ UI |
| H3-02 | List | Other warden decides it | 403; not in their queue | ✔ |
| H3-03 | List | Pupil's warden approves | Approved; parent sees it | ✔ |
| H3-04 | List | Office adds Aunt directly | Approved at once | ✔ |
| H3-05 | Gate | Listed visitor in hours | Let in; parent told | ✔ |
| H3-06 | Gate | Stranger | Waits: "not on the approved list"; wardens told | ✔ |
| H3-07 | Hours | Hours set for another day; parent comes | Waits: "outside visiting hours" | ✔ |
| H3-08 | Decide | Other warden allows | 403 | ✔ |
| H3-09 | Decide | Warden refuses one, allows the other; allows again | Refused → cancelled; allowed → inside; second try 409 | ✔ |
| H3-10 | Meals | Add Lunch and Dinner; add Lunch again | Second refused | ✔ |
| H3-11 | Menu | Save the weekly menu; other warden saves | Saved; other 403 | ✔ |
| H3-12 | Change | Festival thali for today; clear it | Shown as changed; back to weekly menu | ✔ |
| H3-13 | Parent | Hostel page → Mess menu | Week with today marked; changes flagged | ✔ UI |
| H3-14 | Meals | Warden ticks who skipped lunch | Served / skipped counts; away pupils left out | ✔ |
| H3-15 | Diet | Set Jain, no onion-garlic | Kitchen list shows it with the allergy from the record | ✔ |

## H4 · Complaints, incidents, sick bay, dashboard

| ID | Area | Steps | Expected | Auto |
|---|---|---|---|---|
| H4-01 | Complaint | Parent raises "Fan not working" (Electrical) | H/ number; assigned to the hostel's head warden; due time set | ✔ UI |
| H4-02 | Complaint | Lists | Warden sees it; other warden does not; parent sees status | ✔ |
| H4-03 | Complaint | Warden raises one for a room; without a room | Raised; second refused | ✔ |
| H4-04 | Helpdesk | Helpdesk → Hostel complaints desk | Listed; answer / close / escalate as other desks | ✔ UI |
| H4-05 | Incident | Minor, not shared | Recorded; parent does not see it | ✔ |
| H4-06 | Incident | Serious, tell parent | Parent and principal told; parent sees it | ✔ |
| H4-07 | Incident | Other warden records for this boy | 403 | ✔ |
| H4-08 | Sick bay | Warden's note (fever 38.6) | Clinic visit "Hostel sick bay (…)"; listed | ✔ |
| H4-09 | Dashboard | Hostel → Dashboard | Totals, each hostel today, trends, fee per hostel | ✔ UI |

## Non-functional

| ID | Check | Expected |
|---|---|---|
| NF-01 | Accessibility (axe) on every admin hostel page | No serious or critical violations |
| NF-02 | Phone width (375 px) on parent Hostel and staff Hostel desk | No sideways scroll; pay/roll bars usable |
| NF-03 | Hindi (हिन्दी) on parent and staff screens | New labels translated |
| NF-04 | Typecheck and lint, all apps | Clean |

## Run of 15 Oct 2026

**Automated** (API e2e: hostel-module, hostel-h2, hostel-h3, hostel-h4, hostel-fee, gatepass, helpdesk,
visitors, clinic, permission-coverage): **57 / 57 passed**. Accessibility (axe) on the 22 admin hostel
pages: passed (single-page reruns where the API rate limiter tripped under the burst).

**Browser walkthrough** (in-app browser; demo school, boarder Aarav Sharma A2481 in the Girls Hostel;
dev-teacher Anita Deshmukh made head warden of both demo hostels for the run):

| ID | Result | Seen |
|---|---|---|
| H1-16, H4-09 | Pass | Dashboard and Occupancy with live figures |
| H3-01 | Pass | Parent added "Uncle Raj (test)" → "Waiting for the warden" |
| H4-01 | Pass | Parent complaint H/2026-27/0015, assigned to the head warden |
| H2-18 | Pass | Outing after the latest time refused ("The return must be after the leave starts") |
| H2-10 | Pass | Home leave REQ-226 waiting with the Warden level |
| H2-11 | Pass | Warden approved in the staff app → "To hand over today" |
| H3-03 | Pass | Warden approved the visitor |
| H2-14 | Pass | Warden handed over; gate let out → "Out on leave: to come back" |
| H2-15 | Pass | Night roll saved: 0 present, 1 on leave (set by the system) |
| H4-05 | Pass | Minor incident recorded; not shown to the parent |
| H4-08 | Pass | Sick-bay note saved in the clinic record |
| H3-14, H3-15 | Pass | Dinner: 0 had it, 1 away; diet list "Jain: 1" |
| H3-07, H3-09 | Pass | Listed visitor outside hours waited; warden allowed; parent told |
| H2-17 | Pass | Gate marked back in → "Back in the hostel" |
| H4-04 | Pass | Warden closed the complaint with a resolution; parent sees "Closed" and the resolution |
| H2-21 / reports | Pass | Leave, Roll-call, Visitors, Complaints, Incidents pages show the run |

**Defects found and fixed in the run**

| # | Defect | Fix |
|---|---|---|
| D1 | Parent gate-pass form lost the chosen kind after an error | The error return keeps `kind` |
| D2 | Parent pass page did not show the return time; staff app showed "back by 05:00 pm" without the day | "Back in the hostel by 16 Oct 2026, 05:00 pm"; the staff app adds the day when it differs |
| D3 | A placeholder "na" in the student record showed as an allergy | na / n/a / nil / none / no / - are ignored |
| D4 | A visitor could be let in to meet a pupil who is away on hostel leave | The gate warns; such a visit waits for the warden ("the pupil is away on hostel leave"); covered by the H2 test |

Messages during the run: 4 emails (3 to demo `example.test` addresses, 1 gate-pass approval to a parent
address); no SMS or WhatsApp (no hostel or gate-pass template is ready).
