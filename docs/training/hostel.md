# Hostel (October 2026)

The **Hostel** menu keeps the boarding house: hostels, rooms and beds, who holds which bed, and the
wardens. The hostel **fee** stays in Fees (hostel ledger, hostel calendar, hostel bill and receipts);
an allotment here keeps it in step by itself. Plan and later phases: `docs/design/25-hostel-module.md`.

| Who                   | Rights                                                                        |
| --------------------- | ----------------------------------------------------------------------------- |
| School admin          | everything (_hostel.setup.manage_, _hostel.allot.manage_, _hostel.room.view_) |
| Hostel office         | give the role with _hostel.allot.manage_ and _hostel.room.view_               |
| **Warden** (new role) | sees only the hostels they are a warden of; allots nothing                    |
| Accountant            | sees the hostels and who stays where                                          |

## 1. Set-up (Hostel → Set-up)

1. **Hostels and wardens**: name, code (for example BH), for boys, girls or both, phone, address.
   Blocks with their number of floors. Wardens are staff: tick the head warden. Give each warden
   the **Warden** role (Access → Users).
2. **Room types and fee**: name, beds (seater), AC, and the **hostel fee group**. The fee group is
   a fee group of _Fee setup → Fee structures_ that holds the hostel heads for that kind of room
   (for example `ac_double` with Boarding ₹5,000 a month). Leave it empty and the pupil pays by
   their own fee group, as before the module. Changing the group re-prices the unpaid hostel months
   of the pupils in those rooms.
3. **Rooms and beds**: a room gets as many beds as its seater (A, B, C …) unless told otherwise.
   A bed can be blocked (broken, kept for the warden) or removed while it has never been used. A
   room can be under maintenance or closed once nobody holds a bed in it.

## 2. Go-live from Excel (Hostel → Upload)

Download the format: one row per bed — hostel code, block, floor (0 = ground), room no., room
type, bed, and the **admission no.** and **from date** of the pupil on it (empty for an empty bed).
Blocks, rooms and beds that do not exist are made. Upload with **Check** first: nothing is kept and
each problem is listed by its row. Then **Apply**: good rows are kept, rows in error are left out.

Until a hosteller has a bed they are listed under **Hostellers with no bed** (Allot page).

## 3. Allot, transfer, vacate (Hostel → Allot beds)

Find the pupil by name or admission no. (or click a free bed on the Occupancy board first).

- **Allot**: a free bed and the date. Only hostels for the pupil's gender are offered (fix the gender
  in the student record if it is wrong). The pupil becomes a hosteller from that **month**.
- **Move to another bed** from a date: the old stay ends the day before. Hostel months from the move's
  month are charged by the new room type; earlier months keep the old room type. Months already paid
  are left as they are and named in the message, so the fee desk can settle any difference.
- **End the stay**: last day in the hostel; the hostel fee is charged up to that month.

Every stay is kept: **Register** lists them by hostel, dates, staying now or ended.

## 4. Occupancy (Hostel → Occupancy)

A hostel on a day: beds, taken (with %), free and blocked; the same by room type; and every room by
block and floor with its beds — green free (click to allot), blue taken (click the pupil), grey blocked.
The pupil's **Fees** tab also shows the bed (_Hostel bed_).

## 5. Roll-call (staff app → Hostel desk; admin: Hostel → Roll-call)

Set-up → **Roll-call and leave rules**: each hostel's sessions (for example Morning 06:30, Night 21:30).
The warden opens the session in the staff app: everyone holding a bed is listed **present**; tick the
absent and the sick bay, add a note, **Save the roll**. Pupils out on hostel leave (checked out at the
gate, not back yet) are marked **on leave** by the system. A new absence goes to the head warden
and, when the rule is on, to the parent (once per roll). The roll can be corrected and saved again.
Hostel → Roll-call lists every roll of a period with the absentees, and the sessions not taken today.

**Register** (Hostel → Roll-call → Register): one hostel, one month. The boarders down; each day has a
column per session (M morning, N night ... in the order of the day) with **P** present, **A** absent,
**LV** on leave, **S** sick, **–** not marked, blank when the pupil had no bed in that hostel that day.
Each pupil's P / A / LV / S and the present per cent (leave is left out), and a "Present" line per
roll. **Excel** and **PDF** at the top. A warden sees their own hostel only.

## 6. Hostel leave and outings (parent portal, staff app, gate)

