# 25 · Hostel module

The hostel fee already exists: hostel ledger, hosteller flag, stay period (`hostel_from` / `hostel_to`),
hostel calendar, bills, receipts and online payment. This module adds the boarding house around it,
benchmarked on Fedena, Entab, Edunext and MyClassboard, and on the legacy PHP `Admin/hostel` (hostel
setup, rooms by seater, booking, complaints, feedback).

## Decisions (product owner, 2026-10-15)

| Topic | Decision |
| --- | --- |
| Scope | Rooms and allotment, roll-call, leave / out-pass, visitors, mess, complaints and incidents |
| Users | Office (admin app), **Warden** (staff app, scoped to their hostels), parents (portal), gate / security |
| Room and fee | Room type picks a **hostel fee group**, separate from the school fee group. A transfer re-bills unpaid hostel months from the transfer month |
| Out-pass | A "hostel leave" kind of the existing **gate pass**. Parent asks in the portal (OTP), warden approves, gate checks out and in, parent alerted, late return flagged |
| Visitors | Existing visitor register plus an **approved-visitor list** per pupil |
| Sick bay | Goes to the existing **clinic** record |
| Go-live | Rooms, beds and allotments from Excel; a "hosteller, no bed" list until allotted |
| Mess | Weekly menu (parents see it), meal attendance, diet and allergy flags from the health record; no mess billing |

## Phases

### H1 · Set-up and allotment (first release) — built 2026-10-15 (migrations 0146, 0147)

- **Masters**: hostels (boys / girls / mixed, address, contact, warden(s)), blocks, floors, room
  types (name, seater, AC, **hostel fee group**), rooms (block, floor, type, beds, status) and beds
  (label, status: free / taken / blocked).
- **Allotment**: allot a bed (from date), **transfer** (bed, room or hostel, on a date) and **vacate**
  (on a date, reason). Full history per pupil. One open allotment per pupil, one pupil per bed.
- **Fee sync**: allotting sets the fee profile's `hosteller`, `hostel_from` (month of the from date),
  and, on vacate, `hostel_to`. Demand is regenerated, so
  unpaid hostel months follow the new group from the transfer month; paid months stay as paid.
  - Engine: `app.hostel_fee_group_on(student, month, default)` gives each month's hostel fee group:
    the room type's group of the stay touching that month, else the default
    (`student_fee_profiles.hostel_fee_group`, set by hand, else the school fee group).
    `app.generate_fee_demand` takes school heads by the school fee group and hostel heads by the group
    of each month, so today's set-up (no room types) charges exactly as before.
- **Occupancy board**: hostel → block → floor → rooms, with beds coloured free / taken / blocked;
  click a bed to allot, transfer or vacate. Counts: capacity, taken, free, by hostel and room type.
- **Hosteller, no bed**: pupils with the hosteller flag and no open allotment.
- **Excel**: upload rooms and beds; upload allotments (admission no, hostel, room, bed, from date).
  Dry run first, then apply, as the other uploads.
- **Wardens**: staff assigned to hostels; a **Warden** role whose rights are limited to their hostels.
- **Reports**: occupancy, allotment register (from / to dates), vacancy by room type.
- **Pupil profile**: a Hostel card (hostel, room, bed, since, warden).
- **Permissions**: `hostel.setup.manage`, `hostel.allot.manage`, `hostel.room.view`.

### H2 · Roll-call and leave

- **Roll-call**: sessions per hostel (for example morning, night), one tick per bed; pupils on
  approved leave are marked so on their own. Absent without leave alerts the warden and the parent.
- **Hostel leave**: a new gate pass kind `hostel_leave` (from and to date and time, escort, reason).
  The parent asks in the portal and confirms with an OTP. The warden approves or refuses in the staff
  app. The gate screen checks the pupil out and in, and the parent gets WhatsApp or SMS at each step.
  A pupil who is not back by the end time is flagged late.

### H3 · Visitors and mess

- **Approved visitors** per pupil (name, relation, mobile, photo), kept by office and parents. The
  visitor register warns when a visitor is not on the list.
- **Mess**: weekly menu by meal (shown in the parent portal), meal attendance (tick absentees), and a
  special diet list built from the health record's allergies plus diets added in the hostel.

### H4 · Complaints, incidents and the parent view

- **Complaints**: room or maintenance complaints (category, room, photo), assigned, then in progress,
  then closed, with history, as in the legacy module. Raised by the warden, the parent or the pupil.
- **Incidents**: discipline and incident register (pupil, date, what happened, action, parent informed).
- **Sick bay**: the warden adds a clinic visit to the clinic record.
- **Parent portal Hostel page**: room and warden contact, roll-call and leave history, apply for
  leave, approved visitors, mess menu, complaints.
- **Dashboard**: occupancy, out today, absent at roll-call, open complaints.

## Data (H1)

```
hostels(id, school_id, name, code, gender: boys|girls|mixed, address, phone, status)
hostel_blocks(id, hostel_id, name, floors)
hostel_room_types(id, school_id, name, seater, ac, fee_group, status)
hostel_rooms(id, hostel_id, block_id, floor, room_no, room_type_id, status: active|maintenance|closed)
hostel_beds(id, room_id, label, status: active|blocked)
hostel_wardens(hostel_id, staff_user_id, from, to)
hostel_allotments(id, student_id, academic_year_id, bed_id, from_date, to_date, reason, by, ...)
   -- exclusion: one open row per bed and one per student (daterange overlap)
student_fee_profiles.hostel_fee_group
```

All tables are school-scoped and use RLS, like the rest. The fee sync runs inside the allotment
transaction: profile update, then `app.generate_fee_demand`.
