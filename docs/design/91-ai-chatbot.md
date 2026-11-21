# 91 — The EduPro chatbot for students, parents, staff and admin (no outside model)

**Status:** plan (21 Nov 2026). Builds on docs/design/07 (the AI layer: catalogue, rights, audit), docs/design/89
(the mobile app) and docs/design/90 (the family app layout).

## The ask

One chatbot in the mobile app — and on the websites — for students, parents, teachers / staff and admin. It answers
only from EduPro's own database and only what the person may see. With each answer it shows the record and a link to
the screen, and suggests related questions. Example: "my attendance record" → this month's figures and days, an
**Open Attendance** button, and "Days I was absent?" / "My attendance last month?" / "Apply for leave".

## Decisions (asked and answered, 21 Nov 2026)

| Question                | Answer                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Who, in the mobile app  | Students, teachers / staff, admin / principal (staff profile), and parents (upgraded)                                           |
| Students (minors, DPDP) | They may use it when a parent gave the "AI assistant" consent; otherwise it says to ask a parent                                |
| An answer               | One line, the records as a card (figures or up to 10 rows), **Open <screen>**, 3 follow-up chips, the source                    |
| Suggestions             | Both: 3 related next questions after each answer; on the start screen the person's recent questions and the role's popular ones |
| AI model                | **No outside model**: nothing leaves the server; questions are matched to the approved list by EduPro's own rules               |
| In the app              | An **Ask** button on every Home (student, parent, staff); the school may also make it a tab or shortcut (doc 90)                |
| Admin controls          | On / off per audience, a daily limit per person, topics per audience, the starter questions per audience                        |
| Voice                   | The phone keyboard's own mic only                                                                                               |

## What changes from doc 07

Doc 07 planned the Claude API (or an on-premise model) to read questions. With **no outside model**, the bot reads a
question with its own **matcher**: each approved query (the catalogue) carries its phrasings in English, Hindi and
Hinglish, the words that pick its parameters (today, this week, last month, आज, पिछले महीने, a class like VI-A, an
admission number, an amount), an answer sentence in both languages, its card, its screen and its follow-ups. The
matcher scores the question against them; a clear match runs the query with the person's rights; a near tie shows
"Did you mean …" chips; nothing near says what it can answer and shows the starter chips. Numbers always come from the
database. The rights, scopes, audit and catalogue of doc 07 stay as they are; `AI_PROVIDER` gains `local` (the default,
allowed in production); the Claude provider stays in the code, unused.

## What the person gets

- **Start screen:** a line on what it can answer for them, **starter chips** (the school's for their audience), and
  **Ask again** chips from their own recent questions.
- **An answer:** the sentence ("You were present 18 of 20 days this month — 90%."), a **card** (figures, or a short
  table of up to 10 rows with "Open … for all"), **Open <screen>** (the app's own screen; the website's page on the
  web), **3 follow-up chips** (related questions the person may ask), and the source ("From: Attendance of one
  student").
- **Not understood:** "I can answer questions about your school records, such as …" with chips; never a guess, never
  anything from outside EduPro.
- **Languages:** English, Hindi and Hinglish in; the answer in the app's language.

## Who may ask what (the catalogue)

The 47 queries of doc 07 stay (admin by role, teachers for their sections, parents for their children). Added (about
30): **students' own** — attendance (month, days absent), today's timetable, homework due, results / report card, the
exam date sheet, fees due (view), library books, the bus, notices, certificates; **staff's own** — my attendance /
punches, my leave balance and requests, my latest payslip (net pay, month), my timetable today, my substitutions,
approvals waiting for me; **parents** — the same as students for each child, plus queries and appointments; **admin**
— today's summary, approvals pending. A student is scoped to themselves, a parent to their children, a teacher to
their sections, staff to themselves; the ids come from the sign-in, never from the question.

## Admin

**Assistant set-up** (from the admin Assistant page; the audit and cost pages stay): on / off for students, parents,
teachers / staff and admin; questions a person may ask a day; topics switched off per audience (attendance, fees,
exams, homework, timetable, library, transport, HR …); the starter questions per audience (chosen from the
catalogue, in order). The audit trail keeps every question (personal details masked) as today.

## Phases (each checked complete — plan and all tests — before the next)

- **A. The matcher and the answer shape** — the catalogue's phrasings (EN / HI / Hinglish), parameter words, answer
  sentences, cards, screens and follow-ups for the 47 queries; `AI_PROVIDER=local`; the API answer gains `card`,
  `link`, `followUps`; "Did you mean" and not-understood replies; unit tests on the matcher and an evaluation set
  started.
- **B. Students' and staff's own queries** — about 30 entries; the student and self scopes; the student role gets the
  assistant right; the parent-consent rule for students; API e2e on scopes and leaks.
- **C. Assistant set-up** — migration (the settings per school: audiences, daily limit, topics, starters); the API
  enforces them; the admin page; the start screen's starters and recent questions; tests.
- **D. The app** — the Ask button on every Home; the chat for every profile with cards, Open, follow-ups, starters,
  Ask again; widget tests (light, dark, Hindi, 2× text).
- **E. The websites** — the parent, teacher and admin assistant pages with the same answer shape.
- **F. Evaluation and close** — the 200-question set across roles and languages: ≥ 95 % correct-or-declined, 0 leaks
  (doc 07 §6); docs "As built"; the full checks.

## Not in this plan

An outside AI model (kept switchable for later), voice inside the app, answers from documents or circulars' text,
actions taken by the bot (it opens the screen; the person acts there).

## As built

- **A (21 Nov 2026).** `packages/ai/src/matcher.ts`: `matchQuestion` (keywords weighted by length plus whole-phrase
  words; a tie is "did you mean"; under the threshold, or a request to change something or about the outside world,
  is none with the nearest queries) and the input readers (`readDay`, `readDays`, class, section, amount, threshold,
  top N); unit tests `packages/ai/test/matcher.test.ts`. `apps/api/src/modules/insights/catalogue-meta.ts`: each
  query's chip question (EN / HI), phrasings, screen (app path and admin / teacher / parent page), follow-ups, and
  for the family queries their own sentence and card (`tableCard`, `genericAnswer` otherwise). `AI_PROVIDER` gains
  `local` (the default, allowed in production; `mock` refused there); `AssistantService.askLocal` answers with the
  matcher: the daily allowance first, the person's queries only, "which student?" from a staff question's name or
  admission number, a missing input asked for, the answer `{answer, card, link, followUps, didYouMean,
suggestions, citations}`, the question audited masked, the conversation keeping what was shown (migration
  **0408** `ai_messages.display`). The evaluation set scores 96.5 % correct-or-declined, 0 leaks; the Sprint 14–16
  and red-team tests now check the sentence, card and source; `apps/api/test/chatbot.e2e-spec.ts` covers the shape.
- **B (21 Nov 2026).** The caller kinds are staff, teacher, family and **student** (a student login is a family of one,
  answered with "you"); staff and teachers with an employee record also get the **self** scope. 14 queries added (61
  in all): the student / child's **today's classes, coming exam papers, report cards released (held or not), library
  books, school bus, certificates, fee receipts**; a staff member's **own attendance this month, leave balance, leave
  requests, latest payslip, classes today, substitutions**; the admin's **school today** (attendance, fees collected,
  staff present). "Approvals waiting for me" is left out: the approvals inbox gathers some 33 sources, each with its
  own rights, and a single query would give a wrong count. Migration **0409** gives the standard Student role the
  assistant right; a student may ask only when a parent gave the AI assistant consent (`consent-required`, `whose:
parent`). The matcher joins apostrophes, counts two-letter Hindi words, and takes a question holding every word of a
  query's own phrasing (its chip) as a strong match. Tests: `apps/api/test/chatbot-scopes.e2e-spec.ts` (consent,
  "you", no reach to another student or staff queries, the own records, the school today, every chip question of
  every role in English and Hindi); the evaluation set 97 %, 0 leaks; family-layout and family-help tests now use a
  parents' screen (Queries) as the one a student cannot open.
