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
- **Not covered:** offers made in bulk from Selection (and the next offer from the waiting list) still
  use the template as it is.

Checked:

- Admission e2e: 64 pass. They cover the preview with a changed message (the html carries it, the SMS
  names the school), then the offer sent with a changed subject and message, with the queued email
  checked.
- Browser: the dialog and its email preview, opened on registration 1398 and closed without sending.
