# 92 — MobiAI chat window (websites and app)

Status: planned 21 Nov 2026 · builds on doc 91 (the chatbot) · owner: Insights

## The ask

The old system's assistant was a floating chat window: a round button at the bottom right of every page opened a
panel with the assistant's name and an "online" dot, clear and close buttons, a bar of topic chips allowed by the
person's rights, a greeting by the time of day, a "Your Quick Update" message with the day's figures, the
conversation in bubbles with times and a typing indicator, a question box with a send button, and "Powered by
Mobilise App Lab Limited". EduPro has the same assistant (doc 91) as a full page; this adds the window.

## Decisions (asked and answered, 21 Nov 2026)

| Question     | Answer                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Where        | All three websites (admin, teacher, parent) on every page, and the app (its Ask button opens the same look) |
| Topic bar    | The topics the person may ask (rights, scope and Assistant set-up); a tap asks the topic's main question    |
| Quick Update | Yes, per audience (admin, teacher, parent, student), when the window opens                                  |
| Name         | The school can rename it: a name (default **MobiAI**) and a subtitle per audience in Assistant set-up      |

Decided without asking: the bin starts a new conversation (past questions stay in the audit trail — they are never
deleted from the window); the full Assistant page stays (an "Open full page" link in the window); the colours are
the Mobilise design system's (navy and cyan), not the old purple; no emoji — line icons.

## What the person sees

- **The button**: round, bottom right, on every page where the person's menu has the assistant (not on the
  Assistant page itself). The app: the Ask button on Home and More → Assistant.
- **The window** (400 × 560 on a computer, the full screen on a phone): header with the icon, the **name** and the
  **subtitle** with a green dot, bin (new conversation), close; the **topic bar** (scrolls sideways); the messages:
  "Today", the greeting ("Good evening, Asha. I'm MobiAI. Ask me about …"), **Your Quick Update**, then the
  questions and answers as bubbles with their times — an answer keeps its figures or table, Open <screen>, sources
  and the Ask next / Did you mean chips (doc 91); three dots while it looks; the question box and send; the footer.
- **Switched off, consent, "ask a parent", today's limit**: the window says so in place of the question box.
- The conversation stays open while the person moves between pages (kept in the tab's session), Esc closes, focus
  returns to the button.

## Quick Update (per audience)

Each line is the one-line answer of an approved query run with the person's rights (doc 91), so nothing new is
reached: **admin** — the school today (attendance, fees collected, staff present), open queries; **teacher** —
absent today in my sections, my classes today, my leave left; **parent** — each child's attendance this month, fees
due, homework this week; **student** — my attendance this month, my classes today, homework this week. A line whose
topic is switched off for the audience, or that the person may not run, is left out.

## Admin

Assistant set-up gains **Name and greeting**: the name (default MobiAI) and the subtitle for students, parents,
teachers and office (defaults "Your smart study / parent / teaching / admin assistant"; empty = the default, in
the person's language).

## Phases (each checked complete — plan and all tests — before the next)

- **A. API** — migration 0411 (`assistant_settings.name`, `subtitles`); settings GET / PUT; the start gains `name`,
  `subtitle`, `topics` (the topic chips with their question) and `quick` (the Quick Update lines); API e2e.
- **B. Assistant set-up** — the Name and greeting section; accessibility.
- **C. Websites** — `AssistantWindow` (a client component in `@edupro/ui`) on every page of the admin, teacher and
  parent websites, with each app's server actions (start, ask, the conversation); accessibility and a browser check.
- **D. App** — the chat look for the Ask button and More → Assistant (header, topic bar, greeting, Quick Update,
  bubbles, typing dots, question bar, footer); widget tests (light, dark, Hindi, 2× text).
- **E. Close** — docs "As built", the full checks.

## As built

- **A (21 Nov 2026).** Migration **0411**: `assistant_settings.name` (default MobiAI, 1–40 letters) and `subtitles`
  per audience. `GET / PUT insights/assistant/settings` carry `name` and `subtitles` (left out of a save, the saved
  ones stay; the defaults with their Hindi are in `defaults`). `GET insights/assistant/start` adds `name`,
  `subtitle` / `subtitleHi` (the school's, else the standard one per audience), `firstName` (for the greeting),
  `topics` (in the order of the topics list, each topic the person may ask with its main question: the school's
  first starter in that topic, else its first question) and `quick` (`QUICK` per audience in
  `assistant-settings.ts`: each line the query's one-line answer in English and Hindi, run with the person's rights
  inside a savepoint — a line that fails is left out; none before a parent's consent or with the audience off; it is
  not counted as a question). Tests: `apps/api/test/chatbot-window.e2e-spec.ts`.
- **B (21 Nov 2026).** Assistant set-up (`/insights/assistant/setup`) opens with **Name and greeting**: the name, a
  subtitle for students, parents, teachers and office (the standard one as the hint, in English and Hindi), and a
  preview of the window's top; an empty name is a problem to fix before Save; the save sends them with the rest.
  Checked in a browser (Save caught, nothing saved on Alpha) with axe.
- **C (21 Nov 2026).** `AssistantWindow` (a client component in `@edupro/ui`, styles `.mobiai*` in `app.css`): the
  round button at the bottom right (above the phone tab bar), the panel (25 × 36 rem; the whole screen on a phone)
  with the navy header (name, subtitle with a green dot, Open full page, the bin for a new conversation, Close), the
  topic bar, Today, the greeting by the time of day with the person's first name and "Try asking", Your Quick Update,
  the bubbles with their times (each answer's figures or table — a wide table scrolls and is reachable by keyboard —
  Open <screen>, the source and Ask next / Did you mean / You can ask), three dots while it looks, the notes for
  switched off, consent, "ask a parent" and today's limit, the question box and send, and the footer. It stays open
  with its conversation while the person moves between pages (the tab's session); Esc closes and the focus goes
  back to the button. Each website mounts it in its frame (`components/AssistantDock.tsx`, not on the full Assistant
  page) for people with the assistant right — on the parents' website unless the school hides the Assistant — with
  its own server actions (`lib/assistant-window.ts`: start, ask with the website's surface, the conversation).
  Checked on a made-up test school at 1280 and 375 px (open, topic, typed question, another page, Esc, the bin, not
  on the full page; axe) and with the parent, student, teacher and admin accessibility lists.
