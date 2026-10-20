# 34 · Recruitment: vacancies, candidates, screening, joining

Built in five parts (20 Oct 2026). The school's legacy had an online staff registration form with an
OTP check and a printout; it had no screening pipeline. The form's input fields were read (labels only;
the filled sample is a real applicant's and was not kept) to shape the candidate form of part 2.

## Decisions (20 Oct 2026)

- A vacancy is approved **through the levels the school sets** (Recruitment set-up since part 5; Workflow →
  "Vacancy approval" before); a school that has not set them gets one level, the Principal (role
  school_admin), made on the first submission.
- Candidates sign in on the public link with a **code to their mobile or their email**, as they choose.
- **Screening stages:** the school keeps one list in Recruitment set-up; each vacancy ticks the ones it uses.
- Form fields the employee master has no place for (children, references, current pay, notice period,
  skills, activities) **stay on the candidate**; the employee master gets what it has fields for.

## Part 1 — vacancies and their approval (migration 0197, built)

- Permissions: `people.recruitment.view`, `people.recruitment.raise` (school admin, group admin and the
  academic coordinator, i.e. an HOD), `people.recruitment.manage` (school and group admin).
- `recruitment_stages` (name, kind shortlist | test | interview | final, max marks, order, active):
  seeded Shortlisting, Written test (50), Demo class (20), Interview (30), Final round. Saved as one list
  (`PUT people/recruitment/setup/stages`); a stage left out switches off and stays on the vacancies using it.
- `vacancies` (code VAC-yyyy-nnn, post, designation, department, subject, employee type, campus, posts,
  qualification, experience, pay band, description, stage ids, status draft → pending → approved |
  rejected → published → closed | cancelled, open and close dates, the approval instance, the decision
  note, who raised it) and `vacancy_events` (raised, submitted, approved, sent_back, published, closed,
  cancelled).
- API `people/recruitment`: `GET setup`, `PUT setup/stages`, `GET/POST vacancies`, `GET/PUT vacancies/:id`,
  `POST vacancies/:id/submit | publish | close | cancel`. Submitting needs at least one stage; the
  approval is the workflow `vacancy_approval` (entity `vacancy`); the people module registers the
  completion: the last level approves, or sends it back with the approvers' notes (editable again).
  Cancelling a vacancy waiting for approval withdraws the approval. A published vacancy past its last
  date closes by itself when the list is read.
- Admin: Employee management → **Vacancies** (figures per status first, a status filter and a search, the
  table), **Raise a vacancy** (searchable drop-downs from Staff setup, the stages ticked), the vacancy page
  (status, who it waits with, the sent-back note, Send for approval, Publish with dates, Close, Cancel, the
  post, the steps, the form while editable), **Recruitment set-up** (the stage list; a link to the approval
  levels under Workflow). The vacancy shows in the approvers' header approvals through the workflow inbox.
- Test: `apps/api/test/recruitment.e2e-spec.ts`.

## Part 2 — the careers page and the application (migration 0198, built)

- **Public pages** (public app, `/<school>/careers`): the open posts (published, inside their dates), one
  post with what it asks for, the candidate's form (`/careers/form`, `?apply=<vacancy>` to apply after it),
  and My applications (`/careers/mine`). The school's admissions page links to Careers. English only.
- **Sign-in:** a six-digit code to the mobile (SMS and WhatsApp) or the email, as the candidate chooses
  (`POST public/careers/otp` with the shared proof-of-work challenge, `otp/verify`), ten minutes, five
  tries, three live codes per address; the code goes through the school's template `recruitment_otp`
  (`app.recruitment_otp_send`, editable under Communication); under the development bypass it shows on
  screen. The token is `cand.<jwt>` (two hours, issuer edupro-candidate) in the HttpOnly cookie
  `edupro_candidate`, kept apart from admissions. A candidate is one per mobile or email; the other one
  given on the form becomes a second way to sign in when nobody else uses it.
