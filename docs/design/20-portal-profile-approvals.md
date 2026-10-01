# 20. Portal profile, field policy and profile approvals (2026-10-01)

Post-freeze change requested by the school after the student 360 profile (design 19). Benchmarked on
the profile-update flows of Entab CampusCare, Fedena, Teachmint, MyClassboard and PowerSchool: a
school-controlled field matrix, update drives, proof documents, routed and multi-level approval,
field-level decisions and bulk approval.

## Decisions (with the school, 2026-10-01)

| #   | Question                         | Decision                                                                       |
| --- | -------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Levels                           | Hidden, view only, edit with approval, edit direct; parents and students apart |
| 2   | Rule scope                       | Approvers per section, with per-field override                                 |
| 3   | Approvers                        | Office, class teacher, role, named employee; the school picks one or two steps |
| 4   | Partial approval                 | Yes, field by field                                                            |
| 5   | Proof                            | Per field (defaults: birth certificate, residence proof, category, Aadhaar)    |
| 6   | Update window                    | Open, closed or a period with a message                                        |
| 7   | Who edits                        | Both parents; a parent's change reaches every child linked to that parent      |
| 8   | ID numbers on the portal and PDF | The family sees its own child's Aadhaar, PAN and bank numbers in full          |
| 9   | Parent PDF                       | "Parent copy" with the declaration and signature lines                         |
| 10  | Beta Public School               | Every Alpha role login, with the day-to-day data behind each screen            |
| 11  | Bypass                           | Administrators decide at any step (final); "edit direct" skips approval        |

## Model (migration 0041)

- `profile_portal_policies` (one row per school): `fields` `{parent|student: {key: level}}`,
  `proofs` `{key: document kind}`, `edit_window`, `approval` `{default, sections, fields}` with routes
  of one or two approvers. Missing values resolve to defaults in `packages/db/src/profile-portal.ts`
  (`resolvePolicy`); office-owned and computed fields can be shown but never opened for editing.
- `profile_change_requests` gains `audience`, `route` (copied at submission so policy edits never
  move requests in flight), `current_level`, `proofs`, `submission` (one submission is split into one
  request per route) and `auto_applied` (edit-direct history). Statuses add `partially_approved` and
  `cancelled`. Each changed field carries its own status and note; ID numbers are stored encrypted.
- `profile_change_actions`: every decision (level, per-field outcome, note, actor).
- Permissions: `engagement.change_request.approve` (act when the route names me; staff roles),
  `engagement.change_request.override` (any step, final; administrators),
  `people.portal_profile.manage` (the settings); parents and students may upload files (proofs).

## Flow

1. The portal reads `GET /engagement/mine/profile/:student` (fields filtered by the audience's levels,
   pending values, window, photos). `POST …/changes` validates through the profile rules, refuses
   fields not opened, checks proofs (uploaded by the same user), writes edit-direct fields at once
   and files one request per approval route. A field already waiting cannot be asked again.
2. `GET /engagement/profile-approvals?box=mine|all|decided` resolves "awaiting me" from the route
   step: office = holds `engagement.change_request.decide`; class teacher = class teacher of the
   student's section; role = holds the role; user = that user. Override holders see everything.
3. `POST …/:id/decide` with `approve` or `fields` (partial). Refusal needs a note. At the last step
   (or on override) accepted fields are written through the profile writer after a stale check (the
   value on file must still be the one the family saw), proofs join the student's documents and
   tick the checklist. `POST …/bulk` decides many, each in its own transaction.
4. The parent PDF reuses the `student_profile` renderer with `audience`; the worker re-checks the
   family link and prints only fields the audience may see.

## Beta Public School

`pnpm --filter @edupro/db seed:beta` (after `seed:demo`, API running): logins `dev-beta-principal`,
`-coordinator`, `-teacher` (class teacher III-A), `-subject` (maths I-A, II-A), `-auditor`, `-clerk`
(front office school role), `-accounts`, `-parent` (two children in III-A), `-student`, `-nobody`;
then attendance, homework, notices, fee demands and receipts, a bus route, library loans, an exam
with marks, a parent query, feedback and a profile change through the API. Idempotent.
