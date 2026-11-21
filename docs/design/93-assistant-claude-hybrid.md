# 93 — The assistant with Claude's help (hybrid)

Status: planned 21 Nov 2026 · builds on docs 07, 91 and 92 · owner: Insights

## The ask

"How to add Claude with the Assistant and use our Claude Max plan." A Max plan is a personal subscription (claude.ai
and Claude Code for the person who holds it); Anthropic's terms do not let a product serve its users from it, and
one account would carry every user's questions and limits. The product uses the **Claude API** with an API key
(pay as used). Doc 91 chose "no outside model"; this plan adds Claude **only where EduPro's own matcher cannot
place a question**, so most answers stay free, local and in the school.

## Decisions (asked and answered, 21 Nov 2026)

| Question         | Answer                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| How              | Hybrid: the matcher first; Claude for questions it cannot place and for "did you mean" ties             |
| Who pays         | One Mobilise API key in the server settings; each school's use is tracked (Assistant costs page)        |
| What Claude sees | The masked question and the records an approved query finds, contacts masked (phone, e-mail, Aadhaar …) |
| Who gets it      | Teachers and office / admin staff first; parents and students later, after the consent names Anthropic  |
| Model            | Claude Haiku 5.5 (`claude-haiku-5-5`)                                                                   |
| Monthly limit    | Set by Mobilise per school (a default for all, changeable per school); the school sees its use          |
| Label            | A small "Answered with Claude" line on answers Claude wrote                                             |

## How an answer is made

1. The person's rights, the audience switch, the daily limit and the consent are checked as today (doc 91).
2. **The matcher** picks an approved query. A clear match is answered as today (no outside call).
3. **No clear match** (nothing near, or a tie), and the school has Claude on for the person's audience, the key is
   set and the school's month is not used up: the masked question (and the last turns of the conversation, masked)
   goes to Claude with **only the approved queries this person may run** as tools. Claude chooses one (at most
   three calls); EduPro runs it with the person's rights (RLS, scope); the rows go back with contacts masked; Claude
   writes a short answer from them. EduPro adds the card, the screen to open and the follow-ups from the query it ran,
   and the label. A question that asks to change something or is not about the school stays refused locally.
4. Anything wrong with Claude (no key, the month used up, an error, a refusal, a time-out): the local "I can answer
   questions such as …" reply, never a broken chat.
5. Every question is audited masked, with the provider, tokens and an estimated cost.

## Phases (each checked complete — plan and all tests — before the next)

- **A. The Claude connection** — `packages/ai`: the Claude provider on Anthropic's official TypeScript SDK with real
  tool-use turns (tool_use → tool_result), Haiku 5.5 by default, low effort, prompt caching of the system prompt and
  tools, typed errors, a time-out, refusals handled; `AI_PROVIDER=hybrid`; Haiku 5.5's price for the cost estimate;
  unit tests with a fake API (no real calls).
- **B. The hybrid in the API** — migration 0412 (`assistant_settings.claude` per audience, `claude_monthly_limit`
  set by Mobilise); the flow above; `AI_CLAUDE_MONTHLY_QUESTIONS` (the default limit); a script for Mobilise to set a
  school's limit; API e2e against a fake Claude server (match stays local, unknown goes to Claude, the tools are the
  person's only, contacts masked, the label, the limit, the switches, errors fall back).
- **C. Set-up and the label** — Assistant set-up gains **Help from Claude** (teachers and office switches; parents and
  students shown as "after the consent names Anthropic"; this month's use of the limit; what is sent); the label on
  the full page, the window and the app; tests and accessibility.
- **D. Close** — the consent and privacy text for when families are added, the data-processing checklist, the
  runbook (the key, the limit, switching off), docs "As built", the full checks.

## As built

- **A (21 Nov 2026).** `packages/ai/src/claude.provider.ts` runs on Anthropic's official SDK (`@anthropic-ai/sdk`,
  already a dependency): Claude Haiku 5.5 by default, a 60 s (hybrid: 30 s) time-out, one retry, typed SDK errors
  mapped to `AiProviderError`, no sampling parameters (the current models refuse them). It uses **only the configured
  API key and address** — never an `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_BASE_URL` found in the server's environment,
  so a person's own Claude sign-in can never be used by the ERP. `tool-loop.ts`: `runToolLoop` (real tool_use →
  tool_result turns, the rules cached, at most three rounds, refusals reported, nothing invented) and `maskContacts`
  (contact columns and values masked). `AI_PROVIDER=hybrid` (needs the key) keeps the chat local; `claudeFromEnv`
  gives Claude with no thinking and low effort. Haiku 5.5's price (and cache reads and writes) for the cost
  estimate. Tests: `packages/ai/test/ai.test.ts` (24, with a fake API; decoy environment values ignored).
- **B (21 Nov 2026).** Migration **0412**: `assistant_settings.claude` (per audience; off until the school switches
  it on) and `claude_monthly_limit` (Mobilise's, NULL = `AI_CLAUDE_MONTHLY_QUESTIONS`, default 500). `AI_PROVIDER`
  gains `hybrid` (needs `ANTHROPIC_API_KEY`). `AssistantService.askLocal`: a clear match is answered as before; a tie
  or no match (not a "change something" question) goes to `claudeAnswer` when the school has Claude on for a
  teacher or office audience and the month is not used up — the person's approved queries as tools with their
  inputs in words (a class like VI, a section like VI-A, a student's name; EduPro finds the ids), each run in a
  savepoint with the person's rights, rows capped at 50 with contacts masked, the last four turns of the conversation
  (masked) for context, Claude's rules cached. The answer keeps the card, the screen and the follow-ups of the query
  Claude ran, is marked `by: 'claude'`, and is audited with the provider, tokens and an estimated cost; refusals and
  errors fall back to the matcher's reply. Saving Claude on for parents or students is refused until their consent
  names Anthropic. Settings show `claudeInfo` (key set, model, audiences, the month's limit and use).
  `scripts/ai/claude-limit.mjs <SCHOOL_CODE> [number|default]` for Mobilise. Tests:
  `apps/api/test/chatbot-claude.e2e-spec.ts` against a fake Claude server (no real calls).
- **C (21 Nov 2026).** Assistant set-up gains **Help from Claude**: what is sent and what is masked, a note when
  Mobilise's key is not set ("not connected on this server yet"), switches for teachers and office and admin
  (students and parents locked: "after the AI assistant consent names Anthropic"), and this month's use of the limit
  (the standard one or the school's, both set by Mobilise). An answer Claude wrote shows **Answered with Claude** (EN /
  HI) on the full Assistant page (a badge), in the floating window and in the app; EduPro's own answers show nothing.
  Checked in a browser: the set-up on Alpha (Save caught, nothing saved) and a made-up test school's Claude answer,
  with axe; the app's tests (210) include the label in English and Hindi.