- **The form** (`packages/db/src/candidate-fields.ts`): every field the employee master has is named by the
  master's key and takes its label, type, list and validation (`validateEmployeeChanges` on save): name,
  gender, date of birth, nationality, religion, marital status, Aadhaar and PAN (encrypted, shown masked),
  father's and spouse's name, mobile, alternate mobile, email, the present and permanent address. The
  candidate's own: father or spouse education and work, experience in years and months, present pay,
  last job's end, when they can join, reason for leaving, testimonials, computer skills, sports,
  languages, travel abroad, remarks, the nine interests. Rows: qualifications, experience, training,
  children, references (columns named as the master's rows where they map). Saving keeps every answer
  accepted and lists the refused ones (a long form is never lost over one answer).
- **Documents:** photo (needed to apply), father's and mother's photo, address proof, Class X
  certificate, qualification certificates (several), father's and mother's ID proof, résumé; images or
  PDFs up to 5 MB, photos images only. The slot comes from `POST public/careers/me/files/slot` (a file
  owned by the candidate), the bytes go to the signed upload address, `POST me/files` makes it the
  document; View opens only the candidate's own files.
- **Applying** (`POST public/careers/vacancies/:id/apply`, with the declaration): the vacancy must be
  open, everything required on file (the required fields, a qualification, the photo), once per post.
  `job_applications` keeps the number (APP-yyyy-nnnn), status `submitted`, a snapshot of the answers,
  rows and files and the encrypted IDs, and `employee_match`: active employees with the same mobile or
  email, for the office (part 3) and the duplicate check before joining (part 4). No message goes out on
  applying yet (notices come with the screening in part 3).
- Public allow-list: `RecruitmentPublicController.*` with the reasons (permission-coverage).
- Tests: `apps/api/test/recruitment-public.e2e-spec.ts`; `apps/admin/e2e/public-a11y.spec.ts` "public
  careers pages".

## Part 3 — candidates and screening (migration 0199, built)

- **Flow:** an application starts at its vacancy's first stage (status New). At the stage it is at, the
  office schedules it (date and time, venue, panel) and, once held, records the marks (within the stage's
  maximum) and the result: **pass** moves it to the next stage (In screening), and passing the **last**
  stage selects it; **fail** ends it (Not taken forward, with the remarks); **hold** keeps it waiting at the
  stage until it is taken up again. It can be ended at any stage with a reason. Only the stage the
  candidate is at is recorded; a decided application is not changed.
- Tables: `application_stage_results` (one row per application and stage: when, venue, panel, marks, the
  maximum, result, remarks, who recorded it), `job_application_events` (applied, added, scheduled,
  passed, on_hold, resumed, not_taken_forward, selected), `job_applications.source` (online | office),
  `decision_note`, `decided_at`; existing applications got their vacancy's first stage.
- **Walk-ins:** the office adds a candidate met in person or referred (name, gender, date of birth,
  mobile, email; checked by the employee master's validation) to an approved vacancy; the candidate is
  found by mobile or email or made new, and can complete the full form online with that mobile. Once per
  post; the employee match is checked as for online applications.
- **Notices** (`recruitment_settings`, Recruitment set-up → Notices): received, a stage scheduled,
  selected (on to start) and not taken forward (off to start), by SMS, WhatsApp and email (SMS and
  email to start). The words are the school's templates (`recruitment_applied`, `_scheduled`,
  `_selected`, `_not_selected`); `app.recruitment_notify` sends by the channels set, and the template rule
  holds: an SMS goes only when its template has the DLT id, a WhatsApp only with the approved name.
- **API** (`people/recruitment`): `GET applications` (vacancy, stage, status, search, same-as-employee
  filter; counts per status), `POST applications` (walk-in), `POST applications/bulk` (one result or
  schedule for the ticked candidates at one stage; others are skipped and named), `GET applications/:id`
  (the form as submitted by section with the master's labels, Aadhaar and PAN masked unless
  people.sensitive.view, the rows, interests, documents, the stages with what happened, the steps),
  `GET applications/:id/files/:fileId`, `POST applications/:id/stages/:stageId`, `POST
applications/:id/reject | resume`, `GET vacancies/:id/pipeline`, `GET/PUT setup/notices`. Recording
  needs people.recruitment.manage; an HOD sees.
- **Admin:** Employee management → **Candidates** (figures per status first, filters, pages of 25/50/100,
  with a vacancy and a stage picked: tick candidates, then Schedule, Passed this stage, Put on hold or Not
  taken forward; Add a candidate the office met); the **application page** (the stage bar, the record of
  each stage, the current stage's form, Take up again, Do not take forward, the warning when the mobile
  or email belongs to an employee with links, the details, rows, documents with View and Download, the
  steps); the **vacancy page** shows the candidates at each stage and how many are selected of the posts;
  **Recruitment set-up** gains Notices.
- The numbered step bar (ACR and the application page) is `.ep-stepbar` (its first version reused
  `.ep-steps` and `.ep-step`, which the approval timeline and an older step list own; renamed).
- Test: `apps/api/test/recruitment-screening.e2e-spec.ts`.

## Part 4 — from selected candidate to employee (migration 0200, built)

- **The move** (`POST people/recruitment/applications/:id/join`; people.recruitment.manage on the route and
  people.employee.create checked in the service): only a selected application, once. It runs the employee
  master's own onboarding inside the same transaction (`EmployeeProfileService.onboardWith`: its checks,
  the next employee code unless one is given, the posting of the year, the "Onboarded" remark, a staff
  login when asked) with the candidate's answers in the master's fields (Aadhaar and PAN decrypted for the
  master's checks and encrypted again by the master) and the employment the office sets: date of joining,
  department, designation (also the designation at joining), employee type and nature of appointment,
  defaulting to the vacancy's.
- **Rows:** qualifications → education (school or college and board or university joined as the
  institution; marks and division as the score), experience → work experience, training → training (the
  year as 1 January of it). Children, references, father or spouse education and work, present pay and
  notice, skills, interests and travel stay on the application.
- **Documents:** the office gives each uploaded document an employee document type or leaves it (photo →
  Photograph, address proof → Address proof, résumé → Resume / CV suggested); the photo also becomes the
  employee's photo when there is none. A remark "Joined from recruitment" is added.
- **Duplicates:** active employees with the same mobile, email, Aadhaar or PAN (IDs compared decrypted,
  as the encryption has a random IV) hold the move back (409 `recruitment.employee_match`, naming them and
  what matched) until the office confirms it is a different person or a rejoining (`confirmMatch`).
- The application becomes **Joined** with `employee_id` and `joined_at`; an event names the code.
  `GET applications/:id/join` previews it: the next code, the defaults and lists, what carries over and
  what stays, the documents with a suggested type, the matches.
- **Admin:** the application page of a selected candidate shows **Move to the employee master** (the
  preview, the employment fields, the documents to copy, a staff login tick, the confirmation when a
  match is found); after it, a line links to the new employee, whose page says what came over.
- Test: `apps/api/test/recruitment-join.e2e-spec.ts`; the employee master suite still passes after the
  onboarding was split for use inside a transaction.


## Part 5 — who approves, the approver's page, the public link (migration 0201, built)

Decisions (20 Oct 2026): a level is **named employees, everyone holding a designation, or the HOD of the
vacancy's department**; a vacancy **waiting follows the set-up at once** (levels already approved stay);
the vacancy page carries **the link, the QR, an A4 poster, WhatsApp and LinkedIn share**, and Recruitment
set-up the **careers page link and QR**; the careers page window is **a date and a time in India time**.

- **Approval levels in Recruitment set-up** (`GET/PUT people/recruitment/setup/approval`): up to six
  levels, each a name, who approves and a reply time. Saved into the workflow definition
  `vacancy_approval` with a new resolver kind `staff` (`by` employees | designation | hod) and the level
  flag `autoSkip`. Checked on save: picked employees must be able to sign in, a designation must be in
  Staff setup and held by someone who signs in, an HOD level needs at least one department with an HOD.
  A level set before under Workflow is shown as it was (a named user becomes its employee; a role stays
  until changed). Workflow → Approval set-up lists Vacancy under "set in the module".
- **HOD of a department:** `departments.hod_employee_id`, the column "HOD (employee)" in Staff setup →
  Departments. The vacancy's department picks the HOD.
- **The plan (`autoSkip` levels):** the engine works the steps out again from the definition as it is now
  when the vacancy is sent, after each approval and when the set-up changes. A level counts as approved
  when someone who already approved is among its people ("Approved at an earlier level by the same
  person") or the raiser is ("Raised by this level's approver", the last level too); a level approved
  stays while its approver is still on it or the level is unchanged; a level nobody holds is skipped
  ("Nobody at this level"); the first other level waits. Sending is refused (`recruitment.no_approver`)
  when nobody at all can approve; a vacancy whose every level is the raiser's is approved as it is sent. A
  waiting vacancy nobody could approve under a new set-up stays with the people it had. Nothing is
  written when nothing changed. Steps decided by the plan go in the approval's history (event kinds gain
  `skipped`).
- **Following the set-up at once:** saving the levels, saving a department (the masters service now tells
  modules when a master's rows change: `MastersService.onChange`), saving an employee's record, and
  reading the vacancy list or a waiting vacancy re-plan the vacancies waiting; one whose waiting level
  changed people gets the event `approval_moved` ("Now with …") and the new people hear of it.
- **The approver** (`GET people/recruitment/to-approve`, `POST vacancies/:id/approve | send-back`, signed
  in only; the service checks the step is theirs or delegated to them): the header approvals show
  **Vacancies to approve** (left out of "Approval steps" so nothing counts twice); the vacancy page opens
  for anyone who takes part in its approval, without the recruitment rights, with **Approve** and **Send
  back** (a reason). The page shows every level: its people, approved or skipped and by whom, the note,
  the level waiting (overdue past its reply time). The raiser gets a push with the outcome.
- **The window:** `vacancies.opens_at` / `closes_at` (timestamps; the old dates were moved over, from the
  start of the first day to 23:59 of the last in the school's time zone). Publishing takes `opensAt` and
  `closesAt` as YYYY-MM-DDTHH:MM read as India time: the opening not in the past (a published vacancy
  keeps the one it has), the last date and time later than now, at least an hour and at most a year
  apart. A published vacancy may change its dates ("Dates changed"). The careers page lists it from the
  opening minute to the closing minute; it closes by itself (closed at its last date and time); an
  application sent after that is refused with the time it closed.
- **Sharing** (people.recruitment.view): `GET vacancies/:id/qr` (PNG), `GET vacancies/:id/poster` (A4 PDF:
  the school's band, the post and what it asks, the last date and time, the QR and the link),
  `GET setup/careers` (the school's careers page, its QR, how many posts are open); the admin route
  `/api/vacancy-share` serves them (View or `save=1`).
- Test: `apps/api/test/recruitment-approval.e2e-spec.ts`; the other recruitment suites use the new
  window and, where the school admin both raises and approves, the vacancy approved as it is sent.
