# 33 · Student and employee dashboards; employee self-service profile

Benchmarked on Entab, Fedena, Teachmint and PowerSchool: strength and movement first, then today, then the
health of the records (what is missing, what waits for approval).

## Decisions (18 Oct 2026)

- Two dashboards, one per menu: People → **Student dashboard**, Employee management → **Employee
  dashboard**; figures first (rows of four), then tables, then small charts.
- Students: strength (by class, boys / girls, category, day scholar / hosteller, new / continuing, EWS),
  movement (admitted in the year and month, withdrawn, TCs, transfers in / out), today (sections marked,
  present / absent / short leave, birthdays), records (average completeness, below 80%, no photo, no Aadhaar,
  profile changes to approve). A class teacher sees their own sections.
- Employees: strength (teaching / non-teaching, department, designation, type, gender, no login), movement
  (joined / left, transfers, probation ending in 30 days, reaching 60 in 12 months), today (punched in, late
  after the ACR "late after" time, activity logs, birthdays and work anniversaries), records and HR (average
  completeness, required documents missing, documents expiring in 30 days, profile changes to approve, ACR of
  the latest cycle).
- Employees see their own profile in the staff app and download it as PDF with their own ID numbers in full.
- Employees ask for profile changes the way families do for students (0041): the school sets per field
  hidden / view / change with approval / change at once, proofs (its employee document types), the update
  window, and approvers (HOD or L1/L2 from the record, HR, a role, a named person; up to two steps).

## Built

- Part 1 (dashboards): `GET people/dashboard/students?class=`, `GET people/dashboard/staff?department=`
  (`people-dashboard.service.ts`); admin `/people/dashboard`, `/people/staff-dashboard`. Migration **0186**
  adds the employee self-service tables (`employee_portal_policies`, `employee_change_requests`,
  `employee_change_actions`) and rights (`people.staff_profile.manage`, `people.staff_change.approve`,
  `people.staff_change.override`). Test: `apps/api/test/people-dashboard.e2e-spec.ts`.
