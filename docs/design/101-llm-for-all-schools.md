# 101 — An LLM of our own for all schools: its address and token in settings, a test panel

## The ask (23 Nov 2026)

"On http://localhost:3000/system/settings: I have an LLM's URL and a Bearer token to use in this project. I will
enter them in a form in the settings and you use them. The call:

    curl --location 'http://localhost:8080/v1/chat' \
    --header 'Content-Type: application/json' \
    --header 'Authorization: Bearer {token}' \
    --data '{ "prompt": "Explain Python decorators in 2 lines" }'

After the credentials are saved, a page there to test it. Ask first if anything is unclear."

Today the AI is set in the server's `.env` (`AI_PROVIDER` local / hybrid / claude, `ANTHROPIC_API_KEY`;
docs/design/07, 91–93): the assistant's own matcher answers, Claude (hybrid) takes the questions it cannot place,
the AI reports write their narratives from a template (or Claude), and the board result reader uses Claude for an
unknown file layout. `/system/settings` is School settings (docs/design/95): one school's settings, area by area.

## Decisions (asked, 23 Nov 2026)

- **Where it is used: the Assistant and the AI reports** (recommended). The assistant's questions its matcher cannot
  place (where Claude is used today) and the AI report narratives. The board result reader stays as it is (strict
  JSON layouts).
- **One LLM for all schools** (not per school): entered once for the server.
- **The reply is found automatically** (recommended): the usual JSON fields — `response`, `answer`, `text`, `output`,
  `message`, `content`, `reply`, `result`, `data.…` of those, `choices[0].message.content`, `choices[0].text` — or the
  body itself when it is plain text; an optional **Reply field** in the form (a dotted path such as `data.reply`)
  covers anything else; the test panel shows the raw reply too.
- **Your LLM only** — when it is set and on, Claude is not used at all (not even when the LLM fails); without it,
  things stay as today.
- **Who edits: a new right, off for all** (recommended): **AI model for all schools** (`platform.ai_model.manage`),
  in no role. Mobilise makes the first grant (a script, as the Claude limit is set); after that only someone who
  holds the right may give it to a role, take it from one, or give a role that carries it to a person — a school's
  own admin cannot give it to themselves. Everyone else sees only their school's part.
- **Each school decides** (recommended): off until the school turns it on — the Assistant set-up's **Help from
  Claude** switches become **Help from the AI model** (staff only, as today), and a School settings switch **AI
  reports written by the AI model**.

## Design

- **Stored once, kept secret.** Table `ai_model_settings` (one row, no `school_id`): `url`, `token` (encrypted with
  `encryptField`, as the payment gateways' keys), `token_last4`, `reply_field`, `timeout_seconds` (5–120, default
  30), `on`, `updated_by`, `updated_at`, the last test (`tested_at`, `test_ok`, `test_note`). Forced row-level security
  with only the migrator policy; read and written through SECURITY DEFINER functions (`app.ai_model_get()`,
  `app.ai_model_save(…)`, `app.ai_model_tested(…)`). The token never leaves the API: the form shows `••••` and its last
  4 characters, and an empty token box keeps the saved one.
