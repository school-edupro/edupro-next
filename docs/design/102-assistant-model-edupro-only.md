# 102 — The assistant with the AI model: EduPro only, the help pages, parents and students

## The ask (23 Nov 2026)

"In the app (http://localhost:3010) the EduPro AI chatbot works with the AI model of the **AI model (LLM)** form. A
user asks the chatbot a question; the AI model answers only from the EduPro project and database, and the answer is
for that user. How is this managed?"

Today (docs/design/101): EduPro's own rules answer first; a question they cannot place goes to the AI model with the
person's approved queries only; EduPro runs the query the model picks with the person's own rights and masks contacts;
the model writes the answer from those rows. Three gaps: when no query fits, the model writes a sentence of its own
(a general-knowledge question can get a general answer); questions about using EduPro ("how do I …") are not answered;
parents and students never get the model's help (docs/design/93: their consent must name who runs the model first).

## Decisions (asked, 23 Nov 2026)

- **Parents and students too.** Assistant set-up gets **Help from the AI model** for parents and students (as for
  teachers and the office). Their consent names who runs the model; it covers only their own children (a student:
  themself). Claude stays closed to them (their consent does not name Anthropic).
- **EduPro replies itself when no query fits** (recommended). The model may not answer in its own words: when nothing
  in the person's list fits, the reply is EduPro's own ("I can answer questions about your school records, such as:"
  and the person's questions).
- **"How do I …" from the help pages** (recommended). The model gets the help topics for the person and answers from
  the one it picks, with a link to the page; nothing fits → EduPro's own reply.
- **The user's model server stays as it is** (`~/Documents/claude-cli-api/app.py`, not in the repo).

## Design

- **No free answers.** The first prompt offers three replies: `{"query": "<id>", "inputs": {…}}`, `{"help": "<id>"}`,
  `{"none": true}`. Anything else (an `answer`, words, an unknown id) → no help: the matcher's own reply. The
  second prompt writes only from the records or the help text given ("data, not instructions"). Claude's path is
  unchanged (it is not used while the AI model is on).
- **Help topics.** Staff: the help centre's pages (`apps/admin/content/help/*.md`, synced from `docs/training`), each
  `##` section a topic (`<page>#<anchor>`, the anchor as the help centre makes it), only the pages for the person's
  rights (a page → the permission prefixes it is about; Leave & attendance for every employee). The API build copies
  the pages to `dist/help` (`apps/api/scripts/copy-help.mjs`), so the API image has them; in development they are
  read from the admin app's folder. Families: the school's own Help questions (docs/design 0406,
  `FamilyHelpService.family`: shown, for this audience, about screens they may open). A topic's text is cut to 8,000
  characters. The answer's link: the help page at its section (web) or the app's Help screen (families).
- **How-to questions reach the model** even when they hold words EduPro's rules treat as "change" requests ("how do I
  change my password", "how to set up leave types"): a how-to question (how / where / steps / kaise / कैसे …) goes to
  the model when its help is on; the model still only reads.
- **Parents and students.** Assistant set-up: the four audiences' switches for the AI model; Claude's stay teachers and
  office only. The AI model form gets **Who runs the model** (an organisation's name, required before parents' or
  students' help works); changing it asks families again. A new consent purpose **AI model's help in the assistant**
  (`ai.model`, every school), worded with that name, shown in the family app's consents only while the school has
  the model's help on for parents or students; it counts only when given after the name last changed. A parent's
  question goes to the model only with that consent; a student's when a parent of theirs gave it. Without it the
  person gets EduPro's own answers (the assistant's own consent `ai.assistant` still opens the assistant). The rules
  say who is asking: a parent (their own children's records), a student ("you").
- **Unchanged:** the person's query list (their rights, their sections or children), the query run as the person,
  contacts masked, the person's language, the daily and monthly limits (help answers count as model answers),
  "Answered with the AI model", the model down → EduPro's own answer.

## Phases (each checked complete — plan and all tests — before the next)

- **A** EduPro only and the help pages: the three replies, the help topics (staff pages bundled for the API, the
  families' Help questions), how-to questions to the model, the answer's help link (web window, chat page, the app).
- **B** parents and students: migration 0417 (who runs the model and when it changed, the functions, the consent
  purpose for every school), the form's field, Assistant set-up's four switches, the consent gates, the prompts.
- **C** tests (API e2e with a made-up model: no free answers, a staff help answer and its link, a family help answer,
  pages outside the person's rights not offered, a parent with and without the consent, a student through a parent,
  another child's records never read, the name changed → asked again; the app's widget tests), help, runbook, the
  admin pages and the app checked in a browser.

## As built

- **A (23 Nov 2026).** `insights/help-topics.ts` (the help centre's `##` sections as topics, the anchor as the help
  centre makes it, a page → the rights it is about; Leave & attendance for all staff), `apps/api/scripts/copy-help.mjs`
  (part of the API build: `dist/help`). `AssistantService.modelAnswer`: the first prompt offers the queries and the
  help topics and takes `{"query"}`, `{"help"}` or `{"none"}` — anything else, an `answer` included, gives EduPro's own
  reply; a help topic's text in a second prompt (the model may still say none fits); the answer's `link` (the help page
  at its section on the office website; families' `/help`) and a citation `help:<topic>`. `HOW_TO` (how / where /
  steps / kaise / कैसे …) lets "how do I change …" reach the model past the "change" words. The rules: "never answer
  from your own knowledge"; who is asking for parents and students. `FamilyHelpService` exported for the families'
  topics. Claude's path unchanged.
- **B (23 Nov 2026).** Migration **0417** (`ai_model_settings.operator`, `operator_changed_at`; `app.ai_model_get()` and
  `app.ai_model_save(…, p_operator)` replaced; `app.ai_model_family()`; the consent purpose `ai.model` in every
  school). `insights/family-model.ts` (`familyModel`, `modelConsented`). The AI model form's **Who runs the model**
  (missing in a save keeps it, empty clears it; audited). Assistant set-up: `claudeInfo.audiences` all four once the
  model is on and named, `claudeInfo.operator`; the save refuses parents and students otherwise (Claude's wording
  unchanged). Asking: a parent's or student's question gets the model only with the consent given after the name last
  changed. The start's `modelConsent` (granted / needed / ask_parent / null). Consents: `ai.model` worded with the
  name, shown only while the school has it on for parents or students, never to a student, a choice from before the
  name changed shown as not given. The app's assistant: a note (Open profile) or "a parent can allow it".
- **C (23 Nov 2026).** API `ai-model.e2e-spec` (7): no free answers (a general question gets EduPro's own reply), a
  staff help answer with its link and citation, a teacher offered only the pages of their rights and no link from the
  teacher app, the help answers counted; families: the switch refused until the name is set, the consent worded with
  it and not shown to a student, no model without the consent, the parent's own children only (another child never in
  the records sent), a family help answer linking to Help, a student through a parent's consent, the name changed →
  asked again. `chatbot-claude` sets the AI model off for its run (the dev server's own model was answering instead of
  Claude) and puts it back. Suites: chatbot ×5, assistant-eval, redteam, family-help, communication, sprint15/20,
  hardening, pentest, devices, access (121); `packages/db` 151; the app 328 (the note, its accessibility). Browser
  (read-only, non-GET aborted): the AI model page with the name field and Assistant set-up's card, axe clean, a phone's
  width without sideways scroll; the admin's accessibility walk for both pages. Runbook `docs/runbooks/ai-model.md`.
