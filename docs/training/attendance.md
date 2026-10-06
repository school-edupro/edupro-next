# Attendance: a guide for teachers and the office

## Who does what

| Person        | Does                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Class teacher | Marks the day for the section (teacher app), fixes a mark the same day, applies leave decisions  |
| Coordinator   | Attendance rules per class (late cut-off, half-day), locks, per-pupil rules (medical, transport) |
| Office        | Devices (RFID gates, bus readers, biometric), device keys, alert throttles, the daily summary    |
| Families      | See attendance in the parent app; receive absence alerts; apply for leave                        |

## Daily routine

1. Gates and bus readers mark pupils as they tap; the class teacher opens **Attendance** in the teacher
   app, sees the taps, marks the rest (present, absent, late, sick room, on duty, stay back) and
   submits. Codes follow the school's list; weekly-off and holidays are refused.
2. Absence alerts go to the family once per day at the alert time; the throttle prevents repeats.
3. A pupil arriving after the cut-off is late; a leave request approved by the class teacher marks the
   days as leave.
4. The session locks at the end of the day; a change afterwards needs the coordinator to unlock it (with
   a reason).

## Periodic routine

- **Attendance → Dashboard**: per section and per day; chronic absentees; device health.
- Month-end: export the register per section (Excel or PDF) for the file.
- Devices: a new gate or bus reader gets its own key from **Attendance → Devices**; revoke lost ones.

## Five common questions

1. _A pupil tapped but shows absent._ The tap may be outside the session window or from a device
   assigned to another route; check **Attendance → Devices → Events** for the tag.
2. _Two alerts went to one family._ Siblings each get their alert; the same pupil never twice in a day.
3. _The teacher marked the wrong pupil._ Fix it before the lock; afterwards ask the coordinator.
4. _A pupil on medical leave for a month._ Set a per-pupil rule (medical) so no alerts go out and the
   days count as leave.
5. _A family disputes an absence._ The pupil's attendance history shows the source of each mark (teacher,
   gate, bus, biometric) with the time.

## Attendance, completed (October 2026)

- **Set-up (coordinator or admin).** Attendance → Set-up: the **marking windows** for class attendance,
  the bus morning trip and the bus afternoon trip (blank = any time), how many days back a teacher may
  still mark, and the **teacher of each bus route** for the morning and the afternoon trip. The class
  teacher of each class is mapped under Academics → Teacher assignments; the page lists classes without one.
- **Leave and gate passes show by themselves.** An approved leave pre-fills the pupil as **LV (leave)**
  in class and on the bus. A gate pass to leave early pre-fills _short leave_ in class and _gate pass_
  on the afternoon bus; a late-arrival pass pre-fills _late_ in class and _gate pass_ on the morning
  bus. The teacher sees the tag and can change the mark if the child did come.
- **Bus attendance.** Teacher app → Bus attendance: choose the route and trip, the list is the route's
  approved riders in stop order; mark P on the bus, A not on the bus, LV leave, GP gate pass, OT other
  arrangement. The list also shows today's class attendance and the bus card reader time when there is one.
- **After the window.** A teacher can read but not mark. The coordinator or admin marks from the ERP
  (flagged _marked late_) or reopens the day for that class or route under Set-up → Reopen a day.
- **Registers.** Attendance → Monthly registers: a class, or a route and trip, for a month with totals;
  Excel and PDF. A teacher downloads the register of their own class or route from the teacher app.
- **Dashboard.** Attendance → Dashboard: in-school percentage, absent, on leave, gate passes, classes and
  bus trips not yet marked (with the teacher's name), both bus trips, and the last 14 days.
- **Families** see class attendance and the bus (morning and afternoon) under Attendance, and today's
  status on the home page.


## Set-up screens (October 2026 update)

- **Bus attendance: teacher of each route** (Attendance → Set-up). Select the employee, select one or many routes, choose the trip (**Both**, Morning only, Afternoon only) and Submit. A route may have more than one teacher. The same from Excel: *Download the format* (Employee, Route and Trip are drop-downs), fill, *Upload*. An upload only adds; remove from the list.
- **Bus attendance page** (admin and teacher app): choose *Route and trip* and the *Date* (today by default), then Show; the list is the route's students for that trip. A route teacher sees only the routes mapped to them, in the admin portal too.
- **Teacher assignments** (Academics). Select employee, teacher type, one or many classes and one or many subjects, then Submit: every class is saved with every subject. For a class teacher, tick **Actual class teacher**; untick it for a co-class teacher (a section has one actual class teacher, whose name prints on the register and shows to parents; a co-class teacher can also mark the class). Excel format with drop-downs is on the same card.
