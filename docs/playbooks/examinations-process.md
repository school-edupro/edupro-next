# Examinations: the process from set-up to promotion

For the principal, the examination cell, coordinators and teachers. It describes how an examination
runs in EduPro Next from the start of the session to promotion: who does each step, where they do it,
and the rules the system applies. Classes Balvatika to XII. Built from design document 65
(`docs/design/65-examination-module-v2.md`, parts 1 to 7, October 2026).

## 1. Who does what

| Person                         | Role in EduPro       | Does                                                                                                                                                                                |
| ------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principal / school admin       | School admin         | Sets up the school's rules, verifies when needed, **publishes** results and report cards, reopens with a reason, holds a card                                                       |
| Examination cell / coordinator | Academic coordinator | Exams and subjects, grade scales, marks codes, schemes, templates, releases; verifies marks; reopens with a reason; sends promotion decisions                                       |
| Class teacher                  | Class teacher        | Marks of their subjects; the exam register (remarks by category, the general remark, attendance, height and weight); indicators and the progress card; verifies the section's marks |
| Subject teacher                | Subject teacher      | Marks of their subject and sections; the remark category of their subject                                                                                                           |
| Parent                         | Parent               | Reads published results and report cards in the parent app; writes their feedback on the Balvatika to Class II progress card                                                        |
| Student                        | Student              | Reads published results and report cards                                                                                                                                            |

Rights behind the roles (for the school admin who changes roles):

| Right                                                                       | Held by                                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `exams.master.manage` (exams, subjects, scales, codes, schemes, categories) | coordinator, school admin, group admin                                                       |
| `exams.marks.enter`                                                         | class teacher, subject teacher                                                               |
| `exams.marks.verify`                                                        | coordinator, school admin, group admin (class teachers verify their own sections without it) |
| `exams.marks.unlock` (reopen, open a lock)                                  | coordinator, school admin, group admin                                                       |
| `exams.indicator.enter`                                                     | class and subject teachers, coordinator, school admin                                        |
| `exams.remark.enter`, `exams.attendance.enter`                              | class teacher, coordinator, school admin                                                     |
| `exams.health.enter`                                                        | class teacher, school admin                                                                  |
| `exams.report_card.manage` (templates, signatures, releases)                | coordinator, school admin                                                                    |
| `exams.result.publish`                                                      | school admin, group admin                                                                    |
| `people.promotion.manage`                                                   | coordinator, school admin                                                                    |
| `exams.family.view` / `exams.family.feedback`                               | parents and students / parents                                                               |

The school admin holds the unlock right but **not** the marks entry right: the person who reopens
marks is not the person who types them (separation of duties). Every change is recorded in the audit
log with who, when and what changed.

## 2. The year at a glance

| When                       | What happens                                                                           | Who                                    |
| -------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------- |
| Before the session         | One-time set-up (section 3)                                                            | Coordinator, school admin              |
| Start of the session       | Subject choices of each student; teacher assignments                                   | Coordinator, class teachers            |
| Before each exam           | The exam, its classes, subjects, maximum and pass marks; indicator set per class       | Coordinator                            |
| During and after each exam | Marks, codes, indicators, remarks, attendance, health                                  | Teachers                               |
| After entry                | Submit → verify; the exam's results are worked out                                     | Teachers, class teacher or coordinator |
| End of each term           | The term result scheme is locked and worked out; registers; report cards prepared      | Coordinator                            |
| Result day                 | The principal publishes; families are told; cards in the parent app                    | Principal                              |
| Any time                   | Analysis and exports                                                                   | Coordinator, principal                 |
| End of the session         | Promotion proposals from the final term → People → Promotions → next year's enrolments | Coordinator, school admin              |

## 3. One-time set-up

Do these once; review them each session.

1. **Exam types and grade scales** — Exams → Types and grade scales.
   - Add the exam types (Periodic Test, Half-yearly, Annual …).
   - **Add the ready-made scales**: CBSE 8-point (A1 to E, VI-XII), primary 6-point, co-scholastic
     3-point. Change any band if the school uses its own.
   - **Marks codes**: AB (absent: counts zero and blocks the result), ML (medical), EX (exempt), NA (not
     applicable), OD (on duty), L (late admission), NEW ADM — these stay out of the maximum. A school
     may add its own code with a treatment: zero, out of the maximum, fixed marks, a % of the maximum,
     or pro-rata from the student's other exams.
2. **Subject choices** — Exams → Subject choices: every student takes the class's compulsory subjects
   unless set otherwise; set optional, additional and stream subjects per student, in bulk or by Excel.
   A student without a subject is "not taken", never "incomplete". Additional subjects print but stay
   out of the total unless the scheme counts them.
3. **Teacher assignments** — Academics → Teacher assignments: the class teacher and the subject teacher
   of each section. Teachers see and enter only their own sections and subjects.
4. **Mark schemes** — Exams → Mark schemes and registers: start from a ready-made DPS Noida scheme
   (VI-VIII, IX, X, XI, XII) and map its exams, or build columns yourself (an exam's marks, a part such
   as Theory, average or best of N, sum, convert to a maximum, attendance slab, the marks-obtained
   column), the rounding, pass %, compartment up to N subjects, divisions and ranking. One locked scheme
   per class and term is **the result scheme**; others are free registers.
