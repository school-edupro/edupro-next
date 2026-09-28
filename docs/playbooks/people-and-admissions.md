# Playbook: people and admissions (draft for the front-office workshop)

Source: blueprint sections 5.2 and 5.11. Status: **draft** pending the workshop with the admissions and front-office staff. Open questions Q-P1 onward.

## 1. Student lifecycle

| Stage                   | Legacy behaviour                                                                                                                              | Proposed                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registration            | public form per school with passcode window and age criteria; photo upload; registration fee online; registration number allocated on payment | `apps/public` form defined per admission cycle (JSON schema), OTP applicant login, fee through the payments service, number allocated by a sequence on confirmed payment |
| Scoring                 | points for distance, sibling, alumni parent, qualification from masters                                                                       | scoring rules per cycle as configuration; scores recomputed on rule change with audit                                                                                    |
| Shortlist and draw      | admin lists, draw of lots for nursery, L1 and L2 approvals (L3 and L4 in the older module)                                                    | workflow definition per cycle with 2 to 4 levels; draw as a recorded, seeded random with published list                                                                  |
| Offer and admission fee | admission number from a sequence after fee                                                                                                    | offer with expiry; admission number on fee confirmation; ledger type `admission`                                                                                         |
| Section allotment       | inserts into the student master, welcome email, installment seed                                                                              | creates `students` (if new) and `student_enrollments`, triggers welcome communication and fee demand generation                                                          |
| In-year changes         | class or section change, transport change, category change with approvals                                                                     | enrolment updates with workflow where money is affected                                                                                                                  |
| Promotion               | copies the student row into the next year with rollback                                                                                       | new enrolment rows created by the rollover from promotion decisions; no row copies                                                                                       |
| Transfer                | between group schools with a cross-database insert                                                                                            | cross-school transfer request with both schools' approval; identity retained through One Auth                                                                            |
| Withdrawal              | two-step department clearance; status inactive, withdraw date, user disabled                                                                  | clearance workflow (library, fees, transport, hostel); enrolment ended; TC generated; user access ended                                                                  |

## 2. Employees

| Stage               | Legacy                                                                              | Proposed                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding          | employee master with approver chain fields; optional HRMS sync                      | `employees` + `employee_postings` (department, designation, reporting line per year); HRMS sync as an adapter where a client requires it |
| Teacher assignments | class teacher, subject teacher, coordinator flags in a mapping table with `is_true` | `teacher_assignments` per year driving RBAC scopes                                                                                       |
| Documents           | files in the web root                                                               | object storage with classification                                                                                                       |
| Exit                | move to alumni tables                                                               | posting ended; access ended; records retained per policy                                                                                 |

## 3. Identity and access for people

- One Auth account per person; students and guardians share a mobile-number-based login today, with siblings under one guardian.
- Proposed: guardians hold the parent portal identity; a child's data is visible to linked guardians; students above a school-set age may get their own login.

## 4. Open questions for the workshop

| ID    | Question                                                                                                                                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Q-P1  | Which registration form fields are mandatory per school and per class band, and which are conditional (sibling, alumni, EWS, staff ward)? |
| Q-P2  | What are the current scoring rules and their weights per school, and who may change them mid-cycle?                                       |
| Q-P3  | How many approval levels does each school use for admissions, and who sits at each level?                                                 |
| Q-P4  | Is the draw of lots observed by parents, and what record must be published?                                                               |
| Q-P5  | How long is an admission offer valid, and what happens on expiry (waitlist promotion)?                                                    |
| Q-P6  | Which departments must clear a withdrawal, and can the principal override?                                                                |
| Q-P7  | Do guardians need separate logins for each child, or one login with a child switcher (proposed)?                                          |
| Q-P8  | Which student fields are shared with the group and which are strictly per school?                                                         |
| Q-P9  | Is the external HRMS the master for employees at any school, and for which fields?                                                        |
| Q-P10 | What is the policy for students turning 18: own login, data visibility, consent transfer?                                                 |
