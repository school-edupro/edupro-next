# Runbook — the AI model (LLM) for all schools

docs/design/101. One LLM of our own, set once for every school on the server: its address, Bearer token, where the
answer sits in its reply, a time limit, on / off. While it is on it helps the assistant with the questions EduPro's
own rules cannot place (instead of Claude — Claude is not used at all while it is on) and writes the AI reports, in
each school only once that school switches it on.

## The call EduPro makes

    POST <address>                      e.g. http://localhost:8080/v1/chat
    Content-Type: application/json
    Authorization: Bearer <token>
    {"prompt": "<the instructions, the records and the question, as one text>"}

The answer is read from the reply: the field named in **Reply field**, else the first of `response`, `answer`,
`reply`, `text`, `output`, `content`, `message`, `result`, `completion`, `generated_text`,
`choices[0].message.content`, `choices[0].text`, `data.<any of those>`, `output.text`, `message.content`,
`result.text`, `[0].generated_text` that holds words, else a plain-text body.

## 1. Give the right (Mobilise, once)

The right **AI model for all schools** (`platform.ai_model.manage`) is in no role, and a school's own admin cannot give
it (not to a role, not by giving a role that carries it). Mobilise gives it first, as the database owner, from the repo
root with the `.env` loaded:

    node scripts/ai/ai-model-admin.mjs <SCHOOL_CODE>                         who holds it there
    node scripts/ai/ai-model-admin.mjs <SCHOOL_CODE> <sub|e-mail|mobile>     give it
    node scripts/ai/ai-model-admin.mjs <SCHOOL_CODE> <sub|e-mail|mobile> remove

It makes the role **AI model for all schools** in that school. After that, a holder may give the role or the right to
others on the Access pages. The script clears the person's cached rights, so it shows on their next page.

## 2. Set it up and test it (a holder)

School settings → **AI model (LLM)** (`/system/settings/ai-model`):

1. **Address (URL)**: the full address, `http://` or `https://`, no user or password in it.
2. Type the Bearer token in its box once. It is kept encrypted with the server's `FIELD_ENCRYPTION_KEY` setting and never shown again —
   only its last 4 characters. An empty box keeps the saved token; typing a new one replaces it.
3. **Reply field**: leave empty unless the test says "No answer found in the reply".
4. **Wait for an answer, at most**: 5–120 seconds (30 by default).
5. **Save for all schools**, then **Test the saved model**: a prompt (the sample by default) → **Send** shows the
   answer, the HTTP status, the time and the raw reply (folded). The last test is kept on the page.
6. Tick **On for all schools** and save.

Changing the address, the token or the reply field forgets the last test: test again.

## 3. Each school decides

- **Assistant set-up** → **Help from the AI model**: on or off for teachers and for office / admin staff (families
  and students stay off, as for Claude). The school's monthly limit of answers by an outside model applies (Mobilise's
  `scripts/ai/claude-limit.mjs`, default `AI_CLAUDE_MONTHLY_QUESTIONS`); answers say "Answered with the AI model".
- School settings → **AI model (LLM)** → **AI reports written by the AI model**: the weekly reports and the Monday
  brief (the workers' job and "Run now"). If the model fails or cites facts that do not exist, the standard wording is
  used (never Claude).

## What is sent

The assistant sends two prompts per question: first the rules, the person's approved queries (names and inputs, no
records), the last turns and the question (phone numbers, e-mails, Aadhaar and addresses masked); then the question and
the records of the one query it chose, as run with the person's own rights (up to 50 rows, contacts masked). A report
sends its facts (figures, no names). Nothing is sent for questions EduPro's own rules answer. If the model is run by
someone outside the school group, it needs the same agreement as Claude (see `assistant-claude.md`).

## When it goes wrong

| The test says                                     | Do                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| The model refused the token (HTTP 401 / 403)      | Enter the token again (copy it whole), save, test                  |
| The model answered HTTP 404                       | The address: the path too (`/v1/chat`)                             |
| The model could not be reached (…)                | The model is down or not reachable from the API server (firewall)  |
| No answer within N seconds                        | A slow model: raise the time limit, or make the model faster       |
| No answer found in the reply: set the Reply field | Open the raw reply; put the answer's place in **Reply field**      |
| The saved token cannot be read: enter it again    | The field key changed on the server: type the token again and save |

While the model fails, the assistant answers with EduPro's own rules and the reports use the standard wording. The API
log names failures as `ai model: …` (never the token). Switching **On for all schools** off stops every use at once.
