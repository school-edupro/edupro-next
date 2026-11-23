# Transport — data guide

> From the live schema (23 Nov 2026, migrations to 0417), the migrations and the API code. Structure only.

## What it records

A school keeps its fleet (vehicles, types, vendors, crew), its **stoppages** (places, each in a fee slab) and its
**routes** with ordered **stops**; a vehicle and crew run a route for a span of dates, and a stand-in bus can replace
one. A family or the office makes a **request** (join, change, leave) that passes approval levels; the last approval
writes a **transport period** (`student_transport`: way, stops, months, monthly amount), updates the transport fee
and maps the pupil to the bus. On the road: RFID taps on bus readers, the teacher's bus roll per trip, GPS positions
and a daily vehicle log. Gate RFID readers (school attendance) share the device tables.

## Tables

| Table                         | One row is                                                   | Key columns                                                                                                                                                                                                                                            | For reports                      |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `student_transport`           | one stretch of months a pupil rides one way                  | `student_id`, `academic_year_id`, `service` pick/drop/both, `pick_route_id`, `pick_stop_id`, `drop_route_id`, `drop_stop_id`, `slab_id`, `monthly_amount`, `from_month`, `to_month`, `status` active/ended/cancelled, `request_id`, `ended_by_request` | **main (spine, the history)**    |
| `student_route_assignments`   | the pupil's bus mapping valid now (one per pupil and year)   | `student_id` + `academic_year_id` (unique), `route_id`, `stop_id`, `stop_name`, `service`, `drop_route_id`, `drop_stop_id`, `pickup_time`, `drop_time`, `valid_from`, `valid_to`                                                                       | main (current snapshot, derived) |
| `transport_requests`          | a family's or the office's request to join, change or leave  | `number` (TR-YYMM-nnnn), `student_id`, `academic_year_id`, `kind` join/change/leave, `source` parent/office, `status` workflow_status, `service`, `pick_*`/`drop_*`, `slab_id`, `monthly_amount`, `from_month`, `to_month`                             | main                             |
| `transport_request_approvals` | one approval level of a request                              | `request_id` + `seq` (unique), `label`, `approver_user_ids` bigint[], `status` waiting/pending/approved/rejected/skipped, `acted_by`, `acted_at`                                                                                                       | history                          |
| `transport_approval_levels`   | the school's approval levels, per source                     | `source` parent/office, `seq`, `label`, `kind` role/designation/employee/route_incharge, `role_code`, `designation`, `employee_id`, `active`                                                                                                           | master                           |
| `transport_routes`            | a route                                                      | `code`, `name`, `status`, `deleted_at`, `late_after`, `alert_boarding`, `alert_alighting`; cached today's `vehicle_id`, `driver_id`, `vehicle_no`, `driver_name`, `driver_mobile`, `conductor_name`, `conductor_mobile`                                | master                           |
| `transport_stops`             | a stoppage on a route, in order                              | `route_id` + `sequence` (unique), `stoppage_id`, `name`, `pickup_time`, `drop_time`, `slab_id`, `lat`, `lng` (name / slab / place copied from the stoppage)                                                                                            | master                           |
| `transport_stoppages`         | a place pupils are picked from                               | `code` (unique per school), `name`, `area`, `slab_id`, `lat`, `lng`, `radial_km`, `route_km`, `status`                                                                                                                                                 | master                           |
| `transport_slabs`             | a fee slab of a year (distance band and monthly amount)      | `academic_year_id` + `code` (unique), `name`, `distance_from_km`, `distance_to_km`, `monthly_amount`                                                                                                                                                   | master (fee set-up)              |
| `transport_settings`          | the school's transport rules (one row)                       | PK `school_id`; `one_way_percent`, `two_stop_rule` higher/pick/sum, `parent_can_apply`, `notify_email`                                                                                                                                                 | internal (settings)              |
| `transport_vehicles`          | a vehicle                                                    | `reg_no`, `name`, `vehicle_type_id`, `vendor_id`, `capacity`, `insurance_expiry`, `fitness_expiry`, `permit_expiry`, `puc_expiry`, `gps_device_id`, `incharge_id`, `status`, `deleted_at`                                                              | master                           |
| `transport_vehicle_types`     | a type of vehicle (bus, van…)                                | `code`, `name`, `seats`                                                                                                                                                                                                                                | master                           |
| `transport_vendors`           | a fleet / crew contractor                                    | `code`, `name`, contact columns, `gst_no`                                                                                                                                                                                                              | master                           |
| `transport_drivers`           | a crew member (driver, conductor or attendant)               | `code`, `role` driver/conductor/attendant, `name`, `mobile`, `licence_no`, `licence_expiry`, `employee_id`, `vendor_id`, `police_verified`, `status`, `deleted_at`                                                                                     | master                           |
| `transport_route_vehicles`    | which vehicle and crew run a route, for which trip and dates | `route_id`, `vehicle_id`, `shift` both/pick/drop (unique set), `driver_id`, `conductor_id`, `attendant_id`, `from_date`, `to_date`, `status`                                                                                                           | master (with dates)              |
| `transport_replacements`      | a stand-in vehicle for some days                             | `number`, `vehicle_id`, `replacement_vehicle_id`, crew ids, `from_date`, `to_date`, `reason`, `status` active/cancelled                                                                                                                                | main                             |
| `transport_incharges`         | an employee in charge of transport (or of one route)         | `employee_id`, `route_id` (NULL = the whole school)                                                                                                                                                                                                    | master                           |
| `transport_route_teachers`    | a teacher who marks the bus roll of a route and trip         | `route_id`, `trip` pick/drop, `employee_id` (unique set)                                                                                                                                                                                               | master                           |
| `bus_roll_sessions`           | one bus roll: a route, a day, a trip                         | `route_id` + `on_date` + `trip` (unique), `academic_year_id`, `marked_by`, `marked_at`, `marked_late`                                                                                                                                                  | main                             |
| `bus_roll_marks`              | one pupil's mark in a bus roll                               | `session_id` + `student_id` (unique), `code` P/A/LV/GP/OT, `remarks`                                                                                                                                                                                   | detail                           |
| `bus_attendance`              | one RFID tap on a bus reader                                 | `device_id`, `route_id`, `student_id`, `tag`, `on_date`, `direction` in/out, `occurred_at`, `outcome`, `lat`, `lng`, `alert_sent_at`                                                                                                                   | main (event log)                 |
| `rfid_devices`                | an RFID / biometric reader                                   | `code` (unique per school), `name`, `kind` gate/bus/biometric, `route_id` (bus readers), `direction`, `campus_id`, `last_seen_at`, `status`, `api_key_hash`                                                                                            | master                           |
| `rfid_events`                 | one RFID tap on a **gate** reader (school attendance)        | `device_id`, `tag`, `student_id`, `occurred_at`, `direction`, `outcome`                                                                                                                                                                                | main (event log)                 |
| `transport_vehicle_logs`      | a vehicle's day: km, fuel, trips                             | `vehicle_id` + `log_date` (unique), `route_id`, `driver_id`, `odometer_start`, `odometer_end`, `fuel_litres`, `fuel_cost`, `trips`, `incident`                                                                                                         | main                             |
| `vehicle_positions`           | one GPS fix of a vehicle                                     | `vehicle_id`, `recorded_at`, `lat`, `lng`, `speed_kmh`, `heading`, `ignition`, `source`                                                                                                                                                                | history (kept 30 days)           |

