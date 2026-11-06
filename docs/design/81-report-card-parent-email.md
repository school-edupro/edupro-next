# 81 · The parents' "report card published" e-mail, seen on the release's Publish tab

Status: built 6 Nov 2026 (migration 0313; **As built** at the end). Asked by the school on a release's Publish tab
(`/exams/report-cards/316?tab=publish`): "in this page user publish a report card we also send a email
to parents report card live, user view email template".

## What there is

- **Publishing** a class (Publish tab: Publish all, or a class's Publish) opens its cards to the families
  and tells them (`tellFamilies` in `report-cards.service.ts`): each pupil's guardians who receive
  messages, held cards left out, fee defaulters left out when the release hides them. One message per
  guardian per channel through `app.send_template('result_published', …)`; the release and each class
  keep the count ("told").
- **The template** `result_published` (SMS and e-mail, seeded by `app.exam_seed_templates`, 0277):
  subject "The {{term}} result of {{name}} is published"; body "Dear parent, the {{term}} result of
  {{name}} at {{school}} is published. See the report card in the parent app." Plain text: no school
  header, no link. `{{term}}` is the **release's name**, so release 316 ("Class I to III") reads "The
  Class I to III result of Aarav is published".
- **Channels**: e-mail goes out while the template is active; SMS only once its DLT template id is
  added (Alpha: not yet); no WhatsApp.
- **Seeing it**: only under Communication → Template master ("Exams: result published"), whose editor
  has a live preview. Nothing on the release says what the families get.
- Other modules' e-mails were turned into designed letters the same way (0173, consent forms): the
  template body is the whole letter in HTML (school header, a button with the link, footer), and a
  template a school had reworded was left as it was.

## Decisions (user, 6 Nov 2026)

| Question | Answer                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where    | **A "Message to parents" box on the Publish tab**: the e-mail as a parent sees it (filled for a pupil of this release), which channels go out, how many were told, a link to edit |
| Design   | **A designed e-mail**: the school's letterhead and a **View report card** button to the parent app's Results; a template the school reworded is kept                              |
| Wording  | **Exam name + class**: new `{{exam}}` (the release's exams) and `{{class}}` (the pupil's class, "I-A"); `{{term}}` stays for schools that use it                                  |
| Edit     | **View here, edit there**: "Edit the template" opens Communication → Templates (the template right)                                                                               |

## Plan

1. **The words** sent with each message: `name`, `school`, `term` (the release's name) as now, plus
   `exam` (the release's exams' names: "Assement 1"; two or more "Periodic Test 1 and Half Yearly"),
   `class` (the pupil's section, "I-A") and `link` (the parent app's Results page,
   `PARENT_APP_URL/results`). One function builds them, for the messages and for the preview alike.
2. **The designed e-mail** (migration 0313), as the consent letters: navy header with the school's name;
   "Report card published"; "Dear parent, the {{exam}} report card of {{name}} (class {{class}}) is now
   published."; a **View report card** button to `{{link}}` and "Or open: {{link}}"; "You can also see
   it in the EduPro parent app under Results."; the footer "This is an automatic message from
   {{school}}. Please do not reply to it." Subject "{{exam}} report card of {{name}} is published".
   The SMS's default words follow ("Dear parent, the {{exam}} report card of {{name}} ({{class}}) at
   {{school}} is published. See it in the parent app.") only while its DLT id is empty (a registered
   SMS must keep its registered words). Only templates still on the old default words change; a school's
   own wording stays. New schools get the new defaults (`app.exam_seed_templates`).
3. **The preview** (API): `GET /exams/report-cards/releases/:id/parent-message` (the release's readers):
   the pupil it is filled for (the release's first pupil, by class and roll, who has a guardian to
   tell; else sample words), and per channel — e-mail, SMS — the template's id and state (ready,
   switched off, SMS needing the DLT id, missing), the subject and the body filled exactly as
   `send_template` fills them (HTML-escaped words in an HTML template), and the release's told count.
   The template editor's own preview gets sample words for `name`, `term`, `exam` and `link`.
4. **The Publish tab**: a **Message to parents** box under the classes: who is told (guardians who
   receive messages; held cards, and fee defaulters when hidden, are not), told so far; **E-mail** —
   its state, the subject and the letter shown as it arrives (a sandboxed frame), "Filled for Aarav
   Sharma (I-A), a pupil of this release"; **SMS** — its state ("Goes out once its DLT template id is
   added") and its words; **Edit the template** (Communication → the template) for those with the
   template right. The Publish dialogs add "Families are told by e-mail (see Message to parents)".
5. **Help** (Report cards → Publish) and this doc's As built.

## Parts

1. **The message**: migration 0313 (the letter, the words, the defaults for new schools; reworded
   templates kept), the words built once and sent with every message, the preview endpoint, the
   template editor's sample words; tests — the queued e-mail carries the exam, the class and the link
   and is HTML; a reworded template is kept; the preview fills the first pupil; SMS without the DLT id
   reads as not going out.
2. **The Publish tab**: the box, the dialog line, help; release 316 on Alpha in the browser with axe
   (looking only: nothing is published or sent).

## Not in scope

Sending a test e-mail from the page (Alpha's providers are live); WhatsApp for this message; attaching
the card's PDF to the e-mail; a message when a card is taken back (none is sent, as decided earlier).

## As built (6 Nov 2026)

- **Migration 0313**: `app.exam_result_defaults()` holds the default words (the e-mail letter, HTML; the
  SMS text); the e-mail still on the old default became the letter (its subject too when not reworded),
  the SMS still on the old default with no DLT id took the new words; `app.exam_seed_templates` makes new
  schools' templates from the same defaults. Alpha's two templates were on the old words and changed.
- **API** (`report-cards.service.ts`): `messageWords()` builds name, class ("I-A"), exam ("A and B"
  for several), school, link (`PARENT_APP_URL/results`) and term, used by `tellFamilies` and the
  preview; `parentMessage()` behind `GET /exams/report-cards/releases/:id/parent-message` (the
  release's readers, its scope): the first pupil in sight with a family to tell (held cards out), else
  sample words; e-mail and SMS with `state` ready / off / needs_dlt, the template id (null: made on the
  first publish, the defaults shown) and the subject and body filled by `fillTemplate()`, the mirror of
  `app.send_template`. The template editor's sample words gained name, exam, term and link.
- **Admin**: `components/exams/rc/ParentMessage.tsx` under the Publish tab's classes — who is told and
  how many so far, "Shown as Aarohi Reddy (I-A), a pupil of this release, would get it", the e-mail in a
  sandboxed frame with its subject and state, the SMS's words and state, "Edit the … template" for the
  template right (else who edits it); the Publish dialogs point to it.
- **Tests**: `exams-v2` (the queued e-mail: HTML, the subject, the exam and class, the button to
  Results; the preview equal to it, SMS needs_dlt; 404), `report-card-holds` (the exam's name, not the
  release's; a school's own text template previewed with its {{term}}). Release 316 on Alpha in the
  browser with axe (frames skipped): clean; nothing published or sent.
- **Later (6 Nov 2026)**: publishing no longer sends the message; the principal sends it from Message to
  parents when they choose, to the families not told yet (docs/design/82).
- **Later (6 Nov 2026)**: {{exam}} is the exam's name only when the card carries one exam; a card of
  several exams (Term 1 with five) uses the card's own name ("Term 1 (2026-27) report card of …"), as
  listing every exam made an 80-word subject.
