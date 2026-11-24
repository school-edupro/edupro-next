# The assistant: asking about the school in plain words

The assistant (the chat button at the bottom right, and **Insights → Assistant**) answers questions about the
school's records in English, Hindi or Hinglish. It only reads: it never changes, sends or deletes anything, and it
answers only from the records your rights let you see.

## Who does what

| Person                | Does                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Every member of staff | Asks questions; their answers come from the records their rights open                       |
| School admin          | **Insights → Assistant set-up**: who may use it, topics, starter questions, the AI switches |
| Mobilise              | Connects the AI model for all schools and sets each school's monthly limit of AI answers    |

## How a question is answered

1. **EduPro's own rules first.** Everyday questions ("who is absent today", "fees due for VI-A") are recognised and
   answered at once from approved queries — nothing leaves EduPro.
2. **Help from the AI model** (when the school switched it on): a question the rules cannot place is matched to an
   approved query or to a help page by the AI model. Its answers say "Answered with the AI model".
3. **Data questions with the AI model** (office and admin staff, when the school switched it on): a question about
   the school's data that needs totals, comparisons or several kinds of records — "fee collected by class this month
   against last month", "classes with attendance below 85 % in October", "top 5 subjects by failures in Term 1" — is
   worked out by the AI model writing one query over the school's data views.

## A data answer

It shows, in this order:

- the **title** and **how it was worked out** (from which records, which were left out, how they were counted);
- a row of **figures** (totals, the highest, the lowest …);
- a few **sentences** — every number in them is filled in by EduPro from the result, so the words always match the
  table;
- a **chart** when one fits (bars, stacked bars, a line over months, a ring);
- the **table** (the first 50 rows; ask a narrower question for the rest).

"From a checked question" means EduPro recognised a question it already has a checked query for and answered at
once, without the AI model.

## What keeps it safe

- The AI model is told **the question and the description of the data views only — never a record**. The result goes
  only to you.
- The query can read only the data views your rights open (fee views need a fee right, payroll views a payroll right
  …), only for your school, and only read: anything else is refused before it runs, and the database refuses it too.
- The data views leave out mobiles, e-mails, addresses, dates of birth, Aadhaar/PAN/bank details, health details and
  notes about people; they already apply the school's counting rules (cancelled admissions, reversed receipts and
  deleted records never count; attendance comes from day registers).
- Every question, the query it ran and how many rows it gave are kept in the assistant's audit.

## Switching it on (school admin)

**Insights → Assistant set-up → Help from the AI model → Data questions with the AI model → Office and admin
staff**, then **Save**. It needs the AI model for all schools to be on (**School settings → AI model**). Each data
question counts in the school's monthly limit of AI answers; a checked question does not.

## Common questions

**The answer took about half a minute.** The AI model writes the query; that wait depends on the model Mobilise
connected. Checked questions answer at once.

**It answered with something simpler than I asked.** Ask with words that show you want a breakdown ("by class",
"per month", "compare", "top 10"); EduPro's own rules answer simple questions first.

**It said it can only answer questions about the school's records.** The question was outside the school's data, or
no data view you may open covers it.
