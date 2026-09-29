# Runbook: personal-data breach (DPDP Act, 2023)

|         |                                                                                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner   | Data Protection Officer of the school group with platform engineering                                                                                                                                                                    |
| Trigger | Any suspected unauthorised access, disclosure, alteration or loss of personal data on the platform or by a vendor                                                                                                                        |
| Clock   | Notify the Data Protection Board of India and the affected data principals without delay, in the form and time the Rules prescribe (working assumption: 72 hours from detection); record every step in **System → Privacy → Breach log** |
| Tools   | breach log (`breach_log`), audit log, login events, `docs/standards/logging-and-pii.md`, communication module template `breach_notice`                                                                                                   |

## 1. Detect and record (hour 0)

1. Whoever notices opens a breach record: title, detection time, what was seen, which data classes
   (names, contacts, health, financial, identifiers) and a first estimate of the people affected.
2. The record's owner is the DPO; the platform on-call is added.
3. Preserve evidence: export the audit log and login events of the window (**System → Audit**,
   Excel), keep the worker and API logs of the period (they carry request ids, never personal values).

## 2. Contain (hours 0-8)

1. Revoke or rotate what was abused: service keys (**System → Service keys**), device keys, user
   sessions (**System → Security** → end sessions), vendor credentials in Key Vault.
2. If a role or permission enabled the access, remove it and record the change; break-glass access is
   audited and time-boxed by default.
3. If the platform itself is compromised, freeze deployments and follow `disaster-recovery.md` for a
   clean restore point.
4. Set the breach status to **contained** with the actions taken.

## 3. Assess (hours 8-24)

1. Establish the facts: data classes, number of principals, children involved, whether data left the
   platform, whether it was encrypted, whether the vendor is involved.
2. Decide the risk to the principals with the DPO; document the reasoning in the record.
3. Prepare the notices: the Board's form, and the principals' notice from the `breach_notice`
   template (what happened, what data, what the school did, what the principal should do, whom to
   contact).

## 4. Notify (before hour 72)

1. Board of India: send the prescribed intimation; set **Board notified** on the record (the timestamp
   is kept and the hours-since-detection shown).
2. Principals: send the `breach_notice` through **Communication → Requests** to the affected
   recipients (a `service` message: it goes regardless of marketing consent); set **Principals
   notified**.
3. Vendors and the group's legal counsel as the contract requires.

## 5. Close and learn

1. Post-mortem within ten working days: root cause, what detection missed, what changes ship, owners
   and dates; attach it to the record and set the status to **closed**.
2. Update the threat model (`docs/design/03-…` to `06-…`) and, where a control was missing, raise the
   backlog item with the sprint that will carry it.
3. Review the retention settings if the breach touched data that should already have been purged.

## 6. Roles

| Role             | Does                                                     |
| ---------------- | -------------------------------------------------------- |
| Reporter         | Opens the record with what was seen                      |
| DPO (owner)      | Assessment, Board and principal notices, closure         |
| Platform on-call | Containment on the platform, evidence, restore if needed |
| School principal | Communication with families and staff, press if any      |
| Vendor contact   | Containment and evidence on the vendor side              |
