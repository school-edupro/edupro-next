# 103 — Data questions in the chatbot (NLQ): the AI model writes the query, EduPro runs it

## The ask (23 Nov 2026)

"Now that the LLM key is added, I want to generate dynamic reports and complex data from the database." Then, when
asked about saving and scheduling: "I do not need a report builder; I just want a dynamic chatbot that runs SQL
against our database and finds the complex data as per the user's prompt" — the answer "a combination of charts,
text and tabular representation", plain on screen.

Step 1 is done: the whole database read and written down (`docs/data/README.md`, a guide per module,
`schema.json`). This doc plans step 2.

## What EduPro has today

- **The chatbot** (docs 91–93, 101–102): EduPro's own rules first; then the AI model picks one of 61 approved queries
  (or a help page) — it never writes SQL. Good for "who is absent today", not for "fee collected by class this
  month against last year" or "teachers whose classes average below 50 % in maths".
- **Answer cards**: `figures` and `table` (`catalogue-meta.ts` `Card`), shown in the web window, the chat page and the
  app.
- **Charts**: hand-drawn SVG `BarChart`, `PercentBarChart`, `LineChart`, `DonutChart` in
  `apps/admin/components/charts/Charts.tsx` (admin only); none in the app.
- **The AI model for all schools** (doc 101): prompt in, text out, ~25 s a call with the user's model.

## How others do it (benchmark)

