import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { FileLinks } from '@/components/FileLinks';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t, type Lang } from '@/lib/i18n';
import { applyLeave, cancelLeave } from './actions';

interface Child {
  id: string;
  name: string;
  section: string | null;
  month: string;
  days: Array<{ date: string; code: string; inAt: string | null; outAt: string | null }>;
  summary: { days: number; present: number; absent: number; leave?: number };
}
interface BusChild {
  id: string;
  days: Array<{ date: string; pick: string | null; drop: string | null; route: string }>;
  summary: { trips: number; onBus: number; notOnBus: number };
}
interface YearChild {
  id: string;
  name: string;
  section: string | null;
  months: Array<{
    month: string;
    days: number;
    present: number;
    absent: number;
    leave: number;
    late: number;
  }>;
  total: { days: number; present: number; absent: number; leave: number; late: number };
}
interface Leave {
  id: string;
  number: string;
  studentId: string;
  student: string;
  leaveTypeLabel: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  fileIds: string[];
  long: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decisionNote: string | null;
  endedOn: string | null;
  waitingOn: string | null;
}
interface MyLeaves {
  longDays: number;
  backDays: number;
  types: Array<{ value: string; label: string; certificate?: string; maxDays?: number | null }>;
  students: Array<{ id: string; name: string }>;
  leaves: Leave[];
}
type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';
const BUS: Record<string, [string, Tone]> = {
  P: ['On the bus', 'success'],
  A: ['Not on the bus', 'danger'],
  LV: ['On leave', 'info'],
  GP: ['Gate pass', 'warning'],
  OT: ['Other arrangement', 'neutral'],
};
const LABEL: Record<string, [string, Tone]> = {
  P: ['Present', 'success'],
  A: ['Absent', 'danger'],
  LV: ['On leave', 'info'],
  L: ['Late', 'warning'],
  SR: ['Short leave', 'warning'],
  H: ['Half day', 'warning'],
  OD: ['On duty', 'info'],
  SB: ['Stay back', 'info'],
};
const LEAVE_TONE: Record<string, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};
const LEAVE_STATUS: Record<string, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
};
const VIEWS = ['month', 'year', 'leave'] as const;
type View = (typeof VIEWS)[number];
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const monthOf = (v?: string) => (v && /^\d{4}-\d{2}$/.test(v) ? v : today().slice(0, 7));
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
const dayText = (d: string, withYear = false) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  });
const monthShort = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
const pctOf = (present: number, days: number) => (days ? Math.round((present / days) * 100) : null);
const pctTone = (pct: number | null): Tone =>
  pct === null ? 'neutral' : pct >= 90 ? 'success' : pct >= 75 ? 'warning' : 'danger';

