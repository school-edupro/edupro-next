# The landing page by role (October 2026)

After sign-in, the admin app opens on a page made for the user's role: a greeting with the date and
session, then widgets in the role's order. A widget shows only when the user holds its permission, so
nobody sees figures their role cannot open. Teachers keep using the staff app.

| Role                                                                    | First widgets                                                                                                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principal / School admin                                                | Today at a glance, quick actions, waiting for me, attendance trend, fee collection, news, birthdays, holidays, admissions, helpdesk, staff attendance |
| Accounts                                                                | Fee collection today, quick actions, dues and defaulters, waiting for me, news, holidays                                                              |
| Front office / Gate                                                     | Front office (visitors, appointments, gate passes), quick actions, admissions, helpdesk, pupil birthdays                                              |
| Module heads (transport, warden, librarian, doctor, nurse, coordinator) | Their own module's widget first, then the common ones                                                                                                 |

- **Quick actions**: pinned tiles plus _Search pages…_ over every page the user may open.
- **Arrange my page** (top right): tick to show or hide a widget, ↑ ↓ to move it, pick up to 12 quick
  actions, _Save my page_. _Back to the role's page_ drops the user's own arrangement.
- **System → Landing pages** (_platform.dashboard.manage_, school and group admins). Pick a role (the
  built-in ones, and below them the roles the school made under Access), then:
  - **Widgets**: tick, number the order, give an own title, Normal or Wide, and for birthdays the days
    ahead (1–31) or for News, Holidays and Helpdesk the rows shown.
  - **Quick menu**: add a page by typing its name, rename a tile, change its icon, move it, remove it;
    add a school link outside EduPro (name + https address), which opens in a new tab.
  - **Lock this page**: the role's people cannot arrange their own page and see "Page set by the school".
  - **Copy from…** another role, **Push to all users** (removes their own arrangements, asks first),
    **Back to built-in** (drops the school's settings, asks first), **Preview as …** (the figures are read
    with your own rights).
  - A person with a school-made role that has a landing lands on it; else the built-in role order applies.
- **Birthdays**: staff and pupils today and in the next 7 days. _Wish_ (front office and admins,
  _people.birthday.wish_) works only on the day and once per person per day: a greeting in the staff app
  or the parents' portal, and by SMS / WhatsApp only when the school has made the template
  `birthday_wish` ready. The page says which channels went out; with none ready the wish is still recorded.
- Each widget links to its full page (e.g. Fee collection → Fee reports, Helpdesk → Helpdesk).
