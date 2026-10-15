# Hostel (October 2026)

The **Hostel** menu keeps the boarding house: hostels, rooms and beds, who holds which bed, and the
wardens. The hostel **fee** stays in Fees (hostel ledger, hostel calendar, hostel bill and receipts);
an allotment here keeps it in step by itself. Plan and later phases: `docs/design/25-hostel-module.md`.

| Who | Rights |
|---|---|
| School admin | everything (*hostel.setup.manage*, *hostel.allot.manage*, *hostel.room.view*) |
| Hostel office | give the role with *hostel.allot.manage* and *hostel.room.view* |
| **Warden** (new role) | sees only the hostels they are a warden of; allots nothing |
| Accountant | sees the hostels and who stays where |

## 1. Set-up (Hostel → Set-up)

1. **Hostels and wardens**: name, code (for example BH), for boys, girls or both, phone, address.
   Blocks with their number of floors. Wardens are staff: tick the head warden. Give each warden
   the **Warden** role (Access → Users).
2. **Room types and fee**: name, beds (seater), AC, and the **hostel fee group**. The fee group is
   a fee group of *Fee setup → Fee structures* that holds the hostel heads for that kind of room
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
The pupil's **Fees** tab also shows the bed (*Hostel bed*).

## 5. Roll-call (staff app → Hostel desk; admin: Hostel → Roll-call)

Set-up → **Roll-call and leave rules**: each hostel's sessions (for example Morning 06:30, Night 21:30).
The warden opens the session in the staff app: everyone holding a bed is listed **present**; tick the
absent and the sick bay, add a note, **Save the roll**. Pupils out on hostel leave (checked out at the
gate, not back yet) are marked **on leave** by the system. A new absence goes to the head warden
and, when the rule is on, to the parent (once per roll). The roll can be corrected and saved again.
Hostel → Roll-call lists every roll of a period with the absentees, and the sessions not taken today.

## 6. Hostel leave and outings (parent portal, staff app, gate)

| | Home leave | Outing |
|---|---|---|
| Who asks | Parent: Gate passes → Request → *Home leave (hostel)* | Parent: *Outing (hostel)* |
| When back | the day and time given | the same day, by the school's latest time (rules) |
| Collected | by the father, mother, guardian on record or someone named (one-time code to the parent) | goes alone |
| Approves | a warden of the pupil's hostel (staff app → Gate passes) | the same |
| Leaves | warden **hands over** (staff app → Hostel desk → Hand over: live photo; code and remark for someone not on record), then the gate lets out | straight to the gate |
| Comes back | the gate marks **back in**; minutes late are kept | the same |

Only boarders (holding a bed on the day) can ask. A pupil not back by the return time plus the grace:
the parent and the head warden are told once (workers, every 10 minutes); past the hours set the
principal and school admins too. Hostel → **Leave and outings** shows away now, overdue, to hand over,
waiting, all. SMS / WhatsApp go out when the templates `hostel_absent`, `hostel_absent_warden`,
`hostel_leave_overdue`, `hostel_leave_overdue_staff` (and the gate pass ones) are ready under
Communication → Templates.
