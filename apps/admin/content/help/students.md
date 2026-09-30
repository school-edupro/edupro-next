# Students: profiles, bulk updates and your own reports

## Who does what

| Person                  | Does                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Admission clerk         | Quick add for new students, completes profiles, uploads the Excel sheets                    |
| School admin            | Grants the "Sensitive data viewer" role, edits the drop-down lists, approves family changes |
| Class teacher           | Sees and reports on the students of their own sections only                                 |
| Anyone with the builder | Builds reports, saves them, shares them with colleagues, downloads Excel and PDF            |
| Families                | Ask for changes to address, contact and parent details from the parent app                  |

## Adding a student in a hurry

**People → Students → Quick add** asks for the thirteen things the ERP needs from day one: admission
number, name, date of birth, gender, admission date, father's or mother's name, SMS mobile, caste
category, EWS, day scholar or hosteller, transport and the section. The next admission number and
roll number are filled in for you. After **Save and add next** the form stays on the same section.

The student shows as incomplete until the full profile is filled in.

## The full profile

Open a student and choose **Full profile**. The profile has fourteen tabs, the same sections as the
data collection sheet: student, government IDs, academic, previous school, father, mother, guardian,
family, address, contact, sibling, transport and health, bank, documents.

- A number on a tab shows how many required fields are still empty there.
- Fields appear only when they apply: the caste certificate for OBC, SC and ST; the EWS certificate
  when EWS is Yes; alumni details when a parent is an alumnus; permanent address when it differs.
- Every drop-down is a typeahead: start typing and pick. State lists follow the country; city lists
  follow the state.
- Only the fields you changed are saved. If something is wrong, the field turns red with the reason.
- Brothers and sisters share one father and mother record: changing the father's mobile on one child
  changes it for all his children.

### Aadhaar, PAN and bank account numbers

These are stored encrypted. Most staff see them as `XXXX-XXXX-1234`. To see full numbers a person
needs the **Sensitive data viewer** role: **System → Access → Assignments**, add the role to the named
person. Every full view is recorded in the audit log. To correct a masked number, type the new number
over it; **Remove stored number** clears it.

## Changing many students at once (Excel)

**People → Students → Bulk update from Excel**

1. Choose **Update existing students** or **Add new students**.
2. Pick the section (or all) and tick only the columns you want to change. Download the template.
   For updates it comes filled in with today's values, one row per admission number.
3. Change the cells. A blank cell means no change. Type `CLEAR` to empty a field.
4. Upload it and press **Check the file**. You see every change as old → new, and every problem with
   the row, the column and the reason. Nothing is saved yet.
5. **Apply** saves the good rows. Rows with problems are skipped; fix them in the sheet and upload
   again. The result file lists every row.

The data collection workbook (`Student_Information_Collection.xlsx`) can be uploaded as it is: the
School / Branch, Age, Staff Ward and Academic Year columns are ignored, and the Class and Section
columns are matched to the sections of the working year. Students without an admission number are
listed as registrations still to be admitted.

## Your own reports

**Reports → Report builder → New report**

1. Tick the fields you need on the left (search helps: type "mobile" or "route").
2. Put the columns in order with the arrows or by dragging, and type the header each column should
   carry in Excel and PDF.
3. Add filters: for example Class-Section is one of VI-A, VI-B; Religion is Hindu; Transport Route is
   filled in; Date of Birth between 01-04-2014 and 31-03-2015.
4. Choose up to three sort keys, the academic year, A4 or A3 and the orientation.
5. **Preview** shows the first fifty rows and the total. **Save report** keeps it under My reports.
6. **Excel** or **PDF** downloads the report on the school letterhead: logo, school name, address and
   affiliation, the report name, academic year, the filters in words, when and by whom it was made,
   and page numbers. A PDF page holds 15 columns on A4 and 25 on A3; Excel has no limit.

### Sharing a report

The owner presses **Share** and adds colleagues or whole roles (for example Accountant), each as
**view only** or **can edit**. They find it under **Shared with me**. View-only users can still use
**Save as new** to keep their own copy. Sharing never widens what a person may see: a class teacher
running a shared report still gets only their own sections, and ID numbers stay masked unless they
hold the Sensitive data viewer role.

## Families asking for changes

In the parent app, **Profile → Update more details** lets a family ask for changes to address,
contact numbers, emergency contact, transport, medical notes and the parents' work and education.
Names, category, ID numbers, bank details and class stay with the office. Requests arrive under
**Engagement → Change requests**, where the office approves or rejects them.

## Drop-down lists

**System → System setup → Student profile lists** holds every list (religion, occupation, income,
board and so on). Add, rename or switch off values there; the forms and the Excel templates pick
them up.