25 tables.

## How the tables join

**Spine: `student_transport`** (who rides when). For "on the bus today" lists the app reads
`student_route_assignments`.

Riders:

- `student_transport.student_id → students.id`; `academic_year_id → academic_years.id`
- `student_transport.pick_route_id / drop_route_id → transport_routes.id`
- `student_transport.pick_stop_id / drop_stop_id → transport_stops.id`
- `student_transport.slab_id → transport_slabs.id`
- `student_transport.request_id → transport_requests.id` (the request that made it);
  `ended_by_request → transport_requests.id` (the one that cut it short)
- `student_route_assignments.student_id → students.id`; `route_id → transport_routes.id` (the pick route, or the
  drop route for drop-only); `stop_id → transport_stops.id`; `drop_route_id`, `drop_stop_id` likewise
- class: `students.id → enrolments.student_id` (same year, `status = 'active'`) `→ class_sections → classes`
- guardians: `students.id → student_guardians.student_id → guardians.id`

Requests and approvals:

- `transport_requests.student_id → students.id`; `academic_year_id → academic_years.id`
- `transport_requests.pick_route_id / drop_route_id / route_id → transport_routes.id`;
  `pick_stop_id / drop_stop_id / stop_id → transport_stops.id`; `slab_id → transport_slabs.id`
- `transport_request_approvals.request_id → transport_requests.id`; `approver_user_ids` / `acted_by → users.id`
- `transport_requests.workflow_instance_id → workflow_instances.id` (old requests only, see Traps)
- `transport_approval_levels.employee_id → employees.id`