5. **Report cards** — Exams → Report cards → Templates: **Install the DPS Noida cards** (I-II, III-V,
   VI-VIII, IX, X, XI, XII); for Balvatika to Class II, **Add the progress card template** on Exams →
   Indicators and HPC.
   **Signatures and seal**: principal, vice principal, headmistress, coordinator, class teacher, exam
   in-charge, the seal, each with an image (PNG or JPEG up to 300 KB) and the classes it signs for.
6. **Remark categories** — Exams → Remark categories: name the categories (as the old A / B / C / D
   lists and "any other"), tie one to a subject so its subject teacher writes it too, limit it to some
   classes, and choose free text or the listed remarks only. Put the remarks in the bank under each
   category; remarks without a category are the class teacher's general remark list.
7. **Indicators and the progress card** — Exams → Indicators and HPC: **Add the progress card set**
   (NCERT foundational stage: six domains, curricular goals, competencies rated Beginner / Progressing /
   Proficient, printed with Stream / Mountain / Sky) and any co-scholastic indicator sets, in up to
   three levels (area → item → sub-item). Edit the words to suit the school.

## 4. Each exam

### 4.1 Create the exam — coordinator

Exams → Exams of the session (the form under the list), then open the exam:

- its classes and the grade scale of each;
- the subjects of each class with **maximum and pass marks** (a maximum of 0 makes a grade-only
  subject such as art or PE, graded from its own scale); a subject may be entered **in parts**
  (Theory / Practical, or Physics / Chemistry / Biology under Science, each by its own teacher);
- **Indicators or progress card**: the set each class uses in this exam;
- **Entry locks of the class**: marks, indicators, remarks, attendance, health (tick what is closed).

### 4.2 Enter — teachers

| What                                                                              | Where (teacher app)                             | Where (admin)             | Rules                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marks                                                                             | Marks                                           | Exam → Marks entry        | A mark, or a code instead; a grade for a grade-only subject; only the students who take the subject; Excel download and upload, every row checked before anything is saved                                            |
| Indicators, progress card                                                         | Indicators and progress card                    | Exam → Indicators and HPC | One area at a time; a level per competency, or a written note; goals are headings                                                                                                                                     |
| Child's words, parent's feedback, teacher's observations, portfolio photos        | Indicators and progress card                    | Exam → Indicators and HPC | Balvatika to II; up to 12 photos per child (the card prints 6), PNG or JPEG up to 1 MB                                                                                                                                |
| Remarks by category                                                               | Remarks                                         | Exam → Remarks            | One per student and category; the class teacher writes every category, a subject teacher their subject's                                                                                                              |
| General remark, "took part in", "promoted to", exam attendance, height and weight | Exam register                                   | —                         | The class teacher of the section                                                                                                                                                                                      |
| Exam attendance                                                                   | Exam register → **Count from daily attendance** | —                         | Days marked and days present from daily attendance between two dates (late, half day, on duty, stay back and short leave count as present); entered rows are kept unless replaced; the class teacher corrects any row |

A parent may write their own feedback for the progress card in the parent app (Results) while the
class's indicators are open; what they write is kept as they wrote it.

### 4.3 Submit, verify, send back, reopen

Each subject of each section moves **open → submitted → verified**:

1. **Submit** — the teacher, once every student who takes the subject has a mark or a code.
2. **Verify** — the class teacher or a coordinator of the section (or anyone with the verify right).
   The person who submitted verifies their own only with the verify right. Verifying locks the marks
   and **works the results out again**: the exam's results, and the term results of every locked
   result scheme that reads the exam.
3. **Send back** — the verifier returns it with a note; the teacher corrects and submits again.
4. **Reopen** — a verified subject is reopened only with the unlock right and a **reason**, and not
   while a published release includes the exam (withdraw it first).

Exam → **Marks status** shows every section and subject (students, entered, status, by whom); the
teacher app's **Verify marks** lists what waits for a class teacher.

## 5. End of the term

1. **Term results** — open the class's result scheme: **Lock this version**, then **Work out the term
   results**. A locked scheme is changed only by making a **new version** (the old one is superseded
   and its term results go).
2. **Registers** — the scheme's register by section or class, by roll or as a merit list; Excel and PDF.
3. **Report cards** — Exams → Report cards → New release: the term, its exams, the template of each
   band or of a class (IX and X differ in one band), the fee rule (hide the card while dues above a
   minimum stand). **Preview** a student's card; generate the PDFs per section.
4. **Send to the principal** — the coordinator submits the release.

## 6. Result day — the principal

1. **Publish** (Report cards → the release): families are told by SMS and e-mail through the
   `result_published` template (SMS goes once the template has its DLT id) and read the card in the
   parent app.
2. **Hold** one student's card with a reason: no message goes, the family sees it withheld and the PDF
   is refused.
3. **Withdraw** a published release with a reason; correct; publish again.

