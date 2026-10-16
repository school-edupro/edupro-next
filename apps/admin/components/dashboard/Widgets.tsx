import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/nav-icons';
import type { Person, WidgetData } from '@/lib/dashboard';
import { wishBirthday } from '@/lib/dashboard-actions';

const money = (v: string | number | null | undefined) =>
  `₹${Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const dayOf = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) /
      86400e3,
  );

/** A widget: a white card, its title with a cyan line icon and a link on the right, then the body. */
export function Widget({
  title,
  icon,
  href,
  hrefLabel = 'Open',
  wide,
  children,
}: {
  title: string;
  icon?: IconName;
  href?: string;
  hrefLabel?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`db-w${wide ? ' db-w--wide' : ''}`} aria-label={title}>
      <header className="db-w__head">
        <h2 className="db-w__title">
          {icon ? (
            <span className="db-w__icon" aria-hidden="true">
              <Icon name={icon} size={18} />
            </span>
          ) : null}
          {title}
        </h2>
        {href ? (
          <a className="db-w__link" href={href}>
            {hrefLabel}
          </a>
        ) : null}
      </header>
      <div className="db-w__body">{children}</div>
    </section>
  );
}

/** A number with its label, optionally a link and a tone. */
export function Stat({
  value,
  label,
  href,
  tone,
}: {
  value: ReactNode;
  label: string;
  href?: string;
  tone?: 'good' | 'bad' | 'warn';
}) {
  const body = (
    <>
      <span className={`db-stat__value${tone ? ` db-stat__value--${tone}` : ''}`}>{value}</span>
      <span className="db-stat__label">{label}</span>
    </>
  );
  return href ? (
    <a className="db-stat" href={href}>
      {body}
    </a>
  ) : (
    <div className="db-stat">{body}</div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="db-empty">{children}</p>;

/** Present and absent over the last days, as two lines (SVG, no library). */
export function AttendanceChart({
  points,
}: {
  points: Array<{ date: string; present: number; absent: number }>;
}) {
  if (points.length < 2) return <Empty>Not enough days marked yet.</Empty>;
  const W = 640;
  const H = 180;
  const P = 28;
  const max = Math.max(1, ...points.map((p) => Math.max(p.present, p.absent)));
  const x = (i: number) => P + (i * (W - 2 * P)) / (points.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = (k: 'present' | 'absent') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  return (
    <figure className="db-chart">
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label="Present and absent, day by day"
      >
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={P}
            x2={W - P}
            y1={y(max * f)}
            y2={y(max * f)}
            className="db-chart__grid"
          />
        ))}
        <path
          d={`${line('present')} L${x(points.length - 1)},${H - P} L${P},${H - P} Z`}
          className="db-chart__area"
        />
        <path d={line('present')} className="db-chart__present" />
        <path d={line('absent')} className="db-chart__absent" />
        {points.map((p, i) => (
          <g key={p.date}>
            <circle cx={x(i)} cy={y(p.present)} r={4} className="db-chart__dot-present">
              <title>{`${dayOf(p.date)}: ${String(p.present)} present`}</title>
            </circle>
            <circle cx={x(i)} cy={y(p.absent)} r={4} className="db-chart__dot-absent">
              <title>{`${dayOf(p.date)}: ${String(p.absent)} absent`}</title>
            </circle>
            <text x={x(i)} y={H - 6} textAnchor="middle" className="db-chart__label">
              {dayOf(p.date)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="db-chart__legend">
        <span className="db-chart__key db-chart__key--present">Present</span>
        <span className="db-chart__key db-chart__key--absent">Absent</span>
      </figcaption>
    </figure>
  );
}

function Birthdays({
  people,
  kind,
  canWish,
  days,
}: {
  people: { today: Person[]; upcoming: Person[] } | null;
  kind: 'student' | 'employee';
  canWish: boolean;
  days: number;
}) {
  if (!people) return <Empty>Not available.</Empty>;
  if (!people.today.length && !people.upcoming.length)
    return <Empty>No birthday in the next {days} days.</Empty>;
  return (
    <>
      {people.today.length ? (
        <ul className="db-list">
          {people.today.map((p) => (
            <li key={p.id} className="db-list__row db-birthday">
              <span className="db-avatar" aria-hidden="true">
                {p.name
                  .split(' ')
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <span className="db-list__main">
                <strong>{p.name}</strong>
                <span className="db-muted">{[p.sub, p.section].filter(Boolean).join(' · ')}</span>
              </span>
              {p.wished ? (
                <span className="ep-badge ep-badge--success">Wished</span>
              ) : canWish ? (
                <form action={wishBirthday}>
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="name" value={p.name} />
                  <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                    Wish
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No birthday today.</Empty>
      )}
      {people.upcoming.length ? (
        <>
          <h3 className="db-sub">Next {days} Days</h3>
          <ul className="db-list">
            {people.upcoming.slice(0, 8).map((p) => (
              <li key={p.id} className="db-list__row">
                <span className="db-date db-date--muted">
                  <b>{p.days}</b>
                  <small>{p.days === 1 ? 'day' : 'days'}</small>
                </span>
                <span className="db-list__main">
                  <strong>{p.name}</strong>
                  <span className="db-muted">{[p.sub, p.section].filter(Boolean).join(' · ')}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/** The body of one widget from the loaded data; null when the widget has nothing to show for this user. */
export function renderWidget(
  key: string,
  title: string,
  d: WidgetData,
  opts: { permissions: string[]; wide?: boolean; days?: number; count?: number },
): ReactNode {
  const can = (p: string) => opts.permissions.includes(p);
  const wide = opts.wide;
  const count = opts.count ?? 8;
  switch (key) {
    case 'today': {
      const att = d.desk?.class;
      const pct = att?.percent ?? d.principal?.attendance.pct ?? null;
      const approvals = (d.approvals ?? []).reduce((a, g) => a + g.count, 0);
      return (
        <Widget title={title} icon="home" wide={wide}>
          <div className="db-stats">
            {att ? (
              <Stat
                value={`${String(att.present)} / ${String(att.strength)}`}
                label={`Pupils present${pct !== null ? ` · ${String(pct)}%` : ''}`}
                href="/attendance"
              />
            ) : null}
            {att ? (
              <Stat
                value={att.absent}
                label="Absent"
                tone={att.absent ? 'bad' : undefined}
                href="/attendance"
              />
            ) : null}
            {att ? (
              <Stat
                value={`${String(att.markedSections)} / ${String(att.sections)}`}
                label="Sections marked"
                tone={att.markedSections < att.sections ? 'warn' : 'good'}
                href="/attendance"
              />
            ) : null}
            {d.punch ? (
              <Stat value={d.punch.present} label="Staff in" href="/attendance/punches" />
            ) : null}
            {d.fees ? (
              <Stat
                value={money(d.fees.collectedToday)}
                label="Fee collected today"
                href="/fees/mis"
                tone="good"
              />
            ) : null}
            {d.visitors ? (
              <Stat value={d.visitors.inside} label="Visitors inside" href="/engagement/visitors" />
            ) : null}
            {d.helpdesk ? (
              <Stat
                value={d.helpdesk.total}
                label="Queries with me"
                tone={d.helpdesk.overdue ? 'bad' : undefined}
                href="/engagement/helpdesk"
              />
            ) : null}
            <Stat
              value={approvals}
              label="Waiting for me"
              tone={approvals ? 'warn' : undefined}
              href="/approvals"
            />
          </div>
        </Widget>
      );
    }
    case 'approvals': {
      const groups = (d.approvals ?? []).filter((g) => g.count > 0);
      return (
        <Widget title={title} icon="inbox" href="/approvals" hrefLabel="All">
          {groups.length ? (
            <ul className="db-list">
              {groups.map((g) => (
                <li key={g.href} className="db-list__row">
                  <a className="db-list__main" href={g.href}>
                    <strong>{g.title}</strong>
                  </a>
                  <span className="ep-badge ep-badge--warning">{g.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing is waiting for you.</Empty>
          )}
        </Widget>
      );
    }
    case 'news':
      return (
        <Widget title={title} icon="file" href="/academics/notices" hrefLabel="All">
          {d.notices?.length ? (
            <ul className="db-list">
              {d.notices.slice(0, count).map((n) => (
                <li key={n.id} className="db-list__row">
                  <span
                    className={`db-date${n.publishFrom.slice(0, 10) === d.today ? ' db-date--now' : ''}`}
                  >
                    <b>{n.publishFrom.slice(8, 10)}</b>
                    <small>{dayOf(n.publishFrom).slice(3)}</small>
                  </span>
                  <a className="db-list__main" href={`/academics/notices/${n.id}`}>
                    <strong>{n.title}</strong>
                    <span className="db-muted">
                      {n.kind === 'office_order' ? 'Office order' : 'Notice'}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No notice published.</Empty>
          )}
        </Widget>
      );
    case 'holidays': {
      const all = (d.calendar ?? []).slice().sort((a, b) => a.startsOn.localeCompare(b.startsOn));
      const next = all.filter((h) => h.endsOn >= d.today).slice(0, count);
      const past = all
        .filter((h) => h.endsOn < d.today)
        .slice(-2)
        .reverse();
      return (
        <Widget title={title} icon="calendar" href="/academics/calendar" hrefLabel="Calendar">
          {next.length ? (
            <ul className="db-list">
              {next.map((h) => (
                <li key={h.id} className="db-list__row">
                  <span className={`db-date${h.startsOn <= d.today ? ' db-date--now' : ''}`}>
                    <b>{h.startsOn.slice(8, 10)}</b>
                    <small>{dayOf(h.startsOn).slice(3)}</small>
                  </span>
                  <span className="db-list__main">
                    <strong>{h.name}</strong>
                    <span className="db-muted">
                      {h.startsOn <= d.today
                        ? 'today'
                        : `${String(daysBetween(d.today, h.startsOn))} days away`}
                      {h.kind === 'vacation' ? ' · vacation' : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No holiday ahead this session.</Empty>
          )}
          {past.length ? (
            <ul className="db-list db-list--past">
              {past.map((h) => (
                <li key={h.id} className="db-list__row">
                  <span className="db-date db-date--muted">
                    <b>{h.startsOn.slice(8, 10)}</b>
                    <small>{dayOf(h.startsOn).slice(3)}</small>
                  </span>
                  <span className="db-list__main">
                    <span>{h.name}</span>
                    <span className="db-muted">
                      {String(daysBetween(h.endsOn, d.today))} days ago
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Widget>
      );
    }
    case 'attendance_trend': {
      const pts = d.principal?.attendance.trend.slice(-7).map((t) => ({
        date: t.date,
        present: t.present,
        absent: Math.max(0, t.strength - t.present),
      }));
      const att = d.desk?.class ?? null;
      return (
        <Widget title={title} icon="chart" href="/attendance" hrefLabel="Attendance" wide={wide}>
          <div className="db-stats db-stats--inline">
            {att ? <Stat value={att.present} label="Present today" tone="good" /> : null}
            {att ? <Stat value={att.absent} label="Absent today" tone="bad" /> : null}
            {att?.percent !== undefined && att?.percent !== null ? (
              <Stat value={`${String(att.percent)}%`} label="Today" />
            ) : null}
          </div>
          {pts ? (
            <AttendanceChart points={pts} />
          ) : (
            <Empty>The attendance trend needs the insights right.</Empty>
          )}
        </Widget>
      );
    }
    case 'staff_attendance':
      return (
        <Widget title={title} icon="users" href="/attendance/punches" hrefLabel="Punches">
          {d.punch ? (
            <div className="db-stats">
              <Stat value={d.punch.present} label="In today" tone="good" />
              <Stat
                value={d.punch.absent}
                label="Not in"
                tone={d.punch.absent ? 'bad' : undefined}
              />
            </div>
          ) : (
            <Empty>Not available.</Empty>
          )}
        </Widget>
      );
    case 'birthdays_staff':
      return (
        <Widget title={title} icon="heart">
          <Birthdays
            people={d.birthdaysStaff}
            kind="employee"
            canWish={can('people.birthday.wish')}
            days={opts.days ?? 7}
          />
        </Widget>
      );
    case 'birthdays_students':
      return (
        <Widget title={title} icon="heart">
          <Birthdays
            people={d.birthdaysStudents}
            kind="student"
            canWish={can('people.birthday.wish')}
            days={opts.days ?? 7}
          />
        </Widget>
      );
    case 'fees_today': {
      const f = d.fees;
      const chequeAmount = (d.cheques ?? []).reduce((a, c) => a + Number(c.amount), 0);
      const change =
        f && Number(f.previous7d)
          ? Math.round(
              ((Number(f.collected7d) - Number(f.previous7d)) / Number(f.previous7d)) * 100,
            )
          : null;
      return (
        <Widget title={title} icon="wallet" href="/fees/mis" hrefLabel="Fee reports" wide={wide}>
          <div className="db-stats">
            {f ? (
              <Stat
                value={money(f.collectedToday)}
                label="Collected today"
                tone="good"
                href="/fees/mis"
              />
            ) : null}
            {f ? (
              <Stat
                value={money(f.collected7d)}
                label={`Last 7 days${change !== null ? ` · ${change >= 0 ? '+' : ''}${String(change)}%` : ''}`}
              />
            ) : null}
            {f ? (
              <Stat
                value={money(f.balance)}
                label="Balance of the session"
                tone="warn"
                href="/fees/mis"
              />
            ) : null}
            {d.cheques ? (
              <Stat
                value={`${String(d.cheques.length)} · ${money(chequeAmount)}`}
                label="Cheques to deposit"
                href="/fees/deposit-slips"
              />
            ) : null}
            {d.refunds !== null && d.refunds !== undefined ? (
              <Stat value={d.refunds} label="Refunds waiting" href="/fees/refunds" />
            ) : null}
          </div>
          {f?.byMode30d.length ? (
            <ul className="db-bars" aria-label="Collection by mode, last 30 days">
              {f.byMode30d.map((m) => {
                const top = Math.max(...f.byMode30d.map((x) => Number(x.amount)));
                return (
                  <li key={m.mode} className="db-bars__row">
                    <span className="db-bars__label">{m.mode.toUpperCase()}</span>
                    <span className="db-bars__track">
                      <span
                        className="db-bars__fill"
                        style={{ width: `${String(Math.round((Number(m.amount) / top) * 100))}%` }}
                      />
                    </span>
                    <span className="db-bars__value">{money(m.amount)}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Widget>
      );
    }
    case 'fees_dues': {
      const f = d.fees;
      return (
        <Widget title={title} icon="wallet" href="/fees/reminders/new" hrefLabel="Send reminders">
          {f ? (
            <>
              <div className="db-stats db-stats--inline">
                <Stat value={money(f.balance)} label="Balance" tone="warn" />
                <Stat value={money(f.collectedTillDate)} label="Collected" tone="good" />
              </div>
              <h3 className="db-sub">Top Defaulters</h3>
              <ul className="db-list">
                {f.defaulters.slice(0, 5).map((x) => (
                  <li key={x.studentId} className="db-list__row">
                    <a className="db-list__main" href={`/fees/ledger/${x.studentId}`}>
                      <strong>{x.name}</strong>
                      <span className="db-muted">
                        {x.admissionNo} · {x.section} · {x.daysOverdue} days
                      </span>
                    </a>
                    <span className="db-amount">{money(x.balance)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty>Not available.</Empty>
          )}
        </Widget>
      );
    }
    case 'admissions':
      return (
        <Widget title={title} icon="userPlus" href="/admissions" hrefLabel="Admissions">
          {d.admissions?.byStatus.length ? (
            <div className="db-stats">
              {d.admissions.byStatus.map((s) => (
                <Stat
                  key={s.status}
                  value={s.count}
                  label={s.status.replace(/_/g, ' ')}
                  href={`/admissions/applications?status=${s.status}`}
                />
              ))}
            </div>
          ) : (
            <Empty>No application in the open cycles.</Empty>
          )}
        </Widget>
      );
    case 'front_office':
      return (
        <Widget title={title} icon="key" href="/engagement/visitors" hrefLabel="Visitors">
          <div className="db-stats">
            {d.visitors ? (
              <Stat value={d.visitors.inside} label="Visitors inside" href="/engagement/visitors" />
            ) : null}
            {d.visitors ? (
              <Stat
                value={d.visitors.waiting}
                label="Waiting at the gate"
                tone={d.visitors.waiting ? 'warn' : undefined}
                href="/engagement/visitors?state=waiting"
              />
            ) : null}
            {d.appointments ? (
              <Stat
                value={`${String(d.appointments.today.inside)} / ${String(d.appointments.today.total)}`}
                label="Appointments in today"
                href="/engagement/appointments"
              />
            ) : null}
            {d.appointments ? (
              <Stat
                value={d.appointments.waiting}
                label="Requests to decide"
                tone={d.appointments.waiting ? 'warn' : undefined}
                href="/engagement/appointments"
              />
            ) : null}
            {d.gatePasses ? (
              <Stat
                value={d.gatePasses.counts.handover}
                label="Gate passes to hand over"
                href="/engagement/gate-passes"
              />
            ) : null}
            {d.gatePasses ? (
              <Stat
                value={d.gatePasses.overdue}
                label="Out and overdue"
                tone={d.gatePasses.overdue ? 'bad' : undefined}
                href="/engagement/gate-passes"
              />
            ) : null}
          </div>
        </Widget>
      );
    case 'helpdesk':
      return (
        <Widget title={title} icon="message" href="/engagement/helpdesk" hrefLabel="Helpdesk">
          {d.helpdesk ? (
            <>
              <div className="db-stats db-stats--inline">
                <Stat value={d.helpdesk.total} label="With me" />
                <Stat
                  value={d.helpdesk.overdue}
                  label="Past due"
                  tone={d.helpdesk.overdue ? 'bad' : undefined}
                />
              </div>
              <ul className="db-list">
                {d.helpdesk.latest.slice(0, opts.count ?? 3).map((q) => (
                  <li key={q.id} className="db-list__row">
                    <a className="db-list__main" href={`/engagement/helpdesk/${q.desk}/${q.id}`}>
                      <strong>{q.subject}</strong>
                      <span className="db-muted">{q.number}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty>Not available.</Empty>
          )}
        </Widget>
      );
    case 'hostel':
      return (
        <Widget title={title} icon="bed" href="/hostel/dashboard" hrefLabel="Hostel">
          {d.hostel ? (
            <div className="db-stats">
              <Stat value={d.hostel.boarders} label="Boarders" href="/hostel" />
              <Stat value={d.hostel.away} label="Away on leave" href="/hostel/leave" />
              <Stat
                value={d.hostel.overdue}
                label="Overdue"
                tone={d.hostel.overdue ? 'bad' : undefined}
                href="/hostel/leave?show=overdue"
              />
              <Stat
                value={`${String(d.hostel.rollsTaken)} / ${String(d.hostel.sessions)}`}
                label="Roll-calls today"
                href="/hostel/rollcall"
              />
              <Stat
                value={d.hostel.absentToday}
                label="Absent at roll-call"
                tone={d.hostel.absentToday ? 'bad' : undefined}
              />
              <Stat
                value={d.hostel.waiting}
                label="Leave to approve"
                tone={d.hostel.waiting ? 'warn' : undefined}
              />
            </div>
          ) : (
            <Empty>Not available.</Empty>
          )}
        </Widget>
      );
    case 'transport':
      return (
        <Widget title={title} icon="bus" href="/transport" hrefLabel="Transport">
          {d.transport ? (
            <div className="db-stats">
              <Stat
                value={d.transport.pending.length}
                label="Requests waiting"
                tone={d.transport.pending.length ? 'warn' : undefined}
                href="/transport/requests"
              />
              {Object.entries(d.transport.kpis)
                .filter(([, v]) => typeof v === 'number')
                .slice(0, 5)
                .map(([k, v]) => (
                  <Stat
                    key={k}
                    value={v as number}
                    label={k.replace(/([A-Z])/g, ' $1').toLowerCase()}
                  />
                ))}
            </div>
          ) : (
            <Empty>Not available.</Empty>
          )}
        </Widget>
      );
    case 'library':
      return (
        <Widget title={title} icon="book" href="/library/circulation" hrefLabel="Circulation">
          {d.library !== null ? (
            <Stat
              value={d.library}
              label="Books overdue"
              tone={d.library ? 'warn' : undefined}
              href="/library/circulation"
            />
          ) : (
            <Empty>Not available.</Empty>
          )}
        </Widget>
      );
    case 'clinic':
      return (
        <Widget title={title} icon="heart" href="/engagement/clinic" hrefLabel="Clinic">
          {d.clinic ? (
            <div className="db-stats">
              <Stat value={d.clinic.today.visits} label="Visits today" />
              <Stat
                value={d.clinic.today.inClinic}
                label="In the clinic now"
                tone={d.clinic.today.inClinic ? 'warn' : undefined}
              />
              <Stat value={d.clinic.today.sentHome} label="Sent home" />
              <Stat value={d.clinic.today.thisMonth} label="This month" />
            </div>
          ) : (
            <Empty>Not available.</Empty>
          )}
        </Widget>
      );
    default:
      return null;
  }
}