- **PowerSchool PowerBuddy for Data Analysis** — staff type questions; it writes SQL, charts and summarises.
  ([THE Journal](https://thejournal.com/articles/2024/07/03/powerschool-releases-ai-powered-tools-for-students-admins.aspx),
  [PowerSchool](https://www1.powerschool.com/blog/connected-intelligence-powerbuddy-data-analysis/))
- **Snowflake Cortex Analyst** — the model writes SQL only against a **semantic model** (curated tables, columns,
  descriptions) plus **verified queries** it reuses; the vendor reports >90 % accuracy with them, ~2× better than
  single-shot SQL; an evaluation compares results of verified questions.
  ([verified queries](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository),
  [behind the scenes](https://snowflake.com/engineering-blog/snowflake-cortex-analyst-behind-the-scenes),
  [evaluations](https://docs.snowflake.com/user-guide/snowflake-cortex/cortex-analyst-evaluations))
- **Databricks AI/BI Genie** — chosen tables, instructions and **trusted** example queries; answers that use one are
  labelled Trusted. ([trusted assets](https://docs.databricks.com/aws/en/genie/trusted-assets))
- **Safety for generated SQL** — enforce in the database, not the prompt: a least-privilege read-only role, row-level
  security, views that hide sensitive columns, one SELECT only, an EXPLAIN check, row caps, the same checks on a
  "repaired" query, and an audit of question, SQL and decision.
  ([InfoWorld](https://www.infoworld.com/article/4244721/your-llm-writes-good-sql-thats-not-the-same-as-safe-sql.html),
  [10 risks](https://www.dpriver.com/blog/?p=3234))

## Decisions (asked, 23 Nov 2026)

- **Report views** (recommended): the model writes one SELECT over a curated `nlq` schema — never the 685 base
  tables.
- **Office staff, by module** (recommended): office and admin staff, each offered only the views their rights cover;
  teachers later (once views can be limited to their sections); families never.
- **The model sees the question and the views only** (recommended): never a record; the result goes only to the
  person who asked.
- **No report builder**: a chatbot answer, not saved reports — no save, share, schedule or downloads.
- **The answer**: figures, text, chart, table — in that order (recommended).
- **NLQ in the chatbot only, no report builder now** (23 Nov 2026, the user's words: "focus only on chatbot responses
  for now like NLQ, we are not making any report builder now"). The views are the chatbot's safe data layer, named
  `nlq` (not "report"), not a builder.
- The text's numbers: not answered directly (the user restated the goal). Built as recommended, which keeps "the
  model sees no record": the model writes the sentences with blanks that EduPro fills from the result. Can change.

## Design

### 1. The `nlq` views — what the model may query

A migration adds a schema `nlq` of views, each one business fact with its module's counting rules already applied
(from `docs/data/modules/*.md`), India dates, the class through that year's enrolment, and a `COMMENT` on the view and
every column (the model's only description of the data). Contacts, Aadhaar/PAN/bank, health details, addresses and
free-text notes are left out; names, admission numbers and employee codes stay (the asker is allowed to see them).
First set (about 40):

| Area                       | Views (one row is …)                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Students                   | `students` (pupil × year: class, section, roll, status, joined/left, gender, category, house), `class_sections` (section × year: class teacher, strength), `teacher_subjects` (teacher × section × subject)                                                                          |
| Attendance                 | `attendance_days` (pupil × school day: present / absent / leave / half day), `section_attendance` (section × day, from the mart), `student_leaves`                                                                                                                                   |
| Exams                      | `exam_marks` (pupil × exam × subject: marks, max, percent, code, grade, verified), `exam_results` (pupil × exam: total, percent, grade, rank), `term_results`                                                                                                                        |
| Fees                       | `fee_bills` (pupil × bill line: month, head, ledger, due date, net, paid, balance), `fee_receipts` (receipt: date, mode, amount, late fee — reversed and bounced left out), `fee_receipt_heads` (receipt × head), `fee_refunds`, `fee_concessions`, `misc_fee_dues`, `misc_receipts` |
| Admissions                 | `admission_enquiries`, `admission_applications` (application: cycle, class, status, stage, dates)                                                                                                                                                                                    |
| Transport, hostel, library | `transport_riders` (pupil × month: route, stop), `transport_routes`, `hostel_stays`, `hostel_beds`, `library_loans`, `library_copies`                                                                                                                                                |
| Staff                      | `staff` (employee: code, name, department, designation, type, joined, left), `staff_attendance_days`, `staff_leave_days`, `staff_leave_balances`                                                                                                                                     |
| Payroll                    | `payslips` (employee × month: gross, deductions, net, final or not), `payslip_lines` (employee × month × pay head)                                                                                                                                                                   |
| Purchase and stores        | `purchase_orders`, `purchase_order_lines`, `stock_ledger`, `stock_balances`, `assets`                                                                                                                                                                                                |
| Engagement                 | `messages` (message: channel, status, day), `helpdesk_queries`, `visitors`, `gate_passes`, `certificates` (issued register)                                                                                                                                                          |

A catalogue in code gives each view the rights that may read it (e.g. the fee views need a fee report right, payroll
views a payroll right) and marks money, date and percent columns (for the text and the chart).

### 2. A database role that can read only these views

- `edupro_nlq` (no sign-in; the app switches to it with `SET LOCAL ROLE` for the one query) may SELECT the `nlq`
  views and nothing else — no base table, no write.
- The views belong to `edupro_nlq_owner`, which may read the base tables they use and which row-level security still
  binds to the school (it is not the migrator, whose policies pass every school).
- **The school cannot be switched from inside a query.** The school is a session setting (`app.school_id`) that any
  role can change with `set_config`. So the views do not trust it alone: each view's spine also keeps
  `school_id = app.nlq_school_id()`, read from `app.nlq_context` — a row the app writes (`app.nlq_begin`, a definer
  function only the app may call) at the start of the query's transaction, which is rolled back afterwards. A query
  that changes `app.school_id` gets nothing from another school.
- In code, the model's SQL may call only an allow-list of plain functions (sums, counts, rounding, dates, text): no
  `set_config`, `current_setting`, `query_to_xml`, `pg_*`, `app.*` and the like.
- The run: one statement (`SELECT` / `WITH`), read-only transaction, 15-second limit, rolled back.

### 3. In the chatbot

The order stays: EduPro's own rules → the AI model. The model's one prompt now offers three kinds of answer:

- an approved query or a help page (as today, docs 101–102), or
- **a data question**: the views the person's rights cover and the question point to (picked by EduPro from the
  question's words and the catalogue — about 8–15 views, not all 40), their columns and descriptions, a few checked
  example questions with their SQL, and the rules; the model replies with one JSON object:
  `{"sql": "SELECT …", "title": "…", "explain": "From fee receipts of Nov 2026, totalled by class",
"figures": [{"label": "Collected", "value": "{total:amount}"}], "text": ["… {top:class:amount} …"],
"chart": {"type": "bar", "x": "class", "y": ["amount"]}}`, or
- `{"none": true}` → EduPro's own reply.

**Checks before running**: one statement, starts with SELECT/WITH, only `nlq.*` relations, a row limit added;
`EXPLAIN` must pass under a cost limit. On a database error, one retry with the error message (checked the same way).
Then it runs as `edupro_nlq` with the school set.

**The blanks** EduPro fills from the result (formatted by the column's kind — ₹ with Indian grouping, %, dates):
`{total:col}`, `{average:col}`, `{max:col}`, `{min:col}`, `{count}`, `{top:label:value}` (the label of the highest
value), `{bottom:label:value}`, `{first:col}`. A sentence whose blank cannot be filled is left out.

### 4. The answer in the chat

1. The title and the line "How this was worked out" (the model's `explain`).
2. A row of 2–4 figures.
3. The text (2–4 sentences, blanks filled).
4. A chart when it fits — bar, stacked bar, line or donut, from `chart` (x = a column, y = number columns); drawn
   by EduPro, so it always matches the table.
5. The table: the first 50 rows, with "N more rows — ask a narrower question" beyond.

Labelled "Worked out by the AI model from the school's records". The SQL itself is kept in the audit, not shown.
Charts: the admin's SVG charts move to `@edupro/ui` (shared by the web window and the chat page); the app draws the
same four kinds natively (no new package). Each chart has a text alternative; the table is its data.

### 5. Who, switches, limits, audit

- Assistant set-up: a switch **Data questions with the AI model** for office and admin staff (off until the school
  turns it on; needs the AI model on for all schools).
- A person gets a data answer only from views their rights cover; nothing else is offered to the model.
- Each question counts in the school's monthly limit of model answers (a retry is part of the same question).
- `ai_audit` keeps the question, the views offered, the SQL, rows returned, time taken and the outcome (answered,
  refused by a check, failed).

### 6. Checked questions

The guides' 215 queries, rewritten over the views, become a library of checked questions: they are the examples in
the prompt (the ones closest to the question), a question that matches one closely gets its SQL straight away
("Checked", no wait for the model), and an evaluation runs them on a test school before each release to catch views
or prompts that drift.

## Phases (each checked complete — plan and all tests — before the next)

- **A** the `nlq` views, the `edupro_nlq` role and the owning role, the school context (migrations 0418–0419), the view catalogue (rights,
  column kinds), tests: every view runs per school, sees no other school, keeps its module's rules (compared with the
  guides' queries), `edupro_nlq` cannot read a base table or write, and `set_config` inside a query reaches no other school.
- **B** the engine in the assistant: picking views, the prompt, the checks, running, one retry, the blanks, audit,
  limit, the set-up switch; API e2e with a made-up model (good SQL, SQL that reaches a base table, a write, two
  statements, another school, a slow query, a bad blank).
- **C** the answer in the chat: figures, text, chart, table in the web window, the chat page and the app; help.
- **D** the checked-question library and the evaluation; browser and accessibility checks; the user's trial with
  their model on the dev server.

## As built

- **A (24 Nov 2026).** Migrations **0418** (roles `edupro_nlq` and `edupro_nlq_owner`, schema `nlq`, the question's
  school in `app.nlq_context` with `app.nlq_begin()` / `app.nlq_school_id()`), **0419** (`app.nlq_run(sql, limit)`: a
  SECURITY DEFINER function owned by `edupro_nlq`, so a query cannot switch role — the app signs in as `edupro_app`
  and could otherwise switch back with `set_config('role', …)`; one SELECT run as a sub-query; the role is no longer
  given to the app), **0420** (42 views, written per module from `docs/data/modules/*.md`: core `academic_years`,
  `students`, `class_sections`, `staff`; attendance, exams, homework, fees and misc fees, admissions, transport,
  hostel, library, staff attendance and leave, payroll, purchase, stock, assets, certificates, messages, helpdesk,
  visitors, gate passes). The catalogue `apps/api/src/modules/insights/nlq/catalogue.json`: per view its area, the
  rights that open it, each column's kind and 3–5 checked examples (190). Found on the way: the library limit's row
  rule (`app.library_ok`) calls a function that looks tables up by name, which fails under `app.nlq_run`'s search
  path — the run calls `app.my_libraries()` first (it caches the person's libraries), and a librarian stays limited.
  Views granted to PUBLIC (`provider_issues`, `admission_waiting`) are `security_invoker`, so `edupro_nlq` reads
  nothing through them. Tests: API `nlq-views.e2e-spec` (6): every view runs through `app.nlq_run`; one school only,
  even after `set_config('app.school_id', …)` inside the query; base tables, the context table, `set_config('role')`,
  `query_to_xml`, writes and a run without `app.nlq_begin()` refused; `edupro_nlq` holds no other privilege; every view
  and column described, no personal-data column, no jsonb or arrays; counting rules on made-up rows (cancelled
  admission, deleted pupil, reversed receipt, period register, leave); the catalogue's rights exist and its examples
  run. `packages/db` 151. Every view and example also timed under a millisecond-range budget on the dev database.
- **B (24 Nov 2026).** Migration **0421** (`assistant_settings.nlq`, the school's switch, off). API
  `insights/nlq/`: `nlq-sql.ts` (a tokenizer-based check: one SELECT/WITH, no write or control words, no schema but
  `nlq`, an allow-list of plain functions, and **only the views the person's rights cover** — the database lets
  `edupro_nlq` read every nlq view, so rights are kept here), `nlq-catalogue.ts` (views by rights, picking views by
  weighted word overlap with a small synonym list — "collected" → receipts, "due" → bills …; closest checked examples,
  only those using open views; a checked question answered as it is), `nlq-answer.ts` (blanks filled and formatted:
  ₹ with Indian grouping, %, dates; the chart kept only when it fits: x a column, y number columns, 2–60 rows, donut ≤
  8; otherwise an automatic bar/line for one label and 1–3 numbers; the table's columns), `nlq.service.ts` (the
  views' COMMENTs read once; the prompt's data part; `run()` inside a savepoint that is rolled back: `app.nlq_begin`,
  `app.my_libraries`, read-only, 15 s, India time zone, `app.nlq_run` up to 5,001 rows; the card). In the assistant:
  `ask()` offers data questions to office/admin staff when the AI model is on, the school's switch is on and their
  rights open at least one view — with or without the "Help from the AI model" switch; one prompt offers approved
  queries, help pages and the `{"sql": …}` answer; a refused or failing query gets one retry with the reason; a
  question matching a checked one runs its checked SQL with no model (`by: 'local'`, `checked: true`, not counted);
  an analytical question ("by", "per", "compare", "top", "average" …) tries the model first, unless it is exactly a
  chip's question — EduPro's rules answer when the model cannot; data questions may hold words the rules take for a
  change request, but not off-topic ones. The answer's card `kind: 'data'` (title, explain, figures, text, chart,
  columns, rows ≤ 50, more, checked); the query is kept in `ai_audit` (kind `tool`, the row count). Set-up info
  `claudeInfo.nlqAvailable`. Tests: unit `nlq.spec` (10: the checks, blanks, formats, charts, picking, checked
  questions); API `nlq-chat.e2e-spec` (6: off until switched on; figures, sentences and chart from the real rows, no
  record in the prompt, the query audited; a query outside the views refused with one retry; the database's error
  sent back once, a second bad query → EduPro's own reply; a checked question with no model; a class teacher not
  offered fee views and refused when naming payslips); the chatbot, AI model, assistant evaluation, red-team,
  sprint 15, family help and permission suites.
