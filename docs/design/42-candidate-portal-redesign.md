# 42 — Candidate portal rebuilt like the parent portal (plan, 24 Oct 2026)

The candidate portal (`/[school]/admission`, public app :3003) is one long page inside the school's website
frame: instructions as text, a classes table, merit points, the sign-in box at the bottom; after sign-in the
same page grows My registrations, Late-entry passcode and the inbox, and each registration opens another
long page (status, steps, slot, offer, pay, documents, form). No menu, no dashboard, no view per child.

The parent portal (:3001) is the reference: a centred sign-in card; then a navy sidebar menu, a top bar
(school + session, हिंदी, messages with a count, notifications, profile, sign out), a bottom tab bar on
phones; Home = greeting, child chips, the child's card, an action banner, "Today at a glance" figure cards,
notices, what is coming up. Its shell styles (`ep-shell`, `ep-sidebar`, `ep-nav`, `ep-header`, `fp-*`)
are in the shared `app.css`, so the public app can use them as they are.

Benchmark (Entab, Edunext, MyClassboard admission portals): an applicant dashboard with a menu
(Dashboard, Application, Payments & receipts, Documents, Admit card, Messages, Help), a switcher per
child, a tracker per registration and one clear "what to do next"; before sign-in a short page with the
open classes, dates, eligibility, fee and how to apply.

## Decisions (asked and answered, 24 Oct 2026)

| #   | Question             | Decision                                                                                                                                                                   |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Layout after sign-in | **The parent portal's shell**: navy sidebar "Admission Portal", top bar (school + session, messages, sign out), bottom tab bar on phones                                   |
| 2   | Home                 | **Per-child dashboard**: chips per child, the child's card, one next-step banner, at-a-glance cards, progress tracker, latest messages                                     |
| 3   | Sign-in page         | **Card + open classes**: centred sign-in card like the parent login, below it the open sessions with classes, dates, fee, eligibility, instructions, merit points, Enquire |
| 4   | Language             | **English + Hindi**: the parent portal's हिंदी switch for the portal's own words; the school's form questions stay as the school wrote them                                |

Defaults taken (change on request): the menu is Home · My registrations · Apply for a class · Payments &
receipts · Messages · Help; a child chip = a registration (its candidate's name, or "New form" for an empty
draft); the registration page gets tabs Overview · Form · Documents · Payments; the late-entry passcode box
moves to Apply for a class; nothing in the API's rules changes (duplicates, closing, passcodes, codes stay
as built); the school website pages (careers, appointments, consent…) keep the website frame.

## Parts

**Part 1 — Shell and sign-in (built 24 Oct 2026).** The admission pages leave the website frame for their own layout: signed
out, a centred card (school logo and name, "Admission portal", mobile / email / registration no., code)
with the open sessions below (classes with dates, date of birth window, fee, merit points, instructions,
Enquire); signed in, the shell (sidebar with the menu above, top bar with school + session, messages with
the unread count, हिंदी, sign out; bottom tab bar on phones). The Hindi words for the portal's own text.

**Part 2 — Home dashboard per child (built 25 Oct 2026).** One API call for the family's dashboard: per registration the
candidate, class, session, registration no., status, stage, photo, fee due, next date (test / interview),
offer and its last date, merit points, correction asked. Home: "Namaste, <family>", a chip per child, the
child's card (photo, class, registration no., status, View form, Download form PDF), the next-step banner
(pay the registration fee · correct the form · test on <date> with the admit card · pay the admission fee
by <date> · admitted: open the parent portal), at-a-glance cards (stage, next date, fee due, merit points),
the tracker of the class's steps, the latest messages, the session's important dates. A family with no
registration sees "Apply for a class".

**Part 3 — My registrations, Apply, the registration page.** My registrations: cards per registration
(drafts first, Continue / Delete), with "Register another child". Apply for a class: the open sessions and
their classes (Continue the form / Register / Register another child), and the late-entry passcode. The
registration page in the shell with tabs: Overview (status, tracker, slot and admit card, offer, the
notices of a closed class or a correction), Form (fill or read), Documents (View / Download icons),
Payments (what is due, Pay, receipts).

**Part 4 — Payments, Messages, Help, finish.** Payments & receipts across the family's registrations (due
now, paid with receipts). Messages: the school's notices and messages with unread marks. Help: Enquire,
the school's contact, how the process works, FAQs. Hindi throughout; phone layout and the bottom tab bar
checked; a11y for the portal pages.