|            | Home leave                                                                                                                                 | Outing                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Who asks   | Parent: Gate passes → Request → _Home leave (hostel)_                                                                                      | Parent: _Outing (hostel)_                         |
| When back  | the day and time given                                                                                                                     | the same day, by the school's latest time (rules) |
| Collected  | by the father, mother, guardian on record or someone named (one-time code to the parent)                                                   | goes alone                                        |
| Approves   | the levels set for home leave (to begin with: any warden of the pupil's hostel; staff app → Gate passes)                                   | the levels set for outings                        |
| Leaves     | warden **hands over** (staff app → Hostel desk → Hand over: live photo; code and remark for someone not on record), then the gate lets out | straight to the gate                              |
| Comes back | the gate marks **back in**; minutes late are kept                                                                                          | the same                                          |

**Who approves** is set under Hostel → Set-up → **Leave approval** (the same levels show under Gate
passes → Set-up), separately for home leave and outings, like pupil passes: one after another or any
N at once, a level may be **Must approve**. Who approves a level: any warden of the pupil's hostel,
its head warden, the class teacher, everyone with a role or a designation, or one employee. For
example home leave: Warden → Head warden; outings: Warden alone. Leave already asked keeps its levels.

Only boarders (holding a bed on the day) can ask. A pupil not back by the return time plus the grace:
the parent and the head warden are told once (workers, every 10 minutes); past the hours set the
principal and school admins too. Hostel → **Leave and outings** shows away now, overdue, to hand over,
waiting, all. SMS / WhatsApp go out when the templates `hostel_absent`, `hostel_absent_warden`,
`hostel_leave_overdue`, `hostel_leave_overdue_staff` (and the gate pass ones) are ready under
Communication → Templates.

## 7. Approved visitors and hostel visits

- **The list**: parents and guardians on the school record are approved by themselves. A parent adds
  other people in the portal (Hostel → Add a visitor: name, relation, mobile, a small photo); a warden of
  the pupil's hostel approves or rejects it (staff app → Hostel desk, or Hostel → Visitors → Visitors to
  approve). The office adds people directly (Hostel → Visitors → Approved lists), approved at once.
- **Visiting hours**: Set-up → Roll-call and leave rules → Visiting hours, one slot a day per hostel. No
  slots at all = visits any time.
- **At the gate** — one visitor register for the school: Visitors → Register a visitor → **Hostel visit
  (boarder)** (Gate / Security and Front Desk). Find the boarder, see the approved list and whether visiting
  hours are on, enter the visitor (name, mobile, relation, a live photo). On the list and in hours → let
  in, the parent is told. Otherwise the visitor **waits**: the wardens get a message and allow or refuse
  (staff app, or Hostel → Visitors → Waiting at the gate); the parent is told either way. In the visitor
  register the visit shows as _Hostel visitor_ with the boarder's hostel; while it waits it reads
  "Waiting for the warden" and the gate cannot let it in there. It leaves through the same Exit step as
  every visitor. Hostel → Visitors keeps the warden's work and links to the register.

## 8. Mess (Hostel → Mess)

| Tab                    | What it does                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **This week**          | The week of a hostel (its week of the menu cycle) with any **change for a day** (a festival lunch; empty = back to the cycle's menu). **Excel / PDF** of the week for the notice board.                                                                                                                                                                                      |
| **Menu cycle**         | The menu repeats every **1, 2, 3 or 4 weeks** from a Monday. Edit each week of the cycle; **copy a day** to other days (any week); **copy a week** to other weeks; **copy to other hostels** (replace their menu, or fill only empty meals).                                                                                                                                 |
| **Meal attendance**    | Pick the day and meal; everyone holding a bed had it — tick who **skipped** and why. Pupils out on hostel leave at the meal's time are left out by themselves. (Also in the staff app.)                                                                                                                                                                                      |
| **Meal register**      | The month of a hostel: each pupil, each meal of each day — **P** had, **X** skipped, **LV** away, **–** not marked. Totals; Excel / PDF.                                                                                                                                                                                                                                     |
| **Kitchen head count** | For a day: each hostel's meals with **how many to cook**, split by diet, no onion-garlic and allergies; pupils away (or with approved home leave due to go) are left out. Excel / PDF for the cook.                                                                                                                                                                          |
| **Diet list**          | Every boarder's diet (the school's default when none is set), no onion-garlic, allergies and the allergy on the student record. Filter by hostel, diet, allergy, set / default, pupil; pages; **Edit**, **Back to default**; **Excel upload** (download the format with the boarders, change, upload — every row is checked and nothing is saved on a mistake); Excel / PDF. |
| **Feedback**           | Parents rate the meals of the last three days in the portal (1–5 with a comment, up to a week later). Each meal's average and spread, and the comments.                                                                                                                                                                                                                      |
| **Set-up**             | **Meals** of the school (name, time, order) ticked for the hostels that serve them; a hostel may keep its own time. Delete only a meal never served — else switch it off. **Diet types** (one default) and **allergies** of the school.                                                                                                                                      |

