# ADR-012: The assistant answers only through the query catalogue

Status: accepted (Sprint 14, 2026-09-28)

## Context

Design 07 fixed the principles for the AI layer: permissions first, an approved catalogue instead of free
SQL, numbers from the database and words from the model, audited and budgeted. Sprint 14 delivers the first
assistant for staff and had to choose where the boundary between the model and the data sits.

## Decision

- The model never sees SQL and never receives a table dump. It sees **tool definitions** generated from the
  catalogue entries the caller is allowed to run (`anyOf` permissions), each with typed parameters. It
  chooses an entry and fills parameters; the API runs the entry's parameterised SQL **inside the caller's
  tenant transaction** and returns at most 200 rows.
- Ids (classes, students, sections) come from catalogue entries too (`list_classes`, `find_student`); the
  model cannot guess an id into a query the caller may not see, because the query runs under the caller's
  row-level security anyway.
- Every answer carries citations: the entry ids, the parameters used and the row counts, stored with the
  turn; the page shows them so a user can reproduce the answer in the screens.
- The provider is chosen per deployment (`AI_PROVIDER`): Claude in production, a catalogue-aware mock in
  development and tests. The mock routes by keyword with a specificity threshold so tests exercise the
  real pipeline (redaction, budget, tools, audit) without a model.
- Audit rows are written in the same transaction as the tools; redaction happens before anything is stored.

## Consequences

- Adding a question means adding a catalogue entry (SQL, permissions, keywords, Hindi title), which is
  reviewable like any query in the code base; no prompt engineering can widen access.
- The catalogue is bounded (34 entries in v1); unknown questions are refused with the nearest entries
  instead of answered loosely. Sprint 15 extends it for teachers and parents; Sprints 27 to 29 complete it.
- Cost is bounded by the budget meter and the row cap; the audit page shows tokens and cost per school.
- A weakness to keep in view: the mock router is heuristic; only the Claude provider understands
  paraphrases. The evaluation set of 200 questions (Sprint 16) measures both.
