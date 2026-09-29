# Runbook: pilot go-live (M5 cut-over)

|          |                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner    | Delivery lead with the pilot school's principal and administrator                                                                                                                                            |
| Window   | A weekend at the start of a fee-quiet fortnight (no due date within seven days), after M4 (VAPT passed) and the UAT sign-offs                                                                                |
| Inputs   | `docs/data/03-etl-framework.md` and the rehearsal records, `docs/quality/uat-*.md` signed, `docs/security/vapt-*.md`, `docs/runbooks/disaster-recovery.md`, `docs/training/*.md`, `docs/release-1-freeze.md` |
| Rollback | Legacy stays read-write until step 8; a rollback before that is "stop using the new URL"                                                                                                                     |

## 0. Readiness checklist (T-14 days)

- [ ] UAT scripts for Phase 2, fees, exams/transport/library signed by the pilot's super-users
- [ ] VAPT certificate with no open critical or high finding (M4)
- [ ] Staging soak: two weeks of the shadow run at zero variance; scheduled reports and nightly jobs
      green; error budget met
- [ ] Production environment applied (`docs/design/04-environment-plan.md`), secrets in Key Vault,
      One Auth tenant configured, payment gateway in live mode with a ₹1 test refunded
- [ ] SMS/WhatsApp/email providers connected; DLT templates approved; delivery receipts mapped
- [ ] Data-protection: privacy notice published, consent purposes reviewed, retention settings set,
      DPO named, breach runbook rehearsed
- [ ] Training done: admin office (2 sessions), teachers (1 session per wing), accounts (1 session);
      in-app tours enabled; help desk rota published
- [ ] App store builds pointing at the compat gateway approved (Android and iOS); forced-update floor
      set in `compat.app_force_below`
- [ ] Freeze in force since `release-1-freeze`; only hotfixes through change control

## 1. T-7: final rehearsal

1. Full ETL dry run from a fresh legacy dump into a scratch production database; schema diff clean;
   reconciliation report (people, fees to the rupee, attendance counts, results) attached.
2. Restore drill of the production backup into a scratch server (`scripts/restore-drill.sh`); RTO met.
3. Load test against production-like staging (`perf/k6/baseline.js`, `due-date-peak.js`).
4. Go/no-go meeting: principal, administrator, accounts head, delivery lead, platform on-call.

## 2. T-1 (Friday evening): freeze the legacy

1. Announce the maintenance window to families and staff (message request approved on Thursday).
2. Legacy application switched to read-only (database user demoted; cron jobs stopped); the last
   receipts of the day printed and counted.
3. Take the final legacy dump; checksum recorded.

## 3. Cut-over (Saturday)

1. Run the ETL against production (`packages/etl`), per module, with the reconciliation report after
   each stage; stop on any mismatch outside the documented tolerances.
2. Post-load checks: RLS forced on every table (`rls.test.ts` against production), schema version,
   `app.refresh_marts()`, counts per school, five known pupils traced end to end (profile, ledger,
   attendance, results).
3. Configure the school: settings, year and terms, number sequences continued from the legacy
   (`receipt_sequences`, TC, GP, CERT), fee structures verified against the legacy for two classes.
4. Users: memberships and roles from the ETL; the principal, administrator and accounts head sign in
   with One Auth and confirm their menus; MFA enrolled for privileged roles.
5. Payments: one live ₹1 payment from a staff family's account, receipt, settlement file next morning.
6. Compat gateway: the legacy app paths rewritten to `/api/v1/compat/v1`; the current app builds sign
   in and read homework, notices and attendance.
7. Dry run of Monday morning: attendance for one section, one receipt, one notice, one WhatsApp.
8. Decision to proceed: DNS and app configuration switched; legacy remains read-only for reference.

## 4. Hypercare (weeks 1-3)

- On-site support desk for the first three school days; remote afterwards with a 30-minute response
  target.
- Daily stand-up with the school: issues list, counts (receipts, attendance marked, messages sent),
  shadow reconciliation against the frozen legacy for the first week's receipts.
- Nightly checks: jobs, outbox backlog, exports, retention purge, error rate, DR backups.
- Exit criteria: two consecutive weeks without a severity-1 or 2 issue, month-end reports accepted by
  accounts, the legacy server decommissioned to an archive dump.

## 5. Rollback

| Before step 3.8                                     | After step 3.8                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Re-enable the legacy database user; nothing to undo | Legacy back to read-write from the T-1 dump; receipts and attendance captured on the new platform re-entered from the day book and registers (exports) |