Routes, stops and fleet:

- `transport_stops.route_id → transport_routes.id`; `transport_stops.stoppage_id → transport_stoppages.id`
- `transport_stops.slab_id / transport_stoppages.slab_id → transport_slabs.id`
- `transport_route_vehicles.route_id → transport_routes.id`; `vehicle_id → transport_vehicles.id`;
  `driver_id / conductor_id / attendant_id → transport_drivers.id`
- `transport_routes.vehicle_id → transport_vehicles.id`; `transport_routes.driver_id → transport_drivers.id` (cached)
- `transport_vehicles.vehicle_type_id → transport_vehicle_types.id`; `vendor_id → transport_vendors.id`;
  `incharge_id → employees.id`
- `transport_drivers.vendor_id → transport_vendors.id`; `transport_drivers.employee_id → employees.id`
- `transport_replacements.vehicle_id / replacement_vehicle_id → transport_vehicles.id`; crew ids → `transport_drivers.id`
- `transport_incharges.route_id → transport_routes.id`; `employee_id → employees.id`
- `transport_route_teachers.route_id → transport_routes.id`; `employee_id → employees.id`

On the road:

- `bus_roll_sessions.route_id → transport_routes.id`; `academic_year_id → academic_years.id`
- `bus_roll_marks.session_id → bus_roll_sessions.id`; `student_id → students.id`
- `bus_attendance.device_id → rfid_devices.id`; `route_id → transport_routes.id`; `student_id → students.id`
- `rfid_events.device_id → rfid_devices.id`; `student_id → students.id`
- `rfid_devices.route_id → transport_routes.id`; `campus_id → campuses.id`; also `punch_logs.device_id → rfid_devices.id`
  (staff biometric punches, HR module)
- tags: `students.rfid_tag = bus_attendance.tag = rfid_events.tag` (text)
- `transport_vehicle_logs.vehicle_id → transport_vehicles.id`; `route_id → transport_routes.id`;
  `driver_id → transport_drivers.id`
- `vehicle_positions.vehicle_id → transport_vehicles.id` (the feed matches `transport_vehicles.gps_device_id`)
- `attendance_reopens.route_id → transport_routes.id` (a bus-roll day reopened for the teacher, attendance module)

Transport fee (fees module):

- `fee_demands.head_id → fee_heads.id` with `fee_heads.kind = 'transport'`; `fee_demands.period_id → fee_periods.id`
  (`year`, `month`, `transport_charged`); match a line to its route through `student_transport` covering
  `make_date(fp.year, fp.month, 1)`.
- `student_fee_profiles.transport_slab_id → transport_slabs.id`, `transport_disabled`.

## Life-cycles and statuses

**Transport period** (`student_transport.status`):

- `active`: runs, or will run, from `from_month` to `to_month` (first days of months).
- `ended`: cut short by a later request (change or leave) or a direct change; `to_month` was moved back to the month
  before the change. **It still covers its months up to `to_month`.**
- `cancelled`: replaced before it began (never ran).
- Riding in month M = `status IN ('active', 'ended') AND M BETWEEN from_month AND to_month`. If two rows match,
  the highest `id` wins (as the fee generator does).
- A leave request ends the open period and adds none. A change ends it and adds a new period from the change month.
- Pupils mapped before transport v2 (or mapped directly on the route page) got a period for the whole session at the
  slab charged then (0078 back-fill).

**Bus mapping** (`student_route_assignments`): a copy of the period covering the current month, written by
`app.transport_sync` on each approval and by `app.transport_tick` when transport pages are opened; the row is
deleted when no period covers the month. `valid_from` / `valid_to` = the period's first and last day. It has no
history: it is the "current" view only.

**Request** `status` (enum workflow_status): pending (one per pupil and year), approved, rejected, cancelled (the
family took it back). `kind` (enum transport_request_kind): join, change, leave. `source`: parent or office (each
has its own approval levels).

**Approval level** `status`: waiting (not reached yet), pending (the current level; its `approver_user_ids` may act),
approved, rejected, skipped (not needed or the request was cancelled). Levels are copied from
`transport_approval_levels` when the request is made; the request is decided when the last level approves or any
level rejects.

**Route-vehicle mapping:** valid on day D when `status = 'active' AND (from_date IS NULL OR from_date <= D) AND
(to_date IS NULL OR to_date >= D)`; for a route the row with `shift = 'both'`, then `pick`, then the newest wins.
`app.transport_routes_sync` copies the winner into `transport_routes.vehicle_id`, `driver_*`, `conductor_*`.