/** The tiles on top of a view: what was counted and the percentage. */
function Tiles({
  lang,
  days,
  present,
  absent,
  leave,
}: {
  lang: Lang;
  days: number;
  present: number;
  absent: number;
  leave: number;
}) {
  const pct = pctOf(present, days);
  const tiles: Array<[string, string, Tone]> = [
    [t(lang, 'School days'), String(days), 'neutral'],
    [t(lang, 'Present'), String(present), 'success'],
    [t(lang, 'Absent'), String(absent), 'danger'],
    [t(lang, 'On leave'), String(leave), 'info'],
    [t(lang, 'Attendance'), pct === null ? '–' : `${String(pct)}%`, pctTone(pct)],
  ];
  return (
    <div className="ep-att__tiles">
      {tiles.map(([label, value, tone]) => (
        <div key={label} className="ep-att__tile" data-tone={tone}>
          <span className="ep-kicker">{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

/** Present, absent and leave as the parts of a ring, with the percentage in the middle. */
function Donut({
  lang,
  present,
  absent,
  leave,
}: {
  lang: Lang;
  present: number;
  absent: number;
  leave: number;
}) {
  const total = present + absent + leave;
  const R = 42;
  const C = 2 * Math.PI * R;
  const parts: Array<[string, number]> = [
    ['p', present],
    ['lv', leave],
    ['a', absent],
  ];
  const starts = parts.map((_, i) =>
    parts.slice(0, i).reduce((n, [, v]) => n + (total ? (v / total) * C : 0), 0),
  );
  const pct = pctOf(present, total);
  return (
    <svg
      className="ep-att__donut"
      viewBox="0 0 120 120"
      role="img"
      aria-label={`${t(lang, 'Present')} ${String(present)}, ${t(lang, 'Absent')} ${String(absent)}, ${t(lang, 'On leave')} ${String(leave)}`}
    >
      <circle className="ep-att-ring" cx="60" cy="60" r={R} strokeWidth="14" />
      {total
        ? parts.map(([key, n], i) => {
            if (!n) return null;
            const len = (n / total) * C;
            return (
              <circle
                key={key}
                className={`ep-att-seg ep-att-seg--${key}`}
                cx="60"
                cy="60"
                r={R}
                strokeWidth="14"
                strokeDasharray={`${String(len)} ${String(C - len)}`}
                strokeDashoffset={String(-starts[i]!)}
                transform="rotate(-90 60 60)"
              />
            );
          })
        : null}
      <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="700">
        {pct === null ? '–' : `${String(pct)}%`}
      </text>
      <text x="60" y="74" textAnchor="middle" fontSize="8">
        {t(lang, 'present')}
      </text>
    </svg>
  );
}

/** The month as a calendar: each school day carries its status. */
function Calendar({ lang, month, days }: { lang: Lang; month: string; days: Child['days'] }) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const by = new Map(days.map((d) => [Number(d.date.slice(8)), d.code]));
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  return (
    <table className="ep-att__cal">
      <caption className="ep-sr-only">{t(lang, 'The month day by day')}</caption>
      <thead>
        <tr>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <th key={d} scope="col">
              {t(lang, d)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, w) => (
          <tr key={String(w)}>
            {week.map((d, i) =>
              d === null ? (
                <td key={String(i)} data-empty="" />
              ) : (
                <td
                  key={String(i)}
                  data-code={by.get(d)}
                  title={by.has(d) ? t(lang, LABEL[by.get(d)!]?.[0] ?? by.get(d)!) : undefined}
                >
                  {d}
                  <small>{by.get(d) ?? '·'}</small>
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The session month by month: a bar per month, present below, then leave, then absent. */
function YearBars({ lang, months }: { lang: Lang; months: YearChild['months'] }) {
  const W = 640;
  const H = 200;
  const base = 168;
  const top = 18;
  const max = Math.max(1, ...months.map((x) => x.days));
  const step = (W - 40) / Math.max(1, months.length);
  const bar = Math.min(34, step * 0.6);
  const h = (n: number) => ((base - top) * n) / max;
  return (
    <svg
      className="ep-att__bars"
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      role="img"
      aria-label={t(lang, 'Attendance month by month; the table below has the same numbers')}
    >
      <line className="ep-att__axis" x1="30" y1={base} x2={W - 6} y2={base} strokeWidth="1" />
      {months.map((x, i) => {
        const cx = 40 + i * step + step / 2;
        const p = h(x.present);
        const lv = h(x.leave);
        const a = h(x.absent);
        const pct = pctOf(x.present, x.days);
        return (
          <g key={x.month}>
            <rect className="ep-att-fill--p" x={cx - bar / 2} y={base - p} width={bar} height={p} />
            <rect
              className="ep-att-fill--lv"
              x={cx - bar / 2}
              y={base - p - lv}
              width={bar}
              height={lv}
            />
            <rect
              className="ep-att-fill--a"
              x={cx - bar / 2}
              y={base - p - lv - a}
              width={bar}
              height={a}
            />
            <text
              x={cx}
              y={base - p - lv - a - 5}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
            >
              {pct === null ? '' : `${String(pct)}%`}
            </text>
            <text x={cx} y={base + 16} textAnchor="middle" fontSize="11">
              {monthShort(x.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Legend({ lang }: { lang: Lang }) {
  return (
    <div className="ep-att__legend" aria-hidden="true">
      <span data-code="P">{t(lang, 'Present')}</span>
      <span data-code="A">{t(lang, 'Absent')}</span>
      <span data-code="LV">{t(lang, 'On leave')}</span>
      <span data-code="L">{t(lang, 'Late or part of the day')}</span>
    </div>
  );
}

/**
 * The family's attendance page: this month (tiles, a ring, the calendar, the bus and the day list), the
 * session month by month with a chart, and leave (apply, follow the approval, cancel).
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const view: View = VIEWS.includes(sp.view as View) ? (sp.view as View) : 'month';
  let yearHint = '';
  let defaultMonth: string | undefined;
  let readOnly = false;
  try {
    const me = await bff.api.me();
    const y = me.academicYears?.find((x) => x.id === me.academicYear?.id);
    if (y && y.status !== 'active') {
      // a previous session (chosen on the home page) opens on its last month, not on today's
      defaultMonth = y.endDate.slice(0, 7);
      yearHint = `${t(lang, 'Session')} ${y.code} (${t(lang, 'read-only')})`;
      readOnly = true;
    }
  } catch {
    /* the fetch below reports session problems */
  }
  const kid = await chosenChild();
  const month = monthOf(sp.month ?? defaultMonth);
  let data: { month: string; children: Child[] } = { month, children: [] };
  let bus: BusChild[] = [];
  let year: { months: string[]; children: YearChild[] } = { months: [], children: [] };
  let leaves: MyLeaves | null = null;
  let unlinked = false;
  try {
    if (view === 'month') {
      data = await bff.api.fetch<{ month: string; children: Child[] }>(
        `/attendance/mine?month=${month}`,
      );
      // the bus of the same month: morning and afternoon, as the bus teacher marked it
      bus = await bff.api
        .fetch<{ children: BusChild[] }>(`/attendance/bus-roll/mine?month=${month}`)
        .then((r) => r.children)
        .catch(() => [] as BusChild[]);
    } else if (view === 'year') {
      year = await bff.api.fetch<{ months: string[]; children: YearChild[] }>(
        '/attendance/desk/mine/year',
      );
    } else leaves = await bff.api.fetch<MyLeaves>('/attendance/leaves/mine');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) unlinked = true;
    else throw error;
  }
  const tab = (v: View, label: string) => (
    <a
      key={v}
      href={v === 'month' ? '/attendance' : `/attendance?view=${v}`}
      aria-current={view === v ? 'page' : undefined}
    >
      {t(lang, label)}
    </a>
  );
  const mine = <T extends { id: string }>(rows: T[]) => rows.filter((c) => !kid || c.id === kid.id);
  const myLeaves = (leaves?.leaves ?? []).filter((l) => !kid || l.studentId === kid.id);
  const monthTitle = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Attendance')}
        title={
          view === 'month'
            ? monthTitle
            : view === 'year'
              ? t(lang, 'This session')
              : t(lang, 'Leave')
        }
        description={yearHint || undefined}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {view === 'month' ? (
              <>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/attendance?month=${shift(month, -1)}`}
                >
                  ‹ {t(lang, 'Previous')}
                </a>
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/attendance?month=${shift(month, 1)}`}
                >
                  {t(lang, 'Next')} ›
                </a>
              </>
            ) : null}
            {view !== 'leave' && !readOnly ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/attendance?view=leave#apply">
                {t(lang, 'Apply for leave')}
              </a>
            ) : null}
          </span>
        }
      />
      <ChildSwitch
        lang={lang}
        back={view === 'month' ? '/attendance' : `/attendance?view=${view}`}
      />
      <nav
        className="ep-tabs-links"
        aria-label={t(lang, 'Attendance')}
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {tab('month', 'Month')}
        {tab('year', 'Year')}
        {tab('leave', 'Leave')}
      </nav>
      {unlinked ? (
        <Card>
          {t(
            lang,
            'Your account is not linked to a student yet. Please contact the school office.',
          )}
        </Card>
      ) : null}

      {view === 'month'
        ? mine(data.children).map((c) => {
            const leave = c.summary.leave ?? 0;
            const b = bus.find((x) => x.id === c.id);
            return (
              <Card
                key={c.id}
                title={`${c.name}${c.section ? ` · ${c.section}` : ''}`}
                style={{ marginBottom: 'var(--sp-3)' }}
              >
                <Tiles
                  lang={lang}
                  days={c.summary.days}
                  present={c.summary.present}
                  absent={c.summary.absent}
                  leave={leave}
                />
                {c.days.length === 0 ? (
                  <p className="ep-field__help">{t(lang, 'No attendance marked in this month.')}</p>
                ) : (
                  <>
                    <div className="ep-att__split">
                      <Donut
                        lang={lang}
                        present={c.summary.present}
                        absent={c.summary.absent}
                        leave={leave}
                      />
                      <div>
                        <Calendar lang={lang} month={month} days={c.days} />
                        <Legend lang={lang} />
                      </div>
                    </div>
                    <details style={{ marginTop: 'var(--sp-3)' }}>
                      <summary>{t(lang, 'Day by day, with gate in and out times')}</summary>
                      <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                        <thead>
                          <tr>
                            <th scope="col">{t(lang, 'Date')}</th>
                            <th scope="col">{t(lang, 'Status')}</th>
                            <th scope="col">{t(lang, 'In')}</th>
                            <th scope="col">{t(lang, 'Out')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...c.days].reverse().map((d) => {
                            const [label, tone] = LABEL[d.code] ?? [d.code, 'neutral' as Tone];
                            return (
                              <tr key={d.date}>
                                <td>
                                  {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', {
                                    weekday: 'short',
                                    day: '2-digit',
                                    month: 'short',
                                    timeZone: 'UTC',
                                  })}
                                </td>
                                <td>
                                  <Badge tone={tone}>{t(lang, label)}</Badge>
                                </td>
                                <td>{time(d.inAt)}</td>
                                <td>{time(d.outAt)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </details>
                  </>
                )}
                {b && b.days.length ? (
                  <>
                    <h3 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-4)' }}>
                      {t(lang, 'School bus')} · {b.summary.onBus}/{b.summary.trips}{' '}
                      {t(lang, 'trips on the bus')}
                    </h3>
                    <div
                      className="ep-table-wrap"
                      tabIndex={0}
                      role="region"
                      aria-label={`${t(lang, 'School bus')} · ${c.name}`}
                    >
                      <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                        <caption className="ep-sr-only">
                          {t(lang, 'School bus')} · {c.name}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">{t(lang, 'Date')}</th>
                            <th scope="col">{t(lang, 'Morning')}</th>
                            <th scope="col">{t(lang, 'Afternoon')}</th>
                            <th scope="col">{t(lang, 'Route')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...b.days].reverse().map((d) => (
                            <tr key={d.date}>
                              <td>{dayText(d.date)}</td>
                              {[d.pick, d.drop].map((code, i) => (
                                <td key={String(i)}>
                                  {code ? (
                                    <Badge tone={BUS[code]?.[1] ?? 'neutral'}>
                                      {t(lang, BUS[code]?.[0] ?? code)}
                                    </Badge>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                              ))}
                              <td>{d.route}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </Card>
            );
          })
        : null}

      {view === 'year'
        ? mine(year.children).map((c) => (
            <Card
              key={c.id}
              title={`${c.name}${c.section ? ` · ${c.section}` : ''}`}
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              <Tiles
                lang={lang}
                days={c.total.days}
                present={c.total.present}
                absent={c.total.absent}
                leave={c.total.leave}
              />
              {c.total.days === 0 ? (
                <p className="ep-field__help">
                  {t(lang, 'No attendance marked in this session yet.')}
                </p>
              ) : (
                <>
                  <YearBars lang={lang} months={c.months} />
                  <Legend lang={lang} />
                  <div
                    className="ep-table-wrap"
                    tabIndex={0}
                    role="region"
                    aria-label={`${t(lang, 'Month by month')} · ${c.name}`}
                    style={{ marginTop: 'var(--sp-3)' }}
                  >
                    <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                      <caption className="ep-sr-only">
                        {t(lang, 'Month by month')} · {c.name}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">{t(lang, 'Month')}</th>
                          <th scope="col">{t(lang, 'School days')}</th>
                          <th scope="col">{t(lang, 'Present')}</th>
                          <th scope="col">{t(lang, 'Absent')}</th>
                          <th scope="col">{t(lang, 'On leave')}</th>
                          <th scope="col">{t(lang, 'Late')}</th>
                          <th scope="col">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.months.map((x) => {
                          const pct = pctOf(x.present, x.days);
                          return (
                            <tr key={x.month}>
                              <th scope="row">
                                <a
                                  href={`/attendance?month=${x.month}`}
                                  style={{ textDecoration: 'underline' }}
                                >
                                  {new Date(`${x.month}-01T00:00:00Z`).toLocaleDateString('en-IN', {
                                    month: 'long',
                                    year: 'numeric',
                                    timeZone: 'UTC',
                                  })}
                                </a>
                              </th>
                              <td>{x.days}</td>
                              <td>{x.present}</td>
                              <td>{x.absent}</td>
                              <td>{x.leave}</td>
                              <td>{x.late}</td>
                              <td>
                                {pct === null ? '–' : <Badge tone={pctTone(pct)}>{pct}%</Badge>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>
          ))
        : null}

      {view === 'leave' && leaves ? (
        <>
          {sp.ok ? (
            <div
              className="ep-alert ep-alert--success"
              role="status"
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              {sp.ok === 'applied'
                ? `${t(lang, 'Leave applied')}${sp.no ? ` (${sp.no})` : ''}. ${t(lang, 'It has gone for approval; the status shows below.')}`
                : t(lang, 'Leave cancelled.')}
            </div>
          ) : null}
          {sp.error ? (
            <div
              className="ep-alert ep-alert--danger"
              role="alert"
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              {sp.detail || sp.error}
            </div>
          ) : null}
          {kid && !readOnly ? (
            <Card
              title={`${t(lang, 'Apply for leave')} · ${kid.name}`}
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              <form action={applyLeave} id="apply" className="ep-hd__form">
                <input type="hidden" name="studentId" value={kid.id} />
                <div className="ep-hd__row">
                  <label className="ep-field">
                    <span className="ep-field__label">{t(lang, 'Type of leave')} *</span>
                    <select
                      className="ep-select"
                      name="leaveType"
                      required
                      defaultValue={sp.leaveType ?? ''}
                    >
                      <option value="" disabled>
                        {t(lang, 'Choose')}
                      </option>
                      {leaves.types.map((x) => (
                        <option key={x.value} value={x.value}>
                          {t(lang, x.label)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">{t(lang, 'First day')} *</span>
                    <input
                      className="ep-input"
                      type="date"
                      name="fromDate"
                      required
                      defaultValue={sp.fromDate ?? ''}
                    />
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">{t(lang, 'Last day')} *</span>
                    <input
                      className="ep-input"
                      type="date"
                      name="toDate"
                      required
                      defaultValue={sp.toDate ?? ''}
                    />
                  </label>
                </div>
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'Reason')} *</span>
                  <textarea
                    className="ep-input"
                    name="reason"
                    rows={3}
                    required
                    minLength={5}
                    maxLength={1000}
                    defaultValue={sp.reason ?? ''}
                  />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">
                    {t(lang, 'Certificate or letter (PDF or photo, up to 5 MB)')}
                  </span>
                  <input
                    className="ep-input"
                    type="file"
                    name="files"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    multiple
                  />
                  <span className="ep-field__help">
                    {leaves.types
                      .filter((x) => x.certificate && x.certificate !== 'never')
                      .map(
                        (x) =>
                          `${t(lang, x.label)}: ${
                            x.certificate === 'always'
                              ? t(lang, 'certificate always needed')
                              : `${t(lang, 'certificate needed for more than')} ${String(leaves.longDays)} ${t(lang, 'day(s)')}`
                          }`,
                      )
                      .join(' · ')}
                  </span>
                </label>
                <p className="ep-field__help" style={{ margin: 0 }}>
                  {t(lang, 'A leave of up to')} {leaves.longDays}{' '}
                  {t(
                    lang,
                    'day(s) is approved by the class teacher; a longer one also goes to the coordinator and the principal.',
                  )}{' '}
                  {t(lang, 'An approved leave is marked in class and bus attendance by itself.')}
                </p>
                <div>
                  <Button type="submit">{t(lang, 'Apply')}</Button>
                </div>
              </form>
            </Card>
          ) : null}
          <Card title={t(lang, 'Leave applied in this session')}>
            {myLeaves.length === 0 ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                {t(lang, 'No leave has been applied for yet.')}
              </p>
            ) : (
              myLeaves.map((l) => (
                <div
                  key={l.id}
                  style={{
                    borderBottom: '1px solid var(--border-strong)',
                    padding: 'var(--sp-3) 0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 'var(--sp-3)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <strong>
                        {t(lang, l.leaveTypeLabel)} ·{' '}
                        {l.fromDate === l.toDate
                          ? dayText(l.fromDate, true)
                          : `${dayText(l.fromDate)} – ${dayText(l.toDate, true)}`}
                      </strong>{' '}
                      <span className="ep-kicker">
                        {l.number} · {l.days} {t(lang, l.days === 1 ? 'day' : 'days')}
                        {l.long ? ` · ${t(lang, 'long leave')}` : ''}
                      </span>
                      <div>{l.reason}</div>
                      {l.fileIds.map((f, i) => (
                        <FileLinks
                          key={f}
                          url={`/api/attachment/leave/${l.id}/${f}`}
                          saveUrl={`/api/attachment/leave/${l.id}/${f}?save=1`}
                          label={`${t(lang, 'attachment')} ${String(i + 1)}`}
                        />
                      ))}
                      {l.decisionNote ? (
                        <div className="ep-field__help">
                          {t(lang, 'Note from the school')}: {l.decisionNote}
                        </div>
                      ) : null}
                      {l.endedOn ? (
                        <div className="ep-field__help">
                          {t(lang, 'Ended early: back at school from')} {dayText(l.endedOn, true)}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Badge tone={LEAVE_TONE[l.status] ?? 'neutral'}>
                        {l.status === 'pending' && l.waitingOn
                          ? `${t(lang, 'With')}: ${t(lang, l.waitingOn)}`
                          : t(lang, LEAVE_STATUS[l.status] ?? l.status)}
                      </Badge>
                      {!readOnly &&
                      (l.status === 'pending' ||
                        (l.status === 'approved' && !l.endedOn && l.toDate >= today())) ? (
                        <form action={cancelLeave} style={{ marginTop: 'var(--sp-2)' }}>
                          <input type="hidden" name="id" value={l.id} />
                          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                            {l.status === 'pending' || l.fromDate > today()
                              ? t(lang, 'Cancel this leave')
                              : t(lang, 'Child is back: end the leave today')}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </>
      ) : null}
    </main>
  );
}
