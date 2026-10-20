# 34 · Recruitment: vacancies, candidates, screening, joining

Built in four parts (20 Oct 2026). The school's legacy had an online staff registration form with an
OTP check and a printout; it had no screening pipeline. The form's input fields were read (labels only;
the filled sample is a real applicant's and was not kept) to shape the candidate form of part 2.

## Decisions (20 Oct 2026)

- A vacancy is approved **through the levels the school sets** (Workflow → "Vacancy approval"); a school
  that has not set them gets one level, the Principal (role school_admin), made on the first submission.
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

## Part 2 — the careers page and the application (next)

The public site lists the published vacancies of a school; a candidate signs in with a code to mobile or
email, fills the application (personal details, father or spouse, qualifications, experience, training,
children, current pay and notice period, skills and activities, references, contact and addresses,
documents and photo), submits it to one or more vacancies, and sees where each stands. Fields that exist in
the employee master use its lists and checks.

## Part 3 — candidates and screening (next)

## Part 4 — from selected candidate to employee (next)
