# 82 · Publishing sends nothing: the user sends the message to parents when they choose

Status: built 6 Nov 2026 (migration 0314; **As built** at the end). Asked by the school after doc 81, on the release's Publish tab: "one gap:
e-mail/SMS not sent at the time of publish; it is optional: the user publishes the report card, and
sending the e-mail or SMS after that depends on the user".

## What there is (doc 81 and before)

- **Publishing** a class (its **Publish**, or **Publish every class**, or the release's status set to
  released) opens its cards in the parent app **and at once queues the message** to each pupil's
  guardians who receive messages (`openClasses` → `tellFamilies`), e-mail always, SMS once its DLT id
  is given. Held cards and, when the release hides them, fee defaulters are left out.
- **Show again** (one held card, or several, or from an Excel) on a published class also queues the
  message for those pupils at once (`notified` in the reply).
- The counts: `notified_count` on the release and on each class (messages queued). Nothing records
  **which pupils** were told, so a pupil is told again whenever their class is published again.
- **Message to parents** (doc 81) shows the e-mail and the SMS as they go out, and links to edit them.

## Decisions (user, 6 Nov 2026)

| Question   | Answer                                                                                                                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How        | **Publishing sends nothing.** In **Message to parents**: a row per published class with who is not told yet and **Send to parents**, and **Send to every published class**; a confirm dialog with ticks for **E-mail** and **SMS** (SMS only when its DLT id is given) |
| Again      | **Only those not told yet**: each pupil's "told" is kept per release and channel; nobody gets the same message twice                                                                                                                                                   |
| Show again | **No message**: the pupil is counted in "Not told yet" and told with the next Send                                                                                                                                                                                     |
| Who        | **As publishing**: the results publish right (the principal)                                                                                                                                                                                                           |

Decided here: "told" is kept **per channel**, so a school that sends the e-mail now can still send the
SMS later (once its DLT id is given) to the same pupils; a pupil counts for a channel only when a
guardian who receives messages has an address on it (an e-mail; a 10-digit mobile for SMS) — the
others are listed as "no e-mail" / "no mobile", not as waiting; a held card and a card the fee rule
withholds are never sent (counted apart); revoking a class keeps who was told (publishing it again
sends nothing new to them).

## Plan

1. **Who was told** (migration 0314): `report_card_told` — the school, the release, the pupil, the
   channel, when, by whom, the messages queued; one row per release × pupil × channel. Filled for the
   classes told before this change: each pupil of a published class whose messages were queued (the
   class's `notified_count` > 0), on the channels its templates were ready on then (e-mail; SMS with a
   DLT id), so they are not told twice.
2. **Publishing and Show again send nothing**: `openClasses` only opens; the holds' Show again only
   shows; their replies keep the counts' names at 0 (`notified`).