**Replacement** `status`: active, cancelled. In force on D when active and D between `from_date` and `to_date`;
`app.transport_vehicle_today(vehicle)` returns the stand-in. `notified` / `notified_at` / `back_notified_at` track
the messages to parents.

**Bus roll mark** `code`: P on the bus, A not on the bus, LV on approved leave, GP gate pass (left early / comes
late), OT other arrangement (parent brings or collects). One roll per route, day and trip (`pick` morning, `drop`
afternoon); `marked_late` = marked after the school's window.

**Bus tap** `bus_attendance.outcome`: boarded, late_boarding (boarded after the route's `late_after`), alighted,
duplicate (same pupil and direction within 60 seconds), unknown_tag (no active pupil with that tag). Count real
taps with `outcome IN ('boarded', 'late_boarding', 'alighted')`. `direction`: in = boarded, out = alighted.

**Gate tap** `rfid_events.outcome`: marked_present, marked_late, out_recorded (the day's attendance was written),
duplicate, unknown_tag, no_enrolment, holiday, locked (the day's register was locked), manual_kept (a manual mark
was already there and stays), ignored.

**Masters** (`transport_routes`, `transport_vehicles`, `transport_drivers`, `transport_stoppages`, types, vendors,
`rfid_devices`) use `status` row_status; routes, vehicles and drivers are also soft-deleted (`deleted_at`).

## Amounts, dates and counting rules

- **`student_transport.monthly_amount`** is the monthly charge before any discount: from the stop's slab, at
  `transport_settings.one_way_percent` for pick-only or drop-only, and by `two_stop_rule` when pick and drop
  stops differ (higher slab / pick slab / both one-way charges added). It is fixed when approved.
- **What is billed** is `fee_demands` on the transport head (`fee_heads.kind = 'transport'`, ledger school):
  only in months the school ticked (`fee_periods.transport_charged`), only when the fee profile has a
  `transport_slab_id` and `transport_disabled` is false, after discounts, and a pupil on a discount may get no
  transport line (setting `fees.transport_for_discounted`). Count demand rows with
  `status IN ('pending', 'partial', 'paid')`. For billed and collected, use `fee_demands` (or `mart.fee_forecast`
  for class totals); `student_transport.monthly_amount` is the expected rate.
- **`transport_requests.monthly_amount`** is the quote at the time of the request; the approved figure is on the
  period it made.
- **Vehicle logs:** kilometres = `odometer_end − odometer_start` (either may be NULL); `fuel_cost` in rupees.
- **Months vs days:** periods and requests are by month (`from_month`, `to_month` are first days). Bus rolls and
  bus taps are by day (`on_date`, already India date). Gate taps have only `occurred_at`: take
  `(occurred_at AT TIME ZONE 'Asia/Kolkata')::date`. GPS by `recorded_at` (device time).
- **Year:** periods, mappings, requests, bus rolls and slabs carry `academic_year_id`. Routes, stops, stoppages,
  vehicles and crew are the school's, not a year's. Slabs are per year: a stoppage points at one slab row, so
  check `transport_slabs.academic_year_id` when you compare years.
- **One row per:** mapping per pupil and year; period per stretch; open request per pupil and year; bus roll per
  route, day and trip; vehicle log per vehicle and day.
- **Riders per route:** count morning riders by `pick_route_id` (service pick or both) and afternoon riders by
  `drop_route_id` (service drop or both); a pupil may ride two routes.
- **Seats:** `transport_vehicles.capacity` (or `transport_vehicle_types.seats`); the bus of a route on a day comes
  from `transport_route_vehicles` (and a replacement in force).

## Answering report questions

**1. Morning and afternoon riders per route in a month, with the monthly amount.**

```sql
WITH p AS (SELECT DATE '2026-11-01' AS m,
                  (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1) AS yr),
cur AS (
  SELECT DISTINCT ON (t.student_id) t.*
    FROM student_transport t, p
   WHERE t.academic_year_id = p.yr AND t.status IN ('active', 'ended')
     AND p.m BETWEEN t.from_month AND t.to_month
   ORDER BY t.student_id, t.id DESC)
SELECT r.code, r.name,
       count(*) FILTER (WHERE cur.service IN ('pick', 'both') AND cur.pick_route_id = r.id) AS morning_riders,
       count(*) FILTER (WHERE cur.service IN ('drop', 'both') AND cur.drop_route_id = r.id) AS afternoon_riders,
       sum(cur.monthly_amount) FILTER (WHERE COALESCE(cur.pick_route_id, cur.drop_route_id) = r.id) AS monthly_billed
  FROM transport_routes r
  LEFT JOIN cur ON r.id IN (cur.pick_route_id, cur.drop_route_id)
 WHERE r.deleted_at IS NULL
 GROUP BY r.id, r.code, r.name
 ORDER BY r.code
```

Note: works for any month, past or future; `student_route_assignments` only knows the current one.

**2. How full is each bus on the morning trip today?**

```sql
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
     yr AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1),
     bus AS (
  SELECT DISTINCT ON (rv.route_id) rv.route_id, rv.vehicle_id
    FROM transport_route_vehicles rv, today
   WHERE rv.status = 'active' AND (rv.from_date IS NULL OR rv.from_date <= today.d) AND (rv.to_date IS NULL OR rv.to_date >= today.d)
   ORDER BY rv.route_id, (rv.shift = 'both') DESC, (rv.shift = 'pick') DESC, rv.id DESC)
SELECT r.code, v.reg_no, v.capacity,
       count(a.id) FILTER (WHERE COALESCE(a.service, 'both') <> 'drop' AND a.route_id = r.id) AS morning_riders,
       round(100.0 * count(a.id) FILTER (WHERE COALESCE(a.service, 'both') <> 'drop' AND a.route_id = r.id)
             / NULLIF(v.capacity, 0), 1) AS morning_fill_pct
  FROM transport_routes r
  LEFT JOIN bus ON bus.route_id = r.id
  LEFT JOIN transport_vehicles v ON v.id = bus.vehicle_id
  LEFT JOIN student_route_assignments a ON a.academic_year_id = (SELECT id FROM yr) AND a.route_id = r.id
 WHERE r.deleted_at IS NULL AND r.status = 'active'
 GROUP BY r.id, r.code, v.reg_no, v.capacity
 ORDER BY morning_fill_pct DESC NULLS LAST
```

Note: a replacement bus in force today (`transport_replacements`) changes the real capacity.

**3. The route sheet: pupils of each route by stop, with class (crosses into academics).**

```sql
WITH yr AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
SELECT r.code AS route, st.sequence, st.name AS stop, st.pickup_time, a.service,
       s.admission_no, s.display_name, k.name || '-' || cs.name AS class
  FROM student_route_assignments a
  JOIN transport_routes r ON r.id = a.route_id
  LEFT JOIN transport_stops st ON st.id = a.stop_id
  JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL AND s.merged_into_id IS NULL
  LEFT JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = a.academic_year_id AND e.status = 'active'
  LEFT JOIN class_sections cs ON cs.id = e.class_section_id
  LEFT JOIN classes k ON k.id = cs.class_id
 WHERE a.academic_year_id = (SELECT id FROM yr)
 ORDER BY r.code, st.sequence, s.display_name
```

**4. Transport fee billed, collected and due by route this session (crosses into fees).**

```sql
WITH yr AS (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1),
fee AS (
  SELECT d.id, d.student_id, make_date(fp.year, fp.month, 1) AS m, d.net, d.paid,
         COALESCE(p.pick_route_id, p.drop_route_id, a.route_id) AS route_id
    FROM fee_demands d
    JOIN fee_heads fh ON fh.id = d.head_id AND fh.kind = 'transport'
    JOIN fee_periods fp ON fp.id = d.period_id
    LEFT JOIN LATERAL (SELECT x.pick_route_id, x.drop_route_id FROM student_transport x
                        WHERE x.student_id = d.student_id AND x.academic_year_id = d.academic_year_id
                          AND x.status IN ('active', 'ended')
                          AND make_date(fp.year, fp.month, 1) BETWEEN x.from_month AND x.to_month
                        ORDER BY x.id DESC LIMIT 1) p ON true
    LEFT JOIN student_route_assignments a ON a.student_id = d.student_id AND a.academic_year_id = d.academic_year_id
   WHERE d.academic_year_id = (SELECT id FROM yr) AND d.status IN ('pending', 'partial', 'paid'))
SELECT COALESCE(r.code, 'No route') AS route, count(DISTINCT fee.student_id) AS pupils,
       sum(fee.net) AS billed, sum(fee.paid) AS collected, sum(fee.net - fee.paid) AS balance
  FROM fee LEFT JOIN transport_routes r ON r.id = fee.route_id
 GROUP BY r.code
 ORDER BY r.code NULLS LAST
```

Note: the same rule as the transport fee report — the route ridden in that month, else the route now.

**5. Requests waiting for approval, and with whom.**

```sql
SELECT q.number, q.kind, q.source, q.service, q.from_month, q.requested_at,
       s.admission_no, s.display_name,
       pr.code AS pick_route, ap.label AS waiting_with, ap.seq AS level,
       now() - q.requested_at AS waiting_for
  FROM transport_requests q
  JOIN students s ON s.id = q.student_id
  LEFT JOIN transport_routes pr ON pr.id = COALESCE(q.pick_route_id, q.route_id)
  LEFT JOIN LATERAL (SELECT a.label, a.seq FROM transport_request_approvals a
                      WHERE a.request_id = q.id AND a.status = 'pending' ORDER BY a.seq LIMIT 1) ap ON true
 WHERE q.status = 'pending'
 ORDER BY q.requested_at
```

**6. Bus roll marked by the route teachers: totals per route, day and trip.**

```sql
SELECT bs.on_date, r.code AS route, bs.trip, bs.marked_late,
       count(m.id) FILTER (WHERE m.code = 'P')  AS on_bus,
       count(m.id) FILTER (WHERE m.code = 'A')  AS not_on_bus,
       count(m.id) FILTER (WHERE m.code = 'LV') AS on_leave,
       count(m.id) FILTER (WHERE m.code = 'GP') AS gate_pass,
       count(m.id) FILTER (WHERE m.code = 'OT') AS other_arrangement
  FROM bus_roll_sessions bs
  JOIN transport_routes r ON r.id = bs.route_id
  LEFT JOIN bus_roll_marks m ON m.session_id = bs.id
 WHERE bs.on_date BETWEEN DATE '2026-11-01' AND DATE '2026-11-30'
 GROUP BY bs.id, bs.on_date, r.code, bs.trip, bs.marked_late
 ORDER BY bs.on_date, r.code, bs.trip DESC
```

**7. RFID bus taps per route and day.**

```sql
SELECT b.on_date, r.code AS route,
       count(DISTINCT b.student_id) FILTER (WHERE b.direction = 'in' AND b.outcome IN ('boarded', 'late_boarding')) AS boarded,
       count(DISTINCT b.student_id) FILTER (WHERE b.outcome = 'late_boarding') AS late_boarding,
       count(DISTINCT b.student_id) FILTER (WHERE b.direction = 'out' AND b.outcome = 'alighted') AS alighted,
       count(*) FILTER (WHERE b.outcome = 'unknown_tag') AS unknown_tags
  FROM bus_attendance b
  LEFT JOIN transport_routes r ON r.id = b.route_id
 WHERE b.on_date BETWEEN DATE '2026-11-01' AND DATE '2026-11-30'
 GROUP BY b.on_date, r.code
 ORDER BY b.on_date, r.code
```

Note: count distinct pupils; a pupil taps in and out on both trips.

**8. Pupils who boarded the bus but were marked absent in class that day (crosses into attendance).**

```sql
SELECT b.on_date, s.admission_no, s.display_name, r.code AS route, min(b.occurred_at) AS boarded_at, m.code AS school_mark
  FROM bus_attendance b
  JOIN students s ON s.id = b.student_id
  LEFT JOIN transport_routes r ON r.id = b.route_id
  JOIN enrolments e ON e.student_id = b.student_id AND e.status = 'active'
  JOIN attendance_sessions se ON se.class_section_id = e.class_section_id AND se.academic_year_id = e.academic_year_id
                             AND se.on_date = b.on_date AND se.kind = 'day'
  JOIN attendance_marks m ON m.session_id = se.id AND m.student_id = b.student_id
 WHERE b.direction = 'in' AND b.outcome IN ('boarded', 'late_boarding')
   AND b.on_date BETWEEN DATE '2026-11-01' AND DATE '2026-11-30'
   AND m.code = 'A'
 GROUP BY b.on_date, s.admission_no, s.display_name, r.code, m.code
 ORDER BY b.on_date, r.code
```

Note: a safety check — the child got on the bus but is not in class.

**9. Kilometres, fuel and cost per kilometre per vehicle and month.**

```sql
SELECT v.reg_no, date_trunc('month', g.log_date)::date AS month,
       sum(g.odometer_end - g.odometer_start) AS km,
       sum(g.fuel_litres) AS litres, sum(g.fuel_cost) AS fuel_cost,
       round(sum(g.fuel_cost) / NULLIF(sum(g.odometer_end - g.odometer_start), 0), 2) AS cost_per_km,
       count(*) FILTER (WHERE g.incident IS NOT NULL AND btrim(g.incident) <> '') AS days_with_incident
  FROM transport_vehicle_logs g
  JOIN transport_vehicles v ON v.id = g.vehicle_id
 WHERE g.log_date BETWEEN DATE '2026-04-01' AND DATE '2027-03-31'
 GROUP BY v.reg_no, 2
 ORDER BY v.reg_no, 2
```

Note: days with a missing odometer reading drop out of the km sum but not the fuel sum; cost per km is then high.

**10. Vehicle papers and driving licences expiring in the next 30 days.**

```sql
WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d),
docs AS (
  SELECT v.reg_no AS name, 'Insurance' AS what, v.insurance_expiry AS expires FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
  UNION ALL SELECT v.reg_no, 'Fitness', v.fitness_expiry FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
  UNION ALL SELECT v.reg_no, 'Permit', v.permit_expiry FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
  UNION ALL SELECT v.reg_no, 'PUC', v.puc_expiry FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
  UNION ALL SELECT d.code, 'Driving licence', d.licence_expiry FROM transport_drivers d
             WHERE d.deleted_at IS NULL AND d.status = 'active' AND d.role = 'driver')
SELECT docs.name, docs.what, docs.expires, docs.expires - today.d AS days_left
  FROM docs CROSS JOIN today
 WHERE docs.expires IS NOT NULL AND docs.expires <= today.d + 30
 ORDER BY docs.expires
```

Note: already-expired papers show with negative days left.

**11. Gate RFID taps per device and day (school attendance readers).**

```sql
SELECT (e.occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS on_day, d.code AS device, d.kind,
       count(DISTINCT e.student_id) FILTER (WHERE e.direction = 'in' AND e.outcome IN ('marked_present', 'marked_late')) AS pupils_in,
       count(DISTINCT e.student_id) FILTER (WHERE e.outcome = 'marked_late') AS late,
       count(*) FILTER (WHERE e.outcome = 'out_recorded') AS taps_out,
       count(*) FILTER (WHERE e.outcome IN ('unknown_tag', 'no_enrolment')) AS not_matched,
       max(d.last_seen_at) AS device_last_seen
  FROM rfid_events e
  JOIN rfid_devices d ON d.id = e.device_id
 WHERE e.occurred_at >= TIMESTAMPTZ '2026-11-01 00:00+05:30' AND e.occurred_at < TIMESTAMPTZ '2026-12-01 00:00+05:30'
 GROUP BY 1, d.code, d.kind
 ORDER BY 1, d.code
```

**12. A pupil's transport history this session (every period, which request made or ended it).**

```sql
SELECT s.admission_no, s.display_name, t.status, t.service, t.from_month, t.to_month,
       pr.code AS pick_route, ps.name AS pick_stop, dr.code AS drop_route, ds.name AS drop_stop,
       sl.name AS slab, t.monthly_amount, q.number AS made_by_request, eq.number AS ended_by_request
  FROM student_transport t
  JOIN students s ON s.id = t.student_id
  LEFT JOIN transport_routes pr ON pr.id = t.pick_route_id
  LEFT JOIN transport_stops ps ON ps.id = t.pick_stop_id
  LEFT JOIN transport_routes dr ON dr.id = t.drop_route_id
  LEFT JOIN transport_stops ds ON ds.id = t.drop_stop_id
  LEFT JOIN transport_slabs sl ON sl.id = t.slab_id
  LEFT JOIN transport_requests q ON q.id = t.request_id
  LEFT JOIN transport_requests eq ON eq.id = t.ended_by_request
 WHERE t.academic_year_id = (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1)
   AND t.status <> 'cancelled'
 ORDER BY s.display_name, t.from_month
```

## Traps

- **`student_transport` is the truth; `student_route_assignments` is a derived snapshot.** The mapping holds only the
  period covering the current month, one row per pupil and year, and is refreshed when a request is approved or a
  transport page runs `app.transport_tick` (no scheduled job). It can be a few days stale at a month change, and it
  says nothing about past or future months. Use `student_transport` for any month-wise, historical or fee
  question; use the mapping only for "on the bus now" lists, as the bus roll and the reader do.
- **`ended` periods still count for their months.** Filter `status IN ('active', 'ended')` and the month range;
  `status = 'active'` alone misses pupils who changed route mid-year for their earlier months.
- **Pick and drop can be different routes.** A pupil can be counted on two routes; `student_route_assignments.route_id`
  is the pick route (or the drop route for drop-only). Count trips separately.
- **Old and new request columns.** `transport_requests.route_id` / `stop_id` are from the first design; since 0077 use
  `pick_*` / `drop_*` (back-filled for old rows). `workflow_instance_id` belongs to requests decided by the old
  generic workflow; newer requests use `transport_request_approvals`.
- **Cached crew on the route.** `transport_routes.vehicle_no`, `driver_name`, `driver_mobile`, `conductor_*`,
  `vehicle_id`, `driver_id` are copies of today's `transport_route_vehicles` winner, refreshed when a mapping is
  saved and when the transport tick or the GPS page run `app.transport_routes_sync`. A mapping that starts or ends
  on a later date only reaches the route on the next refresh. For a past day, read `transport_route_vehicles`
  with its dates (and `transport_replacements`).
- **Stops copy the stoppage.** `transport_stops.name`, `slab_id`, `lat`, `lng` follow the stoppage by trigger; group
  places by `stoppage_id` (the same stoppage appears on many routes).
- **Slabs are per year** but a stoppage keeps one `slab_id`. The amount a pupil pays is the period's
  `monthly_amount` (and the fee lines), not the slab's current amount.
- **Rate is not the bill.** `monthly_amount` ignores discounts, months the school does not charge transport, and
  pupils whose fee profile has no slab or has transport switched off. Bill totals come from `fee_demands`.
- **Two bus attendances.** `bus_attendance` = RFID taps (automatic); `bus_roll_marks` = the teacher's roll (manual).
  They can disagree; say which you report. Some API counts read only `outcome = 'boarded'`; include
  `late_boarding` when you mean "got on".
- **`bus_attendance` vs `rfid_events`.** Bus readers write `bus_attendance`; gate readers write `rfid_events` (school
  attendance). Same device table (`rfid_devices.kind`).
- **Duplicates and unknown tags.** Leave out `duplicate` and `unknown_tag` rows when counting pupils; `student_id`
  is NULL on unknown tags.
- **Soft deletes.** Exclude `deleted_at IS NOT NULL` on `transport_routes`, `transport_vehicles`, `transport_drivers`.
- **GPS is short-lived.** `vehicle_positions` older than `transport.gps_retention_days` (default 30) are deleted
  nightly; trip history beyond that is gone.
- **Time zones.** `bus_attendance.on_date` is already the India date; `rfid_events` has no date column; GPS
  `recorded_at` is the device's clock.
- **In-charge scope is in the API only.** A person named in `transport_incharges` for some routes sees those routes'
  fee in the app; SQL sees all routes of the school. Filter by `transport_incharges` yourself when reporting for them.
- **Merged / withdrawn pupils.** Merges move transport rows to the kept record; a withdrawn pupil's period should
  have been ended, but still join `students` with `deleted_at IS NULL AND merged_into_id IS NULL` (and check
  `students.status`) for live lists.

## Personal and sensitive data

Mask these, or never send them to an AI model:

- **Where children are:** `bus_attendance.lat`, `lng`, `occurred_at` with `student_id`; `vehicle_positions.lat`,
  `lng` (the bus a named child is on); `transport_stoppages.lat`, `lng`, `area` and a pupil's stop (home area);
  `student_route_assignments` / `student_transport` stop and times for a named pupil.
- **Tags and device secrets:** `bus_attendance.tag`, `rfid_events.tag` (a child's card number), `raw` jsonb on both;
  `rfid_devices.api_key_hash` (never export); `transport_vehicles.camera_url`, `track_url`, `gps_device_id`
  (may carry access links).
- **Crew:** `transport_drivers.name`, `mobile`, `emergency_mobile`, `address`, `licence_no`, `badge_no`,
  `police_verified` / `police_verified_on`; the copies on routes (`driver_name`, `driver_mobile`, `conductor_name`,
  `conductor_mobile`).
- **Vendors:** `transport_vendors.contact_person`, `mobile`, `email`, `address`, `gst_no`.
- **Free text:** `transport_requests.note`, `decision_note`, `fee_note`; `transport_request_approvals.note`;
  `bus_roll_marks.remarks`; `bus_roll_sessions.notes`; `transport_vehicle_logs.incident`, `remarks`;
  `transport_replacements.reason`, `ended_note`.
- Pupil names and guardian contacts come from `students` / `guardians` — mask as in the people guide.