- **The address.** `http://` or `https://` only, no user or password in it, up to 500 characters; any host (a model on
  the same machine or the school's network is the point). Only holders of the right set it.
- **The call** (`packages/ai/src/http-llm.provider.ts`, `HttpLlmProvider implements AiProvider`): `POST <url>` with
  `Content-Type: application/json`, `Authorization: Bearer <token>` and `{"prompt": "…"}` — the instructions, the
  conversation and the question written into the one prompt (the sample takes nothing else); a time limit; an
  answer read as above; a refusal (HTTP 4xx/5xx, no answer found, time out) as `AiProviderError` with what went wrong
  in words (never the token).
- **The assistant with the LLM** (no tool calls in a prompt-only API): two prompts. First the rules, the person's
  approved queries (id, what it answers, its inputs in words), the last turns and the question — answer with one JSON
  line `{"query": "<id>", "inputs": {…}}`, or `{"answer": "…"}` when no query is needed or none fits. The query runs as
  the person (the same `toolParams` and masked rows as Claude's), then the second prompt: the question, the query's
  title and its rows (up to 50) — the short answer in the person's language. Labelled `by: 'llm'`; counted in the
  school's monthly limit of outside-model answers as Claude's are (`ai_audit.provider` `llm`).
- **AI reports**: when the LLM is on and the school's **AI reports written by the AI model** is on, `writeNarrative`
  runs on the LLM (the same facts, citations checked as now); else the template, as today.
- **API.** `GET /platform/ai-model` — for holders of the right: the form's values (no token: its last 4), on, who
  changed it and when, the last test; for anyone with `platform.settings.view`: only whether an AI model is set up
  and on, and this school's switch. `PUT /platform/ai-model` (the right; audited without the token). `POST
/platform/ai-model/test` {prompt} (the right) — the saved settings, the prompt as given: `{ok, status, ms, reply,
field, raw}` (raw cut to 4,000 characters), and the result kept as the last test.
- **Admin.** School settings gets an area card **AI model (LLM)** opening `/system/settings/ai-model`: for holders,
  **For all schools** — URL, token, reply field, time limit, On — Save; then **Test**: a prompt (the sample's by
  default), Send, the answer, the HTTP status, the time taken, the raw reply (folded). For the school: whether the
  server has an AI model and it is on, the switch **AI reports written by the AI model**, and a link to Assistant
  set-up for the assistant's switches. Assistant set-up's Claude card speaks of "the AI model" (your LLM or Claude,
  whichever the server uses).
- **First grant** — `scripts/ai/ai-model-admin.mjs <SCHOOL_CODE> <user sub or e-mail> [remove]`: a role **AI model
  for all schools** in that school with the right, given to the person (as the database owner, like
  `claude-limit.mjs`).

## Phases (each checked complete — plan and all tests — before the next)

- **A** the store and the right: migration 0415 (the table, its functions, the right, the school setting
  `ai.reports_model`), the right given only by its holders (roles and people), the provider with the reply reading,
  the API routes (read, save, test), the first-grant script.
- **B** used: the assistant through the LLM (the two prompts) when it is on and the school's switch is on, the
  monthly limit, the AI reports' narratives.
- **C** the admin pages: the area card, `/system/settings/ai-model` (the form and the test panel; the school's part),
  Assistant set-up's wording.
- **D** tests (API e2e against a made-up LLM server: rights, save, the token never returned, test, the assistant and a
  report through it, Claude not used; unit tests of the reply reading and the prompts; the admin accessibility walk),
  help, then the user's own trial on the dev server (the user enters the URL and token; Claude never types them).

## As built

- **A (23 Nov 2026).** Migrations **0415** (`ai_model_settings`, one row, forced row-level security with only the
  migrator's policy; `app.ai_model_get()`, `app.ai_model_save(…)`, `app.ai_model_tested(…)`; the right
  `platform.ai_model.manage` in no role) and **0416** (saving with the token box empty keeps the token: 0415's upsert
  put the empty token into the new row first and the NOT NULL check refused it). `common/access/holders-only.ts`:
  `HOLDERS_ONLY`, `assertMayPassOn` / `assertMayGiveRole` — a role made, changed (given or taken), switched on again,
  given to a person, given longer, or given with an invitation, refused (403 `access.holders_only`) when it moves a
  holders-only right the person does not hold. `packages/ai/src/http-llm.provider.ts` (`HttpLlmProvider`, `readReply`,
  `valueAt`, `promptOf`; the token masked in anything shown). API `insights/ai-model.service.ts` +
  `ai-model.controller.ts`: `GET / PUT /platform/ai-model`, `POST /platform/ai-model/test` (the token decrypted only
  to call; the audit's `token` masked as `***` by the audit layer). School setting `ai.reports_model` (off).
  `scripts/ai/ai-model-admin.mjs` (the first grant). Tests: `packages/ai` (the reply reading, the prompt, the call, the
  failures in words), API `ai-model.e2e-spec` (the grant, holders only, the token never returned and stored encrypted,
  the address checked, the test, a field of its own, a wrong token, nothing listening; the server's row put back).
- **B (23 Nov 2026).** The assistant: `ask` takes the local path with the AI model's help when it is on (the school's
  switches and audiences as Claude's); `claudeAnswer` hands over to `modelAnswer` (two prompts: a query from the
  person's list, or an answer when none fits, read from one JSON line found anywhere in the reply; the query run as the
  person in a savepoint, its rows masked; the answer written from up to 50 rows); `by: 'llm'`, `ai_audit.provider`
  `llm`, counted in the monthly limit with Claude's; any fault → no help (never Claude). Assistant set-up's
  `claudeInfo` gives `provider` (`llm` / `claude`) and the model. AI reports: `writeNarrativeWith(model, otherwise,
input)` in `packages/ai/src/narrative.ts` — the API's Run now and the workers' Monday job use the AI model when it is
  on and the school chose it; a failure or uncited facts → the template. Tests: `ai-model.e2e-spec` (the assistant
  through a made-up model — the two prompts, the token, Claude's address never called, the count; the model down →
  EduPro's own answer; a report by the model, the template when not chosen, down or switched off).
- **C (23 Nov 2026).** Admin: School settings has the area **AI model (LLM)** (`settings-sections.ts`), its own page
  `/system/settings/ai-model` — for holders the form (address, token as a password box showing `Saved ••••last4`,
  reply field, time limit, On for all schools; **Save for all schools**) and **Test the saved model** (a prompt, Send,
  the answer, HTTP status, time, field, the raw reply folded, the last test); for others whether one is set up; then
  **This school** (AI reports written by the AI model) and **The assistant** (a link to Assistant set-up). Assistant
  set-up says **Help from the AI model** when it is the one helping. The answer's label: "Answered with the AI model"
  (web window, chat page, the app; Hindi too).
- **D (23 Nov 2026).** Checked in a browser as a holder on a test school (since removed): save, the token box empty
  after with `Saved ••••heck`, the test answered by a stand-in server, the raw reply, axe clean (an in-text link
  underlined, the two Save buttons named apart), a phone's width without sideways scroll; the admin's accessibility
  walk has the page (as a non-holder). Suites: API `ai-model` (5), access / permission coverage / break-glass, the
  Claude, chatbot and assistant suites (30), AI reports; `packages/ai` (28), RLS (11); app 327 (the AI model label).
  Runbook `docs/runbooks/ai-model.md`.

- **Doc 102 (23 Nov 2026)** takes this further: the model never answers in its own words, "how do I …" from the help pages, and parents and students once who runs the model is named and a parent agrees.