- **C (21 Nov 2026).** Migration **0410** `assistant_settings` (audiences on / off, the daily limit, topics off and
  starters per audience; no row: all on, 30 a day, the standard starters). The audiences are students, parents,
  teachers (section-scoped staff) and office and admin (unscoped staff). Every question checks the audience
  (`assistant-off`, 403), the person's questions today (`ai.daily_limit`, 429) and leaves out the topics switched off;
  the catalogue ("What you can ask") too. `GET insights/assistant/start`: on, consent (`granted`, `needed` for a
  parent, `ask_parent` for a student), the starters the person may ask, their five recent questions, today's count.
  `GET / PUT insights/assistant/settings` (the audit right to read, the settings right to change; starters checked
  against the audience's questions; audited). Admin: **Insights → Assistant → Assistant set-up**
  (`/insights/assistant/setup`): who may use it, questions a day, a topics table, starter questions per audience
  (move, remove, add with search, "Use the standard ones"), save with an unsaved-changes guard, read-only without the
  right. Tests: `apps/api/test/chatbot-setup.e2e-spec.ts`; the evaluation and chip suites raise their test school's
  daily limit (they ask hundreds of questions) and run in their own batch.
- **D (21 Nov 2026).** The app (`apps/mobile/lib/family/assistant.dart`) has one chat for students, parents and staff:
  the start (`insightsStart`: the school's starter chips, **Ask again** from the person's recent questions, "n of N
  questions asked today"); each answer's figures (`FigureGrid`) or short table (record cards with money and dates),
  **Open <screen>** — the app's own screen when the person's menu has it (a screen the school hides is not offered),
  else the website's page inside the app — the sources, and on the latest answer **Ask next**, **Did you mean** or
  **You can ask** chips that ask on a tap; switched off, a parent's consent (Open profile, the start read again on
  return), a student's "ask a parent", a consent withdrawn meanwhile and today's limit (at the start or when asking).
  Title, intro and examples follow the audience; staff ask as the teachers' app and `/assistant` opens natively for
  them too. **Ask** (a floating button) on every Home when the person's menu has the assistant. Voice is the
  keyboard's mic (a line under the question box says so). Tests: `apps/mobile/test/assistant_help_test.dart` (13 on
  the assistant; light, dark, Hindi, 2× text and the accessibility guidelines), Home's Ask in `app_flow_test.dart`.
- **E (21 Nov 2026).** The websites share one server component, `AssistantChat` in `@edupro/ui` (no script: each
  question chip is a small form posting to the page's action), with `assistantWords(audience, lang)` for the title,
  intro and examples, so the parent (students and parents), teacher and admin pages show what the app shows: the
  start (starters, Ask again, today's count), the answer's figures or table, **Open <screen>** (the asking website's
  page), the sources, Ask next / Did you mean / You can ask, the language as radio buttons (Auto, English, हिन्दी,
  Hinglish), and the notes for switched off, consent ("Open profile"), "ask a parent" and today's limit. A refused
  question returns to its conversation. "What you can ask" and "Recent conversations" are folded with a count.
  Checked with axe at 1280 and 375 px on a made-up test school's conversations with cards; `/assistant` added to the
  parent and teacher accessibility lists.
