# Pilot retrospective (Sprint 23, rehearsed on the demo school)

The pilot school did not go live in this environment, so this retrospective covers the rehearsal of
the cut-over and hypercare tooling on the demo school and the twenty-three sprints behind it. It is
to be re-run with the school after the live hypercare exits.

## What went well

- The runbook became a checklist in the product. Steps are ticked with a name, a time and a
  duration, so a rehearsal's timing is a report, not a memory.
- Reconciliation is a gate, not a glance: the sign-off refuses when a count differs beyond the
  tolerance, and the difference is shown per measure.
- Staff report where they work. The teacher app's **Report an issue** lands on the hypercare board
  with a severity and a due time; the admins get one digest a morning instead of a chat thread.
- The month-end close turns the "first live month" comparison into eight checks and a pack; a closed
  month cannot receive back-dated receipts.
- The compatibility layer means the current apps keep working through the cut-over; the app store
  update is not on the critical path.

## What was hard

- Operational sprints without an environment: monitoring, on-call and capacity work stayed at the
  level of scripts and runbooks. The first real signal will come from staging.
- Two consecutive plan rows (S22, S23) are almost entirely people activities (training delivery,
  rehearsals with the school, hypercare). The tooling is ready; the calendar is the school's.
- The DR drill cannot run on the development laptop (no client binaries); it must be a staging job.

## What we change for the waves

| Change                                                                      | Where                                      |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| A cut-over run per wave school, created from the playbook two weeks ahead   | `docs/runbooks/rollout-playbook.md` week 1 |
| Feature flags set before training, not after the first confusion            | playbook week 1                            |
| Hypercare digest recipients include the wave's delivery lead (role setting) | backlog: `hypercare.digest_roles`          |
| Month-end close rehearsed in UAT on rehearsal data, not only after go-live  | `uat-fees.md` row to add                   |
| Synthetic check wired to the monitor on day one of staging                  | on-call runbook section 1                  |

## Open questions for the school

1. Which modules stay hidden in the first two weeks (feature flags)?
2. Who owns the hypercare board on the school side (front office or coordinator)?
3. Which legacy reports are the reference for the reconciliation counts?
