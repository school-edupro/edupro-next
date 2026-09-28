# Playbook: examinations and grading (draft for the academic workshop)

Source: rules recovered from the legacy exam module (`EANDE`, blueprint section 5.4). Status: **draft** pending the academic coordinator workshop. Open questions Q-E1 onward.

## 1. Entities

| Entity               | Meaning                                                                                                                                              | Target table                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Exam type            | a named assessment such as Periodic Test 1, Half Yearly, Annual, with a code                                                                         | `exam_types`                  |
| Exam                 | an exam type scheduled for a year and class group with portal visibility and which entries are open (marks, remarks, indicators, attendance, health) | `exams`                       |
| Exam subject         | a subject in an exam for a class with maximum marks, weightage and a lock flag                                                                       | `exam_subjects`               |
| Grade scale          | bands of marks to grade and grade points per class group                                                                                             | `grade_scales`, `grade_bands` |
| Mark entry           | marks per student per exam subject, with who entered and when                                                                                        | `mark_entries`                |
| Indicator entry      | co-scholastic or holistic progress indicators per student per exam                                                                                   | `indicator_entries`           |
| Remark               | class teacher remark per student per exam                                                                                                            | `remark_entries`              |
| Report card template | HTML and layout definition per class band and term, per school                                                                                       | `report_card_templates`       |

## 2. Rules recovered

| ID    | Rule                                                                                                                                          | Legacy evidence                                             | Confidence |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------- |
| R-E1  | Exam types are defined per school with codes; exams exist per master class and year with flags for which uploads are open                     | `exam_type`, `exam_master` upload flags                     | high       |
| R-E2  | Subjects per exam per class carry maximum marks and weightage; elective subjects come from the student subject mapping                        | `exam_subject_master`, `student_subject_mapping`            | high       |
| R-E3  | Mark entry is allowed for the subject teacher of that class, the class teacher, or named bypass users, and blocked when the subject is locked | `exam_marks_entry.php`                                      | high       |
| R-E4  | Grades come from a range lookup on marks against the scale for the class group and year                                                       | `GetGrade.php`                                              | high       |
| R-E5  | Term totals and percentages are computed and mapped on a 100-mark scale for report cards                                                      | report card code                                            | medium     |
| R-E6  | Indicators (CCE, HPC) use separate masters and entries; some exams open indicator entry only                                                  | `exam_indicator_*`                                          | medium     |
| R-E7  | Exam attendance, remarks and health statistics are entered per student per exam                                                               | `exam_attendance`, `exam_remark*`, `exam_health_statistics` | high       |
| R-E8  | Report cards are rendered per class band and term; layouts differ per campus; visibility is withheld for fee defaulters                       | `reportcard/` (283 templates), `reportcard_hide`            | high       |
| R-E9  | Ranks are computed per class or section from totals                                                                                           | `report_card_rank`                                          | medium     |
| R-E10 | Board results (CBSE) are imported from text files and compared with internal marks                                                            | `cbse_comp`                                                 | medium     |
| R-E11 | Promotion decisions link to annual results                                                                                                    | `student_promotion`                                         | low        |

## 3. Proposed behaviour

1. Exam setup is per year, cloned from the previous year by the rollover with a review step.
2. Mark entry uses scopes: subject teacher entries limited to their subject and sections; locks per exam subject; unlock requires `exams.marks.unlock` with MFA and a reason.
3. Grades and totals are computed by procedures (`app.compute_grade`, `app.finalise_exam`) so the register, the report card and the parent view agree.
4. Report card templates are data: one HTML template with slots per class band and term, configured per school, with the campus layouts harvested from the legacy copies.
5. Report card visibility rules (fee defaulter hold) are a setting, applied at render time and audited.

## 4. Open questions for the academic workshop

| ID    | Question                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------- |
| Q-E1  | Which exam types exist per class band, and which count toward the annual result with what weightage? |
| Q-E2  | Are grade scales per class band, per subject, or per exam? Do they change year to year?              |
| Q-E3  | How are absent, exempted and medical cases represented in marks and in totals?                       |
| Q-E4  | Who may unlock a locked subject, and is a re-entry after unlock re-verified by a second person?      |
| Q-E5  | Which of the legacy report card layouts are still in use per school, and which are historical only?  |
| Q-E6  | Are ranks published to parents, and at what granularity (class, section, none)?                      |
| Q-E7  | What are the CBSE, ICSE and state board output formats needed for the current year?                  |
| Q-E8  | How are electives and skill subjects shown on report cards when a student has no entry?              |
| Q-E9  | Is the fee-defaulter hold applied automatically at a date, or manually by the fee manager?           |
| Q-E10 | Which indicator frameworks (CCE, HPC, school-specific) are active, per class band?                   |
