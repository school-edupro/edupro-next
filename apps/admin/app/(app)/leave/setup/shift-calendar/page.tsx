import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ShiftCalendarGrid } from '@/components/leave/ShiftCalendarGrid';
import { ShiftLog } from '@/components/leave/ShiftLog';
import { ApiError, apiFetch } from '@/lib/api';
import type { ShiftCalendar, ShiftLogPage } from '@/lib/leave';

const SIZES = ['25', '50', '100', '500'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const words = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ''} ${m.slice(0, 4)}`;
const step = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const t = y * 12 + (mo - 1) + n;
  return `${String(Math.floor(t / 12))}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/**
 * The shift calendar (Leave & attendance set-up, beside Shifts and Shift postings): a month of who works
 * which shift each day, in the shift's colour, with week-offs and holidays; staff with no shift posted
 * tagged (and a filter for them); post a shift to the ticked staff for days or one day, change a day,
 * copy a month onto another; filters, a page at a time, Excel and PDF; the change log of every posting.
 */
export default async function ShiftCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === 'log' ? 'log' : 'calendar';
  const page = Math.max(1, Number(sp.page) || 1);
  const size = SIZES.includes(sp.size ?? '') ? Number(sp.size) : 50;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const department = (sp.department ?? '').trim().slice(0, 100);
  const month = MONTH.test(sp.month ?? '') ? sp.month! : '';
  const shiftId = /^\d{1,18}$/.test(sp.shift ?? '') ? sp.shift! : '';
  const unposted = sp.unposted === '1';
  const from = tab === 'log' && DAY.test(sp.from ?? '') ? sp.from! : '';
  const to = tab === 'log' && DAY.test(sp.to ?? '') ? sp.to! : '';

  const filters = new URLSearchParams();
  if (q) filters.set('q', q);
  if (department) filters.set('department', department);
  if (tab === 'calendar') {
    if (month) filters.set('month', month);
    if (shiftId) filters.set('shiftId', shiftId);
    if (unposted) filters.set('unposted', '1');
  } else {
    if (from) filters.set('from', from);
    if (to) filters.set('to', to);
  }
  const paged = `${filters.toString()}&page=${String(page)}&size=${String(size)}`;

  let cal: ShiftCalendar;
  let log: ShiftLogPage | null = null;
  try {
    [cal, log] = await Promise.all([
      apiFetch<ShiftCalendar>(
        tab === 'calendar'
          ? `/staff-attendance/shift-calendar?${paged}`
          : `/staff-attendance/shift-calendar?size=25${month ? `&month=${month}` : ''}`,
      ),
      tab === 'log'
        ? apiFetch<ShiftLogPage>(`/staff-attendance/shift-calendar/log?${paged}`)
        : Promise.resolve(null),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const keep = new URLSearchParams({ tab, size: String(size) });
  for (const [k, v] of filters.entries()) keep.set(k === 'shiftId' ? 'shift' : k, v);
  if (tab === 'calendar') keep.set('month', cal.month);
  const pageUrl = (n: number) => `/leave/setup/shift-calendar?${keep.toString()}&page=${String(n)}`;
  const monthUrl = (m: string) => {
    const k = new URLSearchParams(keep);
    k.set('month', m);
    return `/leave/setup/shift-calendar?${k.toString()}`;
  };
  const total = (tab === 'log' ? log! : cal).page.total;
  const pages = Math.max(1, Math.ceil(total / size));
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(total, page * size);
  const filtered = Boolean(q || department || shiftId || unposted || from || to);
  const fileFilters = new URLSearchParams(filters);
  if (tab === 'calendar') fileFilters.set('month', cal.month);
  const fileUrl = (format: 'xlsx' | 'pdf') =>
    `/api/leave/${tab === 'log' ? 'shift-log-file' : 'shift-calendar-file'}?${fileFilters.toString()}&format=${format}`;
  const def = cal.shifts.find((s) => s.id === cal.defaultShiftId);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Shift calendar' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Shift calendar"
        description="Who works which shift, day by day: post a shift to many staff for some days, change one day, or copy last month’s roster."
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--ghost" href="/masters/leave?tab=staff_shifts">
              Shifts
            </a>
            <a className="ep-btn ep-btn--ghost" href="/masters/leave?tab=staff_shift_postings">
              Shift postings
            </a>
          </div>
        }
      />
      <Notice params={sp} />

      <div className="ep-tabs">
        <div role="tablist" aria-label="Shift calendar" className="ep-tabs__list">
          <a
            role="tab"
            aria-selected={tab === 'calendar'}
            className="ep-tabs__tab"
            href={`/leave/setup/shift-calendar${month ? `?month=${month}` : ''}`}
          >
            Calendar
          </a>
          <a
            role="tab"
            aria-selected={tab === 'log'}
            className="ep-tabs__tab"
            href="/leave/setup/shift-calendar?tab=log"
          >
            Change log
          </a>
        </div>
      </div>

      <section className="ep-card" aria-label={tab === 'log' ? 'Change log' : 'Shift calendar'}>
        <form method="get" className="ep-master__filter" aria-label="Filter">
          <input type="hidden" name="tab" value={tab} />
          {tab === 'calendar' ? (
            <label className="ep-field" htmlFor="sc-month">
              <span className="ep-field__label">Month</span>
              <input
                id="sc-month"
                name="month"
                type="month"
                className="ep-input"
                defaultValue={cal.month}
              />
            </label>
          ) : null}
          <label className="ep-field" htmlFor="sc-q">
            <span className="ep-field__label">Employee</span>
            <input
              id="sc-q"
              name="q"
              type="search"
              className="ep-input"
              maxLength={80}
              defaultValue={q}
              placeholder={tab === 'log' ? 'Employee, shift or who changed' : 'Name or code'}
            />
          </label>
          <label className="ep-field" htmlFor="sc-dept">
            <span className="ep-field__label">Department</span>
            <select id="sc-dept" name="department" className="ep-select" defaultValue={department}>
              <option value="">All departments</option>
              {cal.departments.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          {tab === 'calendar' ? (
            <>
              <label className="ep-field" htmlFor="sc-shiftf">
                <span className="ep-field__label">Shift</span>
                <select id="sc-shiftf" name="shift" className="ep-select" defaultValue={shiftId}>
                  <option value="">All shifts</option>
                  {cal.shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-check ep-shiftcal__unposted" htmlFor="sc-unposted">
                <input
                  id="sc-unposted"
                  name="unposted"
                  type="checkbox"
                  value="1"
                  defaultChecked={unposted}
                />{' '}
                No shift posted only
              </label>
            </>
          ) : (
            <>
              <label className="ep-field" htmlFor="sc-from">
                <span className="ep-field__label">Changed from</span>
                <input
                  id="sc-from"
                  name="from"
                  type="date"
                  className="ep-input"
                  defaultValue={from}
                />
              </label>
              <label className="ep-field" htmlFor="sc-to">
                <span className="ep-field__label">to</span>
                <input
                  id="sc-to"
                  name="to"
                  type="date"
                  className="ep-input"
                  defaultValue={to}
                  min={from || undefined}
                />
              </label>
            </>
          )}
          <label className="ep-field" htmlFor="sc-size">
            <span className="ep-field__label">Records per page</span>
            <select id="sc-size" name="size" className="ep-select" defaultValue={String(size)}>
              {SIZES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Apply
          </button>
          {filtered ? (
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/leave/setup/shift-calendar?tab=${tab}${tab === 'calendar' ? `&month=${cal.month}` : ''}`}
            >
              Clear
            </a>
          ) : null}
        </form>

        {tab === 'calendar' ? (
          <>
            <div className="ep-shiftcal__monthnav">
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={monthUrl(step(cal.month, -1))}>
                ‹ {words(step(cal.month, -1))}
              </a>
              <h2 className="ep-card__title">{words(cal.month)}</h2>
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={monthUrl(step(cal.month, 1))}>
                {words(step(cal.month, 1))} ›
              </a>
            </div>
            <ul className="ep-shiftcal__legend" aria-label="Legend">
              {cal.shifts.map((s) => (
                <li key={s.id}>
                  <span
                    className="ep-shiftcal__cell ep-shiftcal__cell--posted"
                    style={{ ['--sc' as string]: s.colour }}
                    aria-hidden="true"
                  >
                    {s.code}
                  </span>{' '}
                  {s.name} {s.starts_at}–{s.ends_at}
                  {s.id === cal.defaultShiftId ? ' (default)' : ''}
                </li>
              ))}
              {def ? (
                <li>
                  <span
                    className="ep-shiftcal__cell ep-shiftcal__cell--default"
                    style={{ ['--sc' as string]: def.colour }}
                    aria-hidden="true"
                  >
                    {def.code}
                  </span>{' '}
                  Default shift, none posted
                </li>
              ) : null}
              <li>
                <span
                  className="ep-shiftcal__cell ep-shiftcal__cell--day"
                  style={{ ['--sc' as string]: def?.colour ?? '#475569' }}
                  aria-hidden="true"
                >
                  {def?.code ?? 'GEN'}
                </span>{' '}
                For that day only
              </li>
              <li>
                <span className="ep-shiftcal__cell ep-shiftcal__cell--wo" aria-hidden="true">
                  WO
                </span>{' '}
                Weekly off
              </li>
              <li>
                <span className="ep-shiftcal__cell ep-shiftcal__cell--h" aria-hidden="true">
                  H
                </span>{' '}
                Holiday
              </li>
            </ul>
            {cal.locked ? (
              <p className="ep-alert ep-alert--warning" role="note">
                <span>{words(cal.month)} is locked for payroll: its past days cannot change.</span>
              </p>
            ) : null}
          </>
        ) : null}

        <div className="ep-master__toolbar">
          <div className="ep-master__count">
            Showing {first} to {last} of {total} {tab === 'log' ? 'changes' : 'employees'}
            {filtered ? ' (filtered)' : ''} · page {page} of {pages}
            {tab === 'calendar' && cal.counts.unposted && !unposted ? (
              <>
                {' · '}
                <a
                  href={`/leave/setup/shift-calendar?month=${cal.month}&unposted=1`}
                  style={{ textDecoration: 'underline' }}
                >
                  {cal.counts.unposted} with no shift posted
                </a>
              </>
            ) : null}
          </div>
          <div className="ep-master__actions">
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={fileUrl('xlsx')} download>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={fileUrl('pdf')} download>
              PDF
            </a>
          </div>
        </div>

        {tab === 'log' && log ? (
          <ShiftLog log={log} first={first} />
        ) : (
          <ShiftCalendarGrid
            key={`${cal.month}-${String(page)}`}
            cal={cal}
            can={cal.can.manage}
            q={q}
            department={department}
          />
        )}
        <nav className="ep-master__pager" aria-label="Pagination">
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageUrl(page - 1)}>
              ‹ Previous
            </a>
          ) : (
            <span />
          )}
          <span className="ep-field__help">
            {page} / {pages}
          </span>
          {page < pages ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageUrl(page + 1)}>
              Next ›
            </a>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </>
  );
}
