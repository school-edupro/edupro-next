# 56 — Offer admission: preview the message, change the email (built 27 Oct 2026)

Asked on the registration page: when someone offers admission, first show the email that goes, and
let them change it.

## As built

- **Offer admission** on the registration page opens **"Offer admission: the message to the family"**.
  It shows:
  - the email's recipient (or why it is not sent: no email address, or the template is off);
  - its **Subject**, **Message** (the opening paragraph) and **Closing line**, which may be changed;
  - the facts, which may not be changed (candidate, registration no., class, admission fee, pay-by
    date);
  - the email as the family will see it, refreshed with **Update the preview**;
  - the **SMS** and **WhatsApp** texts as they go.
- **SMS and WhatsApp:** they follow the school's approved DLT / WhatsApp templates, so they are shown
  but not changed here; they are changed in Communication → Templates.
- **Send the offer** makes the offer. Only what was changed is sent as a change, and it applies to this
  family's email only; the school's template stays as it is.
- **API:**
  - `POST admissions/registrations/:id/offer-preview {subject?, intro?, note?}` (decide permission)
    gives the amount, the email (to, on, subject, intro, note, rows, html) and the sms and whatsapp
    texts (to, on, text).
  - `POST …/decide` takes `offerMessage {subject?, intro?, note?}`.
  - In `makeOffer`, a changed email goes through `app.admission_mail` (the subject is set on the
    queued message), and SMS and WhatsApp through `app.send_template` as before.
- **Fix found on the way (migration 0264):** every admission notice passed `{{school}}` empty, so the
  SMS read "offered admission to Class I at .". `app.admission_notify` now fills in the school's name.
- **Not covered:** offers made in bulk on the Selection page (and the next offer from the waiting list)
  still use the template as it is. Excel offers are previewed (below).

Checked:

- Admission e2e: 64 pass. They cover the preview with a changed message (the html carries it, the SMS
  names the school), then the offer sent with a changed subject and message, with the queued email
  checked.
- Browser: the dialog and its email preview, opened on registration 1398 and closed without sending.

## Rebuilt (27 Oct 2026, asked on the screen)

- **The dialog:** a wide dialog (`Dialog size="xl"`, new: up to 1180 px and 92 % of the height) that
  scrolls inside, so the buttons are always in view.
- **"Goes to" row:** Email, SMS and WhatsApp with each recipient, struck through when not sent, plus the
  fee and the pay-by date.
- **Two panes:**
  - **The email's words** on the left: Subject, Message, Closing line, a "Changed" badge and "Back
    to the school's words".
  - **The preview** on the right, with Email / SMS / WhatsApp tabs. It follows the typing (600 ms
    after it stops), so there is no Update button.
- The facts table above the preview is gone, because the preview shows the facts.
- **On a phone:** one column.

## Excel offers previewed (27 Oct 2026)

- On Approvals → Excel decisions, a checked sheet with **Offer** rows shows **Preview the offers and
  apply N** instead of Apply. It opens the same dialog for the batch:
  - "Offer admission to N families", with the names it goes to;
  - the first family as the sample;
  - **Apply and send N offers** as the button.
- **The batch's words:** the same for every family. The fields start as the school's template, with
  `{{name}}`, `{{class}}`, `{{number}}`, `{{amount}}`, `{{due}}` and `{{school}}` filled in for each
  family when it is sent. The preview shows them filled in for the first family.
- **API:**
  - `POST admissions/approvals/:id/offer-preview` (for the approver of that registration).
  - The preview answers `templates {subject, intro, note, fields}`.
  - `POST …/approvals/sheet?apply=1&subject=&intro=&note=` passes the words to each offer row.
  - The sheet's rows answer `id` and `offer`.
  - Edited words are filled in per family in `makeOffer` and in the preview.
- **Checked:** admission e2e, 64 pass. They cover `{{name}}` and `{{class}}` filled in on the
  preview (subject and html) and the template words answered.