Messages (SMS / WhatsApp when ready under Communication → Templates): `hostel_visit_waiting` to the
wardens, `hostel_visit_parent` to the parent.

## 9. Complaints (Hostel → Complaints; Helpdesk → Hostel complaints)

Room and maintenance complaints are a **fourth helpdesk desk**. Heads (Helpdesk set-up → Hostel
complaints): Electrical, Plumbing and water, Furniture, Cleaning, Mess and food, Other — owned by the
**warden** role (the complaint goes to the **head warden of that hostel**) or a named employee, with SLA
hours and the escalation matrix like every desk. Parents raise them on the portal's Hostel page about
the child's room; wardens and the office raise them for a room (Hostel → Complaints, or the staff app).
The warden answers and closes from the staff app (Hostel desk → Open complaints → Answer, the Queries
screen). Numbers start with `H/`.

## 10. Incidents and the sick bay

- **Incidents** (Hostel → Incidents; staff app → roll-call → Incident): kind (discipline, health, safety,
  property, other), minor or serious, what happened, action taken. Tick **tell the parent** to send it
  and show it on the portal's Hostel page ("From the hostel"). A **serious** incident also goes to the
  principal and the school admins.
- **Sick bay** (staff app → roll-call → Sick bay): complaint, temperature, treatment, outcome. It is
  saved as a **clinic visit** of the pupil (marked "Hostel sick bay"), so it is in the clinic record and
  the family is told by the clinic's own rule.

## 11. Dashboard (Hostel → Dashboard)

Boarders and beds, away and overdue, absent at roll-call today, visitors waiting, open and late
complaints, the hostel fee due now; each hostel today (roll-calls taken, meals marked, visits,
visitors to approve, complaints); the last 7 / 30 / 90 days (absences, late returns, leave, visits,
complaints, meals skipped, incidents); and the hostel fee of the session per hostel for today's
boarders (fee, paid, due now, % collected).

## Hostel withdrawal (a pupil leaves the hostel, stays in school)

- **Who starts it:**
  - the **Hostel Clerk** (a new role, given under Access);
  - the warden of the pupil's hostel;
  - the office.
- **Who may start, and who approves level by level:** set on **Fee setup → Approval levels →
  Hostel withdrawal**.
- **To start:** Hostel → Withdrawals → New withdrawal. Find the boarder, then give:
  - the request date and the last day in the hostel;
  - the reason;
  - the **damages** and **mess dues** found;
  - the parent's letter.
- **Approving:**
  - Each level approves or does not approve (with a note), on the withdrawal page or in Approvals.
  - The **last level chooses**: carry forward the hostel fee paid for later months (it stays as
    advance on the hostel receipt) or refund it.
- **On the last approval:**
  - the bed is free from the leaving date;
  - the hostel fee runs to the leaving month (one more month if the notice was shorter than the
    school's notice period);
  - damages and mess dues become misc fees;
  - the parent is told.
- **Hostel → Withdrawals → Steps and notice:**
  - the notice period;
  - the hostel steps (Warden, Mess) used when a hosteller **leaves the school** (People →
    Withdrawals).

## Reports with the parents (Excel / PDF)

- **The four reports:**
  - **Allotment register:** Hostel → Register.
  - **Occupancy:** Hostel → Occupancy → _List with parents_.
  - **Withdrawals:** Hostel → Withdrawals.
  - **Leave and outings:** Hostel → Leave and outings → _Register with parents_.
- **Contact columns on each:** father, mother and guardian (name, mobile, email, and the guardian's
  relation), and the address. The pupil's address is used, or the main guardian's if the pupil has
  none.
- **Columns:**
  - Untick what you do not need, then **Save for me**.
  - The hostel office (set-up right) can **Save as the school default**.
  - **Back to the school default** drops your own choice.
  - Excel and PDF carry exactly the columns on the screen.
