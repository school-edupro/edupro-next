import type { ReactNode } from 'react';
import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { pageSizeOf } from '@/components/Pager';
import { Icon } from '@/components/nav-icons';
import { DialogButton } from '@/components/leave/DialogButton';
import { DownloadMenu, Pages, Showing, SizeLinks } from '@/components/leave/ListBar';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { DayVersions, PunchLog, PunchOverview, UnmatchedPunches } from '@/lib/leave';
import { assignPunchId, processPunches } from '@/lib/leave-actions';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
const TABS = [
  { id: 'department', label: 'Department', icon: 'users' },
  { id: 'history', label: 'Attendance History', icon: 'calendar' },
  { id: 'log', label: 'Attendance Log', icon: 'list' },
  { id: 'unmatched', label: 'Unmatched', icon: 'xCircle' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
/** dd-mm-yyyy hh:mm, India time */
const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(new Date(iso))
        .replace(/\//g, '-')
        .replace(',', '')
    : '—';
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * The staff punch log as the old Employee / Attendance Details (docs/design/85): the biometric machines
 * and the other punch sources at a glance (Process now), then Department (every raw punch of a department,
 * up to 31 days), Attendance History (every version of an employee's days, the one in force Active and the
 * ones it replaced InActive, with how the day was worked out), Attendance Log (one employee's raw punches,
 * up to 92 days) and Unmatched (an unknown ID's punches, given to an employee here; the double taps).
 */
export default async function StaffPunchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.punch_log.view')) notFound();
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : 'department';
  const today = istToday();
  const from = sp.from && DAY.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const to = sp.to && DAY.test(sp.to) ? sp.to : today;
  const department = sp.department?.slice(0, 100) ?? '';
  const employeeId = sp.employeeId && ID.test(sp.employeeId) ? sp.employeeId : '';
  const size = pageSizeOf(sp.size);
  const page = Math.max(1, Number(sp.page) || 1);
  const ov = await apiFetch<PunchOverview>('/staff-punches/overview');

  /** this page with these filters (and changes) */
  const href = (o: Record<string, string | number | null>) => {
    const p = new URLSearchParams({ tab, from, to });
    if (department) p.set('department', department);
    if (employeeId) p.set('employeeId', employeeId);
    if (size !== '50') p.set('size', size);
    for (const [k, v] of Object.entries(o))
      if (v === null || v === '') p.delete(k);
      else p.set(k, String(v));
    return `/attendance/punches?${p.toString()}`;
  };
  const here = href({ page: page > 1 ? page : null });

  let log: PunchLog | null = null;
  let versions: DayVersions | null = null;
  let unmatched: UnmatchedPunches | null = null;
  let error: string | null = null;
  const pick = tab === 'department' ? !!department : tab === 'unmatched' ? true : !!employeeId;
  if (pick)
    try {
      if (tab === 'department' || tab === 'log') {
        const q = new URLSearchParams({ from, to, size, page: String(page) });
        if (tab === 'department') q.set('department', department);
        else q.set('employeeId', employeeId);
        log = await apiFetch<PunchLog>(`/staff-punches/log?${q.toString()}`);
      } else if (tab === 'history')
        versions = await apiFetch<DayVersions>(
          `/staff-punches/versions?${new URLSearchParams({ employeeId, from, to }).toString()}`,
        );
      else
        unmatched = await apiFetch<UnmatchedPunches>(
          `/staff-punches/unmatched?${new URLSearchParams({ from, to }).toString()}`,
        );
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) notFound();
      if (e instanceof ApiError)
        error = typeof e.problem.detail === 'string' ? e.problem.detail : 'Could not load it.';
      else throw e;
    }
  const file = (list: 'punches' | 'versions', format: 'xlsx' | 'pdf') => {
    const p = new URLSearchParams({ list, format, from, to });
    if (list === 'punches' && tab === 'department') p.set('department', department);
    else p.set('employeeId', employeeId);
    return `/api/leave/list-file?${p.toString()}`;
  };
  const unknownCount = ov.devices.reduce((a, d) => a + d.unknown, 0);
  const waiting =
    ov.devices.reduce((a, d) => a + d.waiting, 0) + ov.others.reduce((a, o) => a + o.waiting, 0);

  const dates = (idp: string, cap: string) => (
    <>
      <label className="ep-field" htmlFor={`${idp}-from`}>
        <span className="ep-field__label">
          Start Date<span aria-hidden="true"> *</span>
        </span>
        <input
          id={`${idp}-from`}
          name="from"
          type="date"
          className="ep-input"
          defaultValue={from}
          required
        />
      </label>
      <label className="ep-field" htmlFor={`${idp}-to`}>
        <span className="ep-field__label">
          End Date<span aria-hidden="true"> *</span>
        </span>
        <input
          id={`${idp}-to`}
          name="to"
          type="date"
          className="ep-input"
          defaultValue={to}
          required
        />
        <span className="ep-field__help">{cap}</span>
      </label>
    </>
  );
  const employeeSelect = (idp: string) => (
    <label className="ep-field" htmlFor={`${idp}-emp`}>
      <span className="ep-field__label">
        Employee<span aria-hidden="true"> *</span>
      </span>
      <select
        id={`${idp}-emp`}
        name="employeeId"
        className="ep-select"
        defaultValue={employeeId}
        required
      >
        <option value="">Select employee</option>
        {ov.lists.employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} ({e.code})
          </option>
        ))}
      </select>
    </label>
  );
  const filter = (children: ReactNode) => (
    <form method="get" action="/attendance/punches" className="ep-card ep-pfilter">
      <input type="hidden" name="tab" value={tab} />
      {size !== '50' ? <input type="hidden" name="size" value={size} /> : null}
      <div className="ep-pfilter__row">
        {children}
        <div className="ep-pfilter__go">
          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
            Search
          </button>
        </div>
      </div>
    </form>
  );
  const prompt = (words: string) => (
    <p className="ep-pprompt" role="status">
      {words}
    </p>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee leave & attendance', href: '/leave/dashboard' },
          { label: 'Staff punches' },
        ]}
      />
      <PageHeader
        kicker="Biometric log"
        title="Employee / Attendance Details"
        description="Every punch the machines and the uploads brought in, how each day was set and changed, and the punches nobody could be matched to."
      />
      <Notice params={sp} />

      <section className="ep-pdev" aria-label="Where the punches come from">
        {ov.devices.map((d) => {
          const fresh = !!d.lastSeen && Date.now() - Date.parse(d.lastSeen) < 86_400_000;
          return (
            <article key={d.id} className="ep-pdev__card">
              <header className="ep-pdev__head">
                <span className="ep-pdev__ic" aria-hidden="true">
                  <Icon name="clock" size={18} />
                </span>
                <span className="ep-pdev__name">
                  <strong>{d.name}</strong>
                  <span className="ep-mr-col__desc">
                    {d.code} · biometric{d.status !== 'active' ? ` · ${d.status}` : ''}
                  </span>
                </span>
                <span className={`ep-stage ${fresh ? 'ep-stage--ok' : 'ep-stage--off'}`}>
                  {fresh ? 'In touch' : `Last seen ${when(d.lastSeen)}`}
                </span>
              </header>
              <dl className="ep-pdev__facts">
                <div>
                  <dt>Today</dt>
                  <dd>{d.today}</dd>
                </div>
                <div>
                  <dt>Last punch</dt>
                  <dd>{when(d.lastPunch)}</dd>
                </div>
                <div>
                  <dt>Waiting</dt>
                  <dd>{d.waiting}</dd>
                </div>
                <div>
                  <dt>Unknown IDs, 30 days</dt>
                  <dd>
                    {d.unknown ? (
                      <a href={href({ tab: 'unmatched', page: null })}>{d.unknown}</a>
                    ) : (
                      0
                    )}
                  </dd>
                </div>
              </dl>
            </article>
          );
        })}
        <article className="ep-pdev__card">
          <header className="ep-pdev__head">
            <span className="ep-pdev__ic" aria-hidden="true">
              <Icon name="upload" size={18} />
            </span>
            <span className="ep-pdev__name">
              <strong>Other sources</strong>
              <span className="ep-mr-col__desc">central sync, sheet uploads, by hand</span>
            </span>
          </header>
          {ov.others.length ? (
            <ul className="ep-pdev__list">
              {ov.others.map((o) => (
                <li key={o.source}>
                  <strong>{o.words}</strong>: {o.punches.toLocaleString('en-IN')} punches · last{' '}
                  {when(o.last)}
                  {o.waiting ? ` · ${String(o.waiting)} waiting` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help" style={{ margin: 0 }}>
              None yet.
            </p>
          )}
          {ov.can.process ? (
            <form action={processPunches} className="ep-pdev__run">
              <input type="hidden" name="back" value={here} />
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                Process now{waiting ? ` (${String(waiting)} waiting)` : ''}
              </button>
              <span className="ep-field__help" style={{ margin: 0 }}>
                Works new punches into their days (the system does it every few minutes).
              </span>
            </form>
          ) : null}
        </article>
      </section>

      <div className="ep-tabs">
        <div role="tablist" aria-label="Staff punches" className="ep-tabs__list">
          {TABS.map((t) => (
            <a
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className="ep-tabs__tab"
              href={href({ tab: t.id, page: null })}
            >
              <Icon name={t.icon} size={16} /> {t.label}
              {t.id === 'unmatched' && unknownCount ? ` (${String(unknownCount)})` : ''}
            </a>
          ))}
        </div>
      </div>

      {tab === 'department'
        ? filter(
            <>
              <label className="ep-field" htmlFor="pd-dept">
                <span className="ep-field__label">
                  Department<span aria-hidden="true"> *</span>
                </span>
                <select
                  id="pd-dept"
                  name="department"
                  className="ep-select"
                  defaultValue={department}
                  required
                >
                  <option value="">Select Department</option>
                  {ov.lists.departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              {dates('pd', 'Up to 31 days: every punch of everyone in it.')}
            </>,
          )
        : tab === 'history'
          ? filter(
              <>
                {employeeSelect('ph')}
                {dates('ph', 'Up to 92 days.')}
              </>,
            )
          : tab === 'log'
            ? filter(
                <>
                  {employeeSelect('pl')}
                  {dates('pl', 'Up to 92 days.')}
                </>,
              )
            : filter(dates('pu', 'The unknown IDs and the double taps in these dates.'))}

      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          <span>{error}</span>
        </p>
      ) : null}

      {!pick
        ? prompt(
            tab === 'department'
              ? 'Pick a department and a date range, then Search.'
              : 'Pick an employee and a date range, then Search.',
          )
        : null}

      {log ? (
        <section aria-label={tab === 'department' ? 'Department punches' : 'Attendance log'}>
          <p className="ep-field__help" role="status">
            {log.words}: <strong>{log.figures.n.toLocaleString('en-IN')}</strong> punches
            {log.mode === 'department' ? ` by ${String(log.figures.people)} people` : ''} on{' '}
            {log.figures.days} days
            {log.figures.waiting
              ? ` · ${String(log.figures.waiting)} not yet worked into their days`
              : ' · all worked into their days'}
            .
          </p>
          <div className="ep-listbar">
            <SizeLinks
              size={log.size}
              sizeHref={(s) => href({ size: s === '50' ? null : s, page: null })}
              noun="punches"
            />
            <div className="ep-listbar__end">
              <Showing page={log.page} size={log.size} total={log.total} />
              <DownloadMenu xlsx={file('punches', 'xlsx')} pdf={file('punches', 'pdf')} />
            </div>
          </div>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={tab === 'department' ? 'Punches of the department' : 'Punches'}
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">S.No.</th>
                  {log.mode === 'department' ? <th scope="col">Employee</th> : null}
                  <th scope="col">Date</th>
                  <th scope="col">Day</th>
                  <th scope="col">Punch Time</th>
                  <th scope="col">Device</th>
                  <th scope="col">Source</th>
                  <th scope="col">Processed</th>
                  <th scope="col">Day Marked</th>
                </tr>
              </thead>
              <tbody>
                {log.rows.length ? (
                  log.rows.map((r, i) => (
                    <tr key={r.id}>
                      <td>{(log.page - 1) * log.size + i + 1}</td>
                      {log.mode === 'department' ? (
                        <td>
                          <strong>{r.employee.name}</strong>
                          <span className="ep-mr-col__desc">{r.employee.code}</span>
                        </td>
                      ) : null}
                      <td style={{ whiteSpace: 'nowrap' }}>{dmy(r.day)}</td>
                      <td>{r.weekday}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <strong>{r.time}</strong>
                      </td>
                      <td>{r.device ?? '—'}</td>
                      <td>{r.sourceWords}</td>
                      <td>
                        <span
                          className={`ep-stage ${r.processed ? 'ep-stage--ok' : 'ep-stage--l2'}`}
                        >
                          {r.processed ? 'Processed' : 'Waiting'}
                        </span>
                      </td>
                      <td>
                        {r.marked ? (
                          <a
                            href={`/leave/attendance/day?emp=${r.employee.id}&day=${r.day}`}
                            title="Open the day"
                          >
                            {r.marked}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={log.mode === 'department' ? 9 : 8}>No punches in these dates.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pages
            page={log.page}
            size={log.size}
            total={log.total}
            href={(p) => href({ page: p > 1 ? p : null })}
            noun="punches"
          />
        </section>
      ) : null}

      {versions ? (
        <section aria-label="Attendance history">
          <p className="ep-note">
            Every version of a day, not just the one in force. The current entry is{' '}
            <strong>Active</strong>; each earlier version it replaced is listed under it as{' '}
            <strong>InActive</strong>. One Active entry per date — the record to trust when a punch,
            a leave or a correction is disputed.
          </p>
          <div className="ep-listbar">
            <p className="ep-listbar__count" role="status">
              {versions.words}: {versions.days} days, {versions.changed} changed after they were
              first set.
            </p>
            <div className="ep-listbar__end">
              <DownloadMenu xlsx={file('versions', 'xlsx')} pdf={file('versions', 'pdf')} />
            </div>
          </div>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Versions of the days"
          >
            <table className="ep-table ep-table--dense ep-pver">
              <thead>
                <tr>
                  <th scope="col">S.No.</th>
                  <th scope="col">Date</th>
                  <th scope="col">Day</th>
                  <th scope="col">Attendance</th>
                  <th scope="col">In Time</th>
                  <th scope="col">Out Time</th>
                  <th scope="col">Status</th>
                  <th scope="col">Marked By</th>
                  <th scope="col">Marked Datetime</th>
                  <th scope="col">Remark</th>
                  <th scope="col" style={{ textAlign: 'center' }}>
                    Trace
                  </th>
                </tr>
              </thead>
              <tbody>
                {versions.rows.length ? (
                  versions.rows.map((r, i) => (
                    <tr
                      key={`${r.day}-${String(i)}`}
                      className={r.active ? undefined : 'ep-pver--old'}
                    >
                      <td>{i + 1}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <a href={`/leave/attendance/day?emp=${versions.employee.id}&day=${r.day}`}>
                          {dmy(r.day)}
                        </a>
                      </td>
                      <td>{r.weekday}</td>
                      <td>
                        <strong>{r.attendance || '—'}</strong>
                      </td>
                      <td>{r.in || '—'}</td>
                      <td>{r.out || '—'}</td>
                      <td>
                        <span className={`ep-stage ${r.active ? 'ep-stage--ok' : 'ep-stage--off'}`}>
                          {r.active ? 'Active' : 'InActive'}
                        </span>
                      </td>
                      <td>{r.by}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                      <td>{r.remark || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        {r.trace?.length ? (
                          <DialogButton
                            id={`pv-${String(i)}`}
                            className="ep-iconbtn"
                            tip="How this day was worked out"
                            title={`How ${dmy(r.day)} was worked out`}
                            label={
                              <>
                                <Icon name="eye" size={18} />
                                <span className="ep-sr-only">How {dmy(r.day)} was worked out</span>
                              </>
                            }
                          >
                            <dl className="ep-ptrace">
                              {r.trace.map(([k, v]) => (
                                <div key={k}>
                                  <dt>{k}</dt>
                                  <dd>{v}</dd>
                                </div>
                              ))}
                            </dl>
                          </DialogButton>
                        ) : (
                          <span
                            className="ep-mr-col__desc"
                            style={{ display: 'inline' }}
                            title={
                              r.active
                                ? 'Set without a calculation'
                                : 'The calculation is kept for the version in force only'
                            }
                          >
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11}>No days recorded in these dates.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {unmatched ? (
        <section aria-label="Unmatched punches">
          <p className="ep-note">
            <strong>Unknown ID</strong>: the machine read a finger or card that is on nobody’s
            record — a new joiner’s, or one mistyped on the machine. Give it to the employee and
            their punches are matched and the days worked out again. <strong>Double tap</strong>: a
            second punch within a minute of the first; it is kept here and not counted.
          </p>
          <p className="ep-listbar__count" role="status">
            {dmy(unmatched.from)} to {dmy(unmatched.to)}:{' '}
            {unmatched.unknown.toLocaleString('en-IN')} punches of unknown IDs ·{' '}
            {unmatched.double.toLocaleString('en-IN')} double taps.
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Unmatched punches">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">ID on the Machine</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Device</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Punches
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Days
                  </th>
                  <th scope="col">First</th>
                  <th scope="col">Last</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.rows.length ? (
                  unmatched.rows.map((r, i) => (
                    <tr key={`${r.id}-${r.kind}-${String(i)}`}>
                      <td>
                        <strong>{r.id}</strong>
                      </td>
                      <td>
                        <span
                          className={`ep-stage ${r.kind === 'unknown' ? 'ep-stage--no' : 'ep-stage--off'}`}
                        >
                          {r.kind === 'unknown' ? 'Unknown ID' : 'Double tap'}
                        </span>
                      </td>
                      <td>{r.device}</td>
                      <td style={{ textAlign: 'right' }}>{r.punches}</td>
                      <td style={{ textAlign: 'right' }}>{r.days}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{when(r.first)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{when(r.last)}</td>
                      <td>
                        {r.employee ? (
                          <>
                            <strong>{r.employee.name}</strong>
                            <span className="ep-mr-col__desc">{r.employee.code}</span>
                          </>
                        ) : r.holder ? (
                          <span>Now on {r.holder}’s record</span>
                        ) : (
                          <span className="ep-mr-col__desc" style={{ display: 'inline' }}>
                            On nobody’s record
                          </span>
                        )}
                      </td>
                      <td>
                        {r.kind === 'unknown' && unmatched.can.assign ? (
                          <DialogButton
                            id={`pu-${String(i)}`}
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            title={`Give ${r.id} to an employee`}
                            label={r.holder ? 'Match the punches' : 'Give to employee'}
                          >
                            <form action={assignPunchId} className="ep-form-section__body">
                              <input type="hidden" name="back" value={here} />
                              <input type="hidden" name="biometricId" value={r.id} />
                              <p className="ep-field__help" style={{ marginTop: 0 }}>
                                {r.punches} punches on {r.days} days from {r.device}. The ID goes on
                                the employee’s record, the punches become theirs and those days are
                                worked out again (not in a month locked for payroll).
                              </p>
                              <label className="ep-field" htmlFor={`pu-${String(i)}-emp`}>
                                <span className="ep-field__label">Employee</span>
                                <select
                                  id={`pu-${String(i)}-emp`}
                                  name="employeeId"
                                  className="ep-select"
                                  required
                                  defaultValue=""
                                >
                                  <option value="">Select employee</option>
                                  {ov.lists.employees
                                    .filter((e) =>
                                      r.holder ? e.biometricId === r.id : !e.biometricId,
                                    )
                                    .map((e) => (
                                      <option key={e.id} value={e.id}>
                                        {e.name} ({e.code})
                                      </option>
                                    ))}
                                </select>
                                <span className="ep-field__help">
                                  Only staff with no ID on the machine yet.
                                </span>
                              </label>
                              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                                Match the punches
                              </button>
                            </form>
                          </DialogButton>
                        ) : (
                          <span className="ep-mr-col__desc" style={{ display: 'inline' }}>
                            {r.kind === 'double' ? 'Not counted' : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9}>Every punch in these dates was matched.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