## 7. Analysis and exports — any time

Exam → **Reports**, each on screen, as Excel and as PDF:

| Report                        | Shows                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Section-wise subject analysis | per section and subject: students, appeared, absent, mean, mean %, highest, lowest, passed, pass %; a class line under several sections |
| Mark ranges                   | students per band of the subject %: the class's grade scale, or the school's own ranges ("90, 75, 60, 33")                              |
| Toppers                       | top N in the class or section, those at or above a %, below a %, or a subject's toppers                                                 |
| Subject teachers              | each subject teacher's sections: appeared, mean %, pass %, highest %                                                                    |
| Upload status                 | per section and subject: students, entered, to enter, status, submitted and verified by                                                 |
| Missing marks                 | the students without a mark or a code, by section and subject                                                                           |

A locked result scheme also has **Merit by division** (the students by division and rank, and the
count of each division per section). Exam → **Result analysis** gives the figures of one exam. The
report builder has the **exam marks**, **exam results** and **term results** datasets for the school's
own reports.

## 8. End of the session — promotion

1. Open the final term's locked result scheme → **Promotion proposals**. For each student:

   | Term result            | Proposal                                       | The card says                                   |
   | ---------------------- | ---------------------------------------------- | ----------------------------------------------- |
   | Pass                   | Promote to the next class                      | "Class VII"                                     |
   | Compartment            | Hold for review until the supplementary result | "Class VII, subject to compartment"             |
   | Fail                   | Retain                                         | "Retained in Class VI" (printed as "Promotion") |
   | Absent or incomplete   | Review                                         | —                                               |
   | Pass in the last class | Passed out                                     | —                                               |

2. Choose the promotion year and each student's section (the same letter is proposed), change any
   decision or text, tick the rows and **Send**: the decisions go to **People → Promotions** and the
   cards' "Promoted to" is filled at once. A decision already applied is not changed.
3. **People → Promotions**: review and **apply** — the students are enrolled in next year's sections.
4. After the supplementary examination, change the held students' decision under People → Promotions
   (the supplementary marks themselves are not in EduPro yet).

## 9. Balvatika to Class II — the progress card

- The class uses the **progress card set** in each term's exam (set on the exam page).
- Teachers rate each competency Beginner / Progressing / Proficient, or write a note; write the child's
  "All about me", the parent's feedback (if given on paper) and their observations; add photos.
- Parents write their feedback in the parent app while it is open.
- The **progress card template** prints the domains with the level of each term and what it means,
  the three voices, the portfolio, attendance, health and signatures. Classes I and II take it per
  class on the release (or the DPS Noida I-II learning record instead).

## 10. Controls

- Marks only through the entry screens or a checked Excel upload; a range check against the maximum.
- Locks per subject and per entry type of a class; the whole exam can be locked.
- Submit → verify → publish; reopening needs a reason and the unlock right; a published result changes
  only by withdrawing it with a reason.
- A closed academic year refuses changes.
- Teachers see and change only their assigned sections (and subjects).
- Every write is in the audit log (System → Audit log); health values are masked there.
- Families see only published releases, never a held or fee-withheld card.

## 11. Checklists

**Before an exam** — exam created with its classes and scales; subjects with maximum and pass marks;
parts set; indicator set per class; subject choices and teacher assignments complete.

**Before result day** — Marks status: every sheet verified (Missing marks report empty); exam
attendance counted and corrected; remarks and the progress card complete; term result schemes locked
and worked out; previews checked for one student per class; signatures and seal set; release sent to
the principal; fee rule and holds decided.

**End of the session** — final term results worked out; promotion proposals sent; People → Promotions
applied after next year's sections exist; held (compartment) students decided after the supplementary
result.

## 12. Common questions

1. _A teacher cannot see a section or subject._ Their teacher assignment is missing for this year.
2. _A student shows "Does not take the subject"._ Check the student's subject choices.
3. _Submit is refused._ Some students who take the subject have no mark and no code (see Missing marks).
4. _A mark must change after verifying._ Reopen with the unlock right and a reason; correct; submit and
   verify again (the results are worked out again on verify).
5. _The card shows old term figures._ Work out the term results on the scheme (verify does it for
   schemes already worked out).
6. _A parent cannot see the card._ The release is not published, the card is held, or fee dues are
   above the release's minimum.
7. _SMS did not go on publishing._ The `result_published` SMS template needs its DLT id
   (Communication → Template master); e-mail goes regardless.
8. _A remark is refused as "list only"._ That category takes only its listed remarks; add the remark to
   the bank or allow free text on the category.
9. _"Count from daily attendance" leaves a student out._ They have no daily attendance in those dates;
   enter their days by hand.
10. _A promotion cannot be sent._ Next year's sections do not exist yet (only the cards are filled), or
    the decision is already applied under People → Promotions.

## 13. Not in EduPro yet

Exam timetable / date sheet, admit cards, seating plan, invigilation, question papers, answer-sheet
tracking, re-evaluation, exam fee, supplementary (compartment) exam marks, physical-education test
batteries, ICSE / state board cards, and moving the old module's mark history in.
