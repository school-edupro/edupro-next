# Employees (staff master)

For the HR / office staff who keep staff records. Design: docs/design/30-employee-master.md.

## Set up once (People → Staff setup)

- **Departments**, **Designations** and **Employee types** are the school's own lists. Each employee
  type belongs to a staff group (teaching, non-teaching, contract, visiting) that timetable, attendance
  and ID cards read.
- Other drop-downs (marital status, nature of appointment, role, pay band, language, qualification,
  education mode) are in System setup → Profile lists (students and staff). Religion, category, blood
  group and nationality are shared with students; cities, states and banks come from System setup.

## Onboard a new employee (Employees → Onboard)

1. The code is filled with the next number (you may type another).
2. Fill name, gender, mobile, employee type, department, designation and the date of joining (email if
   known).
3. Keep **Create a staff login** ticked: they sign in with a code sent to their mobile or email.
   Teaching staff get the Subject Teacher role; give other roles in Access.
4. **Complete the profile** now or later; the profile shows how complete it is.

## The profile (open an employee)

- Tabs: Basic, Contact and emergency, Address (present and permanent, or "same as present"),
  Employment, Statutory, Identity documents, Bank, Approvers. A number on a tab is the required fields
  still missing; **go to first** jumps there. Save sends only what changed.
- Aadhaar, PAN and the account number are kept encrypted and shown masked unless you have the
  Sensitive data viewer role; type a new number to replace one.
- Tabs **Education**, **Languages**, **Experience**, **Transfers and remarks** each list rows with Add
  and Remove. Remarks written by the system (onboarded, leaving) stay.
- A **date of leaving** makes the employee inactive.
- **Make a staff login** for someone who has none.

## The list (People → Employees)

- Status, quick filters (staff group, type, department, designation, gender, staff login) and the
  search (name, code, mobile, email); **Apply**. A search finds people who have left too.
- **More filters**: any field with a condition (is, is one of, contains, between, empty …).
- **Columns**: choose, order and rename the columns; your choice is kept for you.
- **Export Excel / PDF** gives exactly what you see; **Save as report** keeps it in the Report builder
  (Report builder → New employee report also starts one from scratch).

## Many at once (Employees → Excel upload)

1. **Add new employees** or **Update existing employees**; tick the columns you want (or none for all)
   and **Download template**. The update file comes filled with today's values by employee code.
2. Fill it: dates as DD-MM-YYYY, the drop-downs for lists, approvers by their employee code. A blank
   cell changes nothing; type CLEAR to empty a field. New staff: leave Employee Code empty for the next
   number; Create staff login is Yes unless you type No.
3. Upload it and **Check the file**: every change shows as old → new, every problem with its row and
   column. Fix and upload again, or **Apply** the rows that are ready; the result file lists every row.

## Five common questions

1. _The department I need is not offered._ Add it in Staff setup → Departments.
2. _The new teacher cannot sign in._ Open the profile: if it says No login, press Make a staff login (a
   mobile or an email is needed).
3. _Why does a profile show 60%?_ Required fields are missing; the numbers on the tabs show where.
4. _Can I see someone who left?_ Status: Left / inactive, or just search the name.
5. _I need a staff list with PAN and bank details._ Columns → Identity documents and Bank details, then
   Export Excel (full numbers only with the Sensitive data viewer role).
