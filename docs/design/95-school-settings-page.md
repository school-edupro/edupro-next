# 95 — School settings page (rebuilt)

## The ask (22 Nov 2026)

"System → Settings: this page's UI is not good; rebuild it."

Today the page lists every school setting (76) by its technical key (`security.break_glass_email`), grouped under
lower-case module names, each row with a raw input (JSON for lists), its own "valid from" date and its own Save.
The App layouts links sit on top.

## Decisions (asked and answered, 22 Nov 2026)

| Question                          | Answer                                                                    |
| --------------------------------- | ------------------------------------------------------------------------- |
| Layout                            | Section cards (one per area), each opening that area's form               |
| Settings that have their own page | Their area shows the value in force and links to the page that edits them |
| Technical settings                | One **Advanced** card, last, marked for support use, with careful editors |

Decided without asking:

- **Plain names.** Every setting gets a name and a help line in plain words (no keys, no "Sprint N"); the key is
  shown small under Advanced only. Its control fits it: on/off, a number with its unit (days, hours, ₹), a time, a
  time window, a choice (radio for 2–4, a searchable list for more), weekdays, roles (searchable, several).
- **One Save per area**, saving only what changed, all together (one API call, one transaction); "Applies from"
  is today unless the person picks a later date (folded). Each field says when it is not the standard value and
  offers "Use the standard value".
- **Search** on the cards page finds a setting by its name or help and opens its area at it.
- **Unknown keys** (a setting added to the API later) appear under Advanced until they are given a home.
- Rights as today: `platform.settings.view` reads, `platform.settings.edit` saves (read-only without it).

## Areas

| Area                | Settings                                                                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General             | language, session start month, section capacity, former pupils' portal days                                                                                                                                                                                    |
| Sign-in & security  | admin session hours, break-glass e-mail; sign-in mode, code channels and templates → **Sign-in settings**                                                                                                                                                      |
| Fees & receipts     | late fee rule and per day, instalment visible days, bounce charges and head, waiver approval, deposit slip limit, receipt prefixes, Tally ledgers; bill and receipt layout, copies → **Fee masters**; pay plan → **Fee rules**; payment gateway → **Gateways** |
| Admissions          | admission fee, admission number prefix                                                                                                                                                                                                                         |
| Attendance          | late after (gate), arrival window, weekly off days, absent alert channel                                                                                                                                                                                       |
| Library             | loan days, loans at once, fine per day, lost-book fee, damage share, reservations, hold days, stock reopen                                                                                                                                                     |
| Hostel              | withdrawal notice days and charge → **Hostel withdrawal settings**                                                                                                                                                                                             |
| Exams & results     | hold report cards for fee defaulters; board result rules and parents' view → **Board results**                                                                                                                                                                 |
| Alerts & approvals  | alerts per mobile per hour, anomaly alert roles, overdue approval escalation (roles, hours)                                                                                                                                                                    |
| Transport           | vehicle positions kept (days)                                                                                                                                                                                                                                  |
| Privacy & retention | days to answer a request; messages, sign-ins, visitor log, assistant conversations kept (days)                                                                                                                                                                 |
| App layouts         | Arrange the family app, Arrange the staff app (as today)                                                                                                                                                                                                       |
| Advanced (support)  | old-app holidays and student menu (rows), app versions and update message, modules on, cut-over tolerance, hypercare hours and end date, report column lists, fee reminder copies                                                                              |

## Phases (each checked complete — plan and all tests — before the next)

- **A** API: `GET platform/settings` also gives each setting's standard value; `PUT platform/settings` saves
  several at once (each checked by its schema; all or none; one audit row each). Tests.
- **B** Admin: the areas and fields (`lib/settings-sections.ts`, every API key placed or under Advanced), the cards
  page with search and counts ("3 changed").
- **C** Admin: an area's page — the form, the controls, Use the standard value, Applies from, one Save; areas with
  their own pages; Advanced's editors (rows for lists, JSON checked before saving).
- **D** Close: accessibility pages, docs, the checks.

## As built

- **A (22 Nov 2026).** `SettingsService.current` gives each setting's `default`; `setMany` checks every value by its
  key's schema (unknown keys refused) — all or none — and writes them from one date in one transaction, one
  `platform.settings.edit` audit row each; `PUT /platform/settings {values, validFrom?}` (edit right). Tests:
  `settings-batch.e2e-spec.ts` (4); permission coverage passes. (`compat-writes` fails from 22 Nov for its own
  reason: its homework is dated 21 Sep and the old-app read covers 60 days — flagged separately.)
