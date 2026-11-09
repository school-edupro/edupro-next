# Leave & attendance (staff)

Staff apply for leave; their approvers decide it level by level; balances are credited by policy and
held while a leave waits. Staff attendance is worked out from the biometric punches: late marks and
missing punches turn into leave, and an absent day nobody explains becomes loss of pay. This page
covers the **set-up** (built); applying, approving, balances, the attendance register and the reports
follow in the next releases.

## Who does what

| Who                                                   | What                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Leave & attendance office** (its own role)          | Keeps the set-up: leave types, policies, weekly offs, shifts, who approves, the settings |
| **School admin**                                      | The same as the leave office                                                             |
| **Approvers** (HOD, reporting manager, named staff …) | Decide the leave of the staff a rule sends to them (next release)                        |
| **Every employee**                                    | Applies for leave and asks for attendance corrections (next release)                     |

## The set-up (Employee management → Leave & attendance set-up)

The page shows six figures, a **To look at** list (what is missing or would misbehave — no policy for
a leave type, staff without an approver, a type ordered after loss of pay …), four sections and the
leave types at a glance. Fill the sections in order.

**1. Leave rules**

- **Leave types** — a school starts with ten: CL, EL, SL, HPL, CO, OD, WFH, ML, PL and LOP. For each:
  paid or **loss of pay** (no pay, no balance, a half day always allowed), **keeps a balance** (credited
  by a policy, checked and held when applied; no for on duty or maternity, which only have their limits),
  counts as present (on duty, work from home), half day allowed, approved at once, document needed, not
  next to other leave, for days ahead, the fewest and most days an application, the most days a month (a
  type without a balance), the **deduction order** (late marks, missing punches and absence take CL, then
  EL … loss of pay last), how often it is credited, carry forward and its cap, for men / women, pay %
  (half-pay leave, for payroll).
- **Leave policies** — how many days a year staff get of a leave type, for all staff or the
  departments, designations, employee types or employees listed. An employee follows the **first policy
  of the type by priority** (lowest number) that takes them in, so give a narrow policy a lower number
  than one for all. Credits come **quarterly, half-yearly or yearly** (never monthly) in the credit
  months of the session — April + half-yearly = April and October; type them to choose others. Days a
  credit (empty: the days a year shared evenly), pro rata on joining, carry forward and cap (the lower
  of the policy's and the type's), the fewest and most days an application, the **sandwich** (a weekly
  off, a declared holiday or an optional holiday between two leave days is charged too), and
  encashment (information for payroll).
- **Who approves** — a rule is for all staff or those picked, and for one leave type or any type. A leave
  goes to the first rule by priority that takes the employee in (a rule for its type before one for any
  type) and to the levels of its length: **up to 7 days, more than 7 up to 30, more than 30**. Each band
  has up to 3 levels: named staff, the reporting manager, the HOD of the employee's department, everyone
  with a designation, or a role. A band with no level leaves it to the next rule. Approvers are worked out
  when the leave is applied, so a new joiner is covered. A level nobody holds is skipped; nobody approves
  their own leave; the same person at two levels in a row approves once. A separate kind of rule sets
  who approves **attendance corrections**. **Test the chain** shows, for an employee, a leave type and so
  many days, the rule and the people at each level today — or why there is nobody.

**2. The calendar**

- **Weekly offs** — weekdays (1 Monday … 7 Sunday) in the weeks of the month you list (2,4 = the 2nd
  and 4th Saturday; empty = every week), or a list of dates (a rotating off), for all staff or those
  picked. A day is off when any rule for the employee makes it off. A school starts with Sunday.
- **Holidays** — kept on the school calendar (holidays for everyone or for employees).

**3. Shifts and timings**

- **Shifts** — start and end (24-hour), grace minutes, the hours for a present day and a half day, the
  shift's hours, overtime, **bus duty** (never marked late), what a day with **one punch only** is (absent,
  half day or present), and the **late / early rule**: late in (after the grace) or out early by at least
  so many minutes makes the day a half day, absent, or half a day of a leave type. A day shift ends after
  it starts; a night shift may end the next morning. A school starts with General (08:00–15:30) and Bus
  duty (06:30–16:30).
- **Shift postings** — which shift an employee works from a day (to a day). A later start wins an
  overlap; a posting of one day changes that day only. Staff without a posting work the default shift.

**4. Settings** — late marks for one day of leave (3), missing punches for one day of leave (4), loss of
pay after so many days of absence with no application (7), the date to count late marks from (a fresh
start), the default shift, punches closer than so many minutes are one (10), how far back the nightly
re-check and absent marking look, whether late minutes lower the day's hours, whether the office may
change punch times and apply leave for an employee, how far back leave may be applied, this school's
device serials (for punches read from the central device database), who else gets the missing-punch
e-mails, and the message channels (e-mail, WhatsApp, app; SMS once its templates are approved).

Every grid (types, policies, weekly offs, shifts, postings) downloads as Excel or PDF and takes an Excel
upload; a wrong value is refused with the reason (a loss-of-pay type marked paid, a quarterly policy
with two credit months, a day shift that ends before it starts).

## Common questions

1. **A teacher gets no CL.** Leave types at a glance shows how many staff are in no policy of the type:
   add a policy for them, or widen one.
2. **Who would approve a 10-day leave of this teacher?** Who approves → Test the chain.
3. **The Accounts staff should go to the accountant first.** Add a rule for the Accounts department with
   a lower priority number than the rule for all staff, and set its levels.
4. **Second and fourth Saturdays are off.** Weekly offs: weekdays 6, weeks 2,4.
5. **A new joiner has no approver.** Rules are worked out when the leave is applied: if the joiner's
   department, designation or type is in a rule, they are covered at once.