3. **Send** (API): `POST /exams/report-cards/releases/:id/tell` {classIds (none = every published
   class), channels: e-mail and/or SMS} (`exams.result.publish`): the pupils of those published classes
   — not held, not withheld for fees — not told yet on a channel, each family's message queued through
   the same template as now (doc 81's words), the told rows written, the counts kept; a channel whose
   template is not ready refused (400: "SMS needs its DLT template id under Communication →
   Templates"); nothing to send → 409 "Everyone is told already". Audit `exams.report_card.tell`.
4. **The counts** (the preview of doc 81 grows): per published class — pupils, told and not told yet
   by e-mail and by SMS, no e-mail / no mobile, held, withheld for fees; and the totals.
5. **The Publish tab**: **Message to parents** shows, above the e-mail and the SMS, a table — Class ·
   Pupils · E-mail: told / not yet · SMS: told / not yet · **Send to parents** — and **Send to every
   published class** (the publish right only). The dialog: "Send the report card message to the
   families of III not told yet", ticks **E-mail (12 not told yet)** and **SMS (needs its DLT id)**
   (disabled when not ready or nobody waits), "Held cards and cards withheld for fees are not sent".
   The Publish dialogs say "No message is sent: send it from Message to parents when you choose"; the
   classes' "N family messages" stays; Held cards' Show again says "counted in Not told yet".
   `ConfirmAction` learns optional ticks (posted by name).
6. **Help** (Report cards → Publish, Held cards) and doc 81's note.

## Parts

1. **The API**: the migration (the table, its RLS, the fill), publishing and Show again silent, the
   Send endpoint, the counts in the preview; tests — publishing queues nothing; Send e-mail tells the
   not told only; a second Send → 409; SMS not ready → 400; a card shown again counted then told on
   the next Send; a held card never; Send needs the publish right; per channel (e-mail then SMS).
2. **The page**: the class table and Send buttons with the ticks, the dialogs' and Held cards' words,
   help; release 316 in the browser with axe — **looking only** (Alpha's providers are live: no Send).

## Not in scope

A reminder to families already told; a message when a card is revoked; scheduling the send; WhatsApp.

## As built (6 Nov 2026)

- **Migration 0314**: `report_card_told` (release × pupil × channel, the messages queued, who and
  when; tenant RLS), filled for the classes told before (each pupil of a class with
  `notified_count` > 0, not held, on the channels whose template was ready). Alpha: release 316's
  Class III, 16 pupils told by e-mail.
- **API** (`report-cards.service.ts`): `openClasses` only opens; Show again (one, bulk, Excel) only
  shows (`notified` stays 0 in the replies); `tellPupils()` (the published classes' pupils: held, fee,
  has e-mail / mobile, told per channel) feeds both `tell()` — `POST
/exams/report-cards/releases/:id/tell` (`exams.result.publish`; 409 when no class is published, a
  class not published, or nobody waits; 400 for a channel not ready; audit `exams.report_card.tell`;
  returns `{ told: { email, sms }, messages }`) — and the preview's `classes` / `total` counts (told,
  waiting, noAddress per channel; held; withheld).
- **Admin**: Message to parents' class table (Class · Pupils with held / withheld · E-mail · SMS: "16
  told · 0 not yet", "4 without an e-mail") with **Send to VI's parents** and **Send to every
  published class** (two or more classes); `ConfirmAction` gained `choices` (ticks posted by name; "Tick
  at least one."); the server action `tellParents`; when nothing can be sent, why ("16 families wait
  for the SMS, which goes once its DLT template id is added…"). Publish dialogs ("No message is sent:
  send it from Message to parents…", the button now "Publish"), Held cards' words, the done messages.
- **Tests**: `exams-v2` (publishing queues nothing; the counts; Send needs the publish right, a tick,
  a ready channel, a published class; Send e-mail tells one family; again → 409; published again
  tells nobody again), `report-card-holds` (Show again sends nothing, waits, then Send tells).
  Release 316 in the browser with axe: the table, no Send (all told by e-mail), the SMS's reason; the
  dialog checked on a throwaway page with made-up counts (ticks, the disabled SMS, the error); nothing
  sent.
- **Later (6 Nov 2026), found on Alpha (release 1)**: 0314's fill marked whole classes told — VI's 15
  e-mails had been cancelled (1 Nov) and 3 VI pupils have no e-mail, yet all 17 counted told, so VI
  could not be sent. Migration 0315: `report_card_told.message_ids`; the filled rows made again from
  the messages that exist (release name and pupil name in the message, sent to one of the pupil's
  guardians, not cancelled or failed). **Told = a told row with a message that is not cancelled or
  failed** (`TOLD()` in the service), so a cancelled or failed message makes the family "not yet" again
  and Send replaces the row's messages; **pending** = told with every message still queued — the box
  says "16 still in the outbox" and links Communication → Messages (queued). Release 1 after it: VI 1
  to send (16 withheld for fees), VII and VIII 16 each in the outbox. The plural ("1 family waits").
  Tests: exams-v2 (cancelled → not yet → Send again; sent → no longer pending; SMS once a DLT id is
  given).
