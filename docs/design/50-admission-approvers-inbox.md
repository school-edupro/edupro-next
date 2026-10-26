# 50 — Admission approvers: an inbox for the people named in a level, the review screen, remarks by level (plan, 26 Oct 2026)

The Balvatika process (Class I, VI, IX of "Admissions 2027-28") has Document check in two levels:
level 1 **Anita Deshmukh** (TGT English, a teacher, staff app), level 2 **Arjun Bhat** (Accountant,
admin app). Neither sees anything:

- Anita's roles (class / subject teacher) have no admission permission, and the staff app has no
  admission screen;
- Arjun's Accountant role has only `admissions.fee.collect`: no Admissions menu, no Registrations;
- deciding needs `admissions.application.decide` even for the people a level names
  (`canAct`, `app.admission_level_users`), so both levels show "Nobody yet (set-up managers only)".

What the best do (Entab, Edunext, LeadSquared approvals): naming a person in a process is the
access; they get an **Approvals inbox** where they sign in, with only what waits at their level; each
opens a **review screen** (candidate, form, documents, points) with a remark and the decision; every
level's remark stays and shows in the lists, on the registration and in the reports.

## Decisions (asked and answered, 26 Oct 2026)

| #   | Question | Decision                                                                                                                                                            |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Access   | **Named in a level is enough**: a person (or designation / role) a level names sees and decides only the registrations waiting at that level — no permission needed |
| 2   | Where    | **Both apps**: teachers in the staff app (menu "Admission approvals"); office staff in the admin app (header approvals, Registrations → Waiting for me)             |
| 3   | Review   | **All four**: a remark for every decision; may award points differently (with a reason) at Document check; see the documents; send back to the family               |
| 4   | Remarks  | **Everywhere**: approval list columns per level (who, decision, remark, when); the registration page by stage and level; the score report and its Excel / PDF       |

Defaults taken (change on request): "anyone" levels still need the decide permission (they name
nobody); set-up managers keep deciding anywhere; an approver sees a registration while it waits at
their level and, after deciding, read-only in "Decided by me" for 30 days; the remark is 3–1000
letters; Approve / Hold / Reject / Send back as now (Offer and waiting list stay with Selection).

## Parts

**Part 1 — Access by being named (API; migration 0259) — built 26 Oct 2026.** `app.admission_level_users` names the
people of person / designation / role levels without the decide permission ("anyone" keeps it);
`canAct` likewise. New routes for approvers, open to any signed-in staff and checked per registration
(waiting at a level they are named in, or decided by them): `GET admissions/approvals` (Waiting for me
and Decided by me, with each level's remark), `GET admissions/approvals/:id` (the review: candidate,
answers, documents, points, the stage path with remarks), `POST …/:id/decide` (remark required),
`POST …/:id/send-back`, `POST …/:id/points`. The header approvals count and the morning email
(docs/design/47) reach them now.

**Part 2 — The review screen (admin and staff app) — built 26 Oct 2026.** One component in both apps: candidate card
(photo, class, category, number), the points table with "award differently" (reason), the documents
as View / Download icons, the form's answers by tab, the stage path with each level's decision,
remark, who and when; the remark box and Approve / Hold / Reject / Send back (fields to correct).
Admin: `/admissions/approvals` (+ the header approvals link); staff app: menu **Admission approvals**
(`/admission-approvals`) for anyone named in a level.

**Part 3 — Remarks by level everywhere — built 26 Oct 2026.** Admissions dataset fields `level_remarks` ("Document check
· L1 Anita: papers fine · L2 Arjun: ok"), and per stage-level columns in the approvals list; the
registration page's stage path shows them; the score report gains "Document check L1 / L2" columns
(screen, Excel, PDF).

**Part 4 — Check with the sample data — built 26 Oct 2026.** Sign in as Anita (dev-teacher) in the staff app: the 50
Balvatika registrations wait; approve one with a remark, award a point differently, send one back,
hold one; sign in as Arjun (dev-accounts): only the one Anita approved waits at level 2; approve with a
remark; both remarks in the lists, the registration page and the score report. e2e cases for access
(not named: 404; named, other level: refused) and the remark required.

As built (26 Oct 2026): `app.admission_level_users` (0259) and `canAct` name a level's people without
the permission ("anyone" keeps it); routes `admissions/approvals` (list, review, decide with a remark,
send back, points, files — `AuthenticatedOnly`, each registration checked); the shared `AdmissionReview`
(packages/ui) on `/admissions/approvals/[id]` (admin) and `/admission-approvals/[id]` (staff app, menu
item when something waits or was decided); remarks in the approvals list (a column per stage level),
the registration page, the Admissions dataset (`level_remarks`) and the score report (screen, Excel,
PDF line under each row). Checked on the sample data: Anita confirmed a point (6 → 8 with her reason)
and approved with a remark, held one, sent one back; Arjun saw only the one she approved, with her
remark, and approved it; both remarks show everywhere. The family email of the test send-back was
cancelled (a sample address).
