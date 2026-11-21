# Runbook: the assistant with Claude's help (docs/design/93)

|         |                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------- |
| Owner   | Mobilise platform team (holds the Anthropic API key and the schools' monthly limits)           |
| Who     | Teachers and office / admin staff of schools that switch it on; families later (see section 5) |
| Costs   | Pay as used on Mobilise's Anthropic account; each school's use on Insights → Assistant costs   |
| Default | Off: `AI_PROVIDER=local` answers with EduPro's own rules only and nothing leaves the server    |

## 1. Before switching it on

1. A data-processing agreement with Anthropic is in place (section 6), and Anthropic's commercial terms accepted
   for Mobilise's organisation in the Claude Console.
2. An API key for EduPro only, in a Console workspace of its own, with a monthly spend limit set in the Console. A
   Claude Max or Pro plan is a personal subscription and cannot be used: the ERP needs an API key.
3. The school's Assistant set-up has been reviewed with the school: who gets Claude's help (teachers, office), and
   what is sent (section 4).

## 2. Turning it on for the server

In the server's secret store (never in git, never in a chat or ticket):

```
AI_PROVIDER=hybrid
ANTHROPIC_API_KEY=<the key>
# optional: AI_MODEL=claude-haiku-5-5 (the default); AI_CLAUDE_MONTHLY_QUESTIONS=500 (each school's month)
```

Restart the API. The server uses only this key and Anthropic's address: an `ANTHROPIC_AUTH_TOKEN` or
`ANTHROPIC_BASE_URL` set on the machine for other tools is ignored (`ANTHROPIC_BASE_URL` in EduPro's own settings is
used, e.g. for a proxy). Check: Insights → Assistant → Assistant set-up shows "Help from Claude" without the "not
connected" note. To try one real call: `set -a; source .env; set +a; pnpm --filter @edupro/ai smoke:claude`.

## 3. A school's monthly limit

```
node scripts/ai/claude-limit.mjs <SCHOOL_CODE>            # the limit, this month's use, who has it on
node scripts/ai/claude-limit.mjs <SCHOOL_CODE> 2000       # the school's own limit
node scripts/ai/claude-limit.mjs <SCHOOL_CODE> 0          # Claude off for the school
node scripts/ai/claude-limit.mjs <SCHOOL_CODE> default    # back to AI_CLAUDE_MONTHLY_QUESTIONS
```

When a school's month is used up, its assistant answers with EduPro's own rules until the 1st (India time); nothing
breaks. The token budgets (`AI_USER_DAILY_TOKENS`, `AI_SCHOOL_MONTHLY_TOKENS`) still apply on top.

## 4. What leaves EduPro

- The question, with mobiles, e-mails, Aadhaar, PAN and card numbers masked, and the last four turns of the
  conversation, masked the same way.
- The approved queries the person may run (names, descriptions, inputs) — never SQL, never other people's queries.
- The rows of the query Claude chose, run with the person's own rights: at most 50, with contact columns and values
  masked. No approved query returns phone numbers, e-mails or addresses today; the masking is a second guard.
- An opaque user number for Anthropic's abuse checks. Nothing is sent for questions EduPro answers itself, or for a
  question asking to change something.

## 5. Adding families later (not done yet)

1. A new version of the "AI assistant" consent (`apps/api/src/modules/comms/consents.service.ts`) — the version
   change asks every family again. Draft:
   > **AI assistant** — The school assistant may answer my questions from my child's attendance, homework, fee and
   > notice records. Questions EduPro cannot answer itself may be sent, with phone numbers and e-mails removed, to
   > Anthropic (Claude), which processes them for the school and does not use them to train its models. I can
   > withdraw this at any time.
2. Allow `parent` and `student` in `CLAUDE_AUDIENCES` (`apps/api/src/modules/insights/assistant-settings.ts`), with
   tests; students only where a parent's new consent is on record.
3. The school's privacy notice names Anthropic as a processor.

## 6. Data-processing checklist (before the first school)

- [ ] Anthropic's data processing addendum signed for Mobilise's organisation; zero-retention or the standard
      retention recorded in the school contract.
- [ ] Data leaves India: the schools' contracts and privacy notices say so (DPDP Act cross-border rules checked).
- [ ] Mobilise's sub-processor list names Anthropic; schools are told before it is used.
- [ ] Incident route: a suspected leak through the assistant follows `incident-breach.md`.
- [ ] The key is rotated when someone with access leaves; it lives only in the secret store.

## 7. Switching it off

`AI_PROVIDER=local` and restart (everything stays on EduPro's own rules), or per school: limit 0 (section 3), or the
school's own switches in Assistant set-up. Past answers keep their "Answered with Claude" label and their audit rows.
