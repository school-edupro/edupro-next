# Rollout playbook for the next schools (from the pilot, Sprint 23)

Every wave (Sprints 26 to 37 of the plan) follows the same six weeks. The tooling built for the pilot
carries it: cut-over runs with timed steps, snapshots and sign-off (**System → Cut-over**), hypercare
issues with SLAs and the morning digest (**System → Hypercare**), the pilot feature flags
(`platform.modules_enabled`), the help centre and the training pages, the month-end close.

## Week 1-2: prepare

1. School onboarding: the school row, campuses, the academic and financial years, the users of the
   office; the group admin clones masters from the reference school (**Masters → Clone**).
2. Schema diff of the school's legacy database against the ETL map (`scripts/schema-diff.sh`); ETL
   configuration per school (`packages/etl` fixtures); templates for report cards and documents.
3. Training schedule booked per role; the help centre and tours checked in the school's language.
4. Feature flags set for the school's first weeks (hide what the school will not use yet).

## Week 3-4: rehearse

1. Cut-over run "rehearsal 1": ETL dry run, reconciliation, timing of every step; the run is signed off
   only when counts match within tolerance.
2. UAT with the school's super-users on the rehearsal data; scripts under `docs/quality/`.
3. Fix list into the backlog; feature flags adjusted; rehearsal 2 if rehearsal 1 exceeded the window.

## Week 5: cut over

The go-live runbook (`go-live.md`) executed as the "final" run: the weekend window, the legacy set
read-only, the final ETL, the sign-off, the switch. Hypercare starts on Monday with the on-site desk.

## Week 6+: stabilise

Hypercare per `on-call.md` until two weeks without S1/S2 and the first month-end close accepted; then
`platform.hypercare_until` is set, the digest stops, the legacy is archived, and the retrospective feeds
this playbook.

## Lessons from the pilot (rehearsed on the demo school)

| Lesson                                                                        | Applied as                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Counts must be reconciled before anyone signs; "it looks right" is not a step | The sign-off refuses while a measure differs beyond the tolerance |
| Timing each step exposes where a rehearsal loses hours (ETL, verification)    | Durations per step and per phase on the run                       |
| Staff report problems where they are: in the teacher app, not by email        | Report an issue in the teacher app lands on the hypercare board   |
| The first month-end is where the legacy comparison really happens             | Month-end checks and pack; the runbook compares line by line      |
| Hidden modules avoid questions about screens nobody was trained on            | Feature flags per school                                          |
