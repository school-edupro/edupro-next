import { Badge, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { approveAppointment } from '@/lib/appointment-actions';
import {
  SOURCE_LABEL,
  STATE_LABEL,
  STATE_TONE,
  when,
  whoOf,
  type AppointmentList,
  type BookableHost,
} from '@/lib/appointments';

type Search = {
  state?: string;
  hostId?: string;
  source?: string;
  from?: string;
  to?: string;
  q?: string;
  order?: string;
  size?: string;
  page?: string;
  ok?: string;
  error?: string;
  detail?: string;
};

const SIZES = ['10', '25', '50', '100'];
const STATES: Array<{ value: string; label: string }> = [
  { value: 'open', label: 'Waiting for the front desk' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Confirmed, still to come' },
  { value: 'checked_in', label: 'Inside now' },
  { value: 'all', label: 'Everything' },
  { value: 'completed', label: 'Completed' },
  { value: 'no_show', label: 'Did not come' },
  { value: 'rejected', label: 'Not confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The front-desk queue (0059): what is waiting, today, still to come and inside now, latest first, with
 * filters, pages and Excel. A waiting request is confirmed here in one click or opened to decline or move.
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const state = STATES.some((s) => s.value === sp.state) ? sp.state! : 'open';
  const size = SIZES.includes(sp.size ?? '') ? sp.size! : '25';
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = Object.fromEntries(
    Object.entries({
      state: state === 'all' ? undefined : state,
      hostId: /^\d{1,18}$/.test(sp.hostId ?? '') ? sp.hostId : undefined,
      source: ['parent', 'public', 'front_desk'].includes(sp.source ?? '') ? sp.source : undefined,
      from: DATE.test(sp.from ?? '') ? sp.from : undefined,
      to: DATE.test(sp.to ?? '') ? sp.to : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
      order: sp.order === 'time' ? 'time' : undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  /** A link to this list that keeps the filters. */
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({
      ...filters,
      state,
      ...(size === '25' ? {} : { size }),
      ...extra,
    }).toString();
  const [me, list, hosts] = await Promise.all([
    getMe(),
    apiFetch<AppointmentList>(
      `/appointments?${new URLSearchParams({ ...filters, size, page: String(page) }).toString()}`,
    ),
    apiFetch<{ data: BookableHost[] }>('/appointments/hosts'),
  ]);
  const canDecide = me.permissions.includes('engagement.appointment.decide');
  const pages = Math.max(1, Math.ceil(list.page.total / list.page.size));
  const here = `/engagement/appointments?${qs({ page: String(page) })}`;
  const tabs: Array<[string, string, number | null]> = [
    ['open', 'Waiting', list.counts.open],
    ['today', 'Today', list.counts.today],
    ['upcoming', 'To come', list.counts.upcoming],
    ['checked_in', 'Inside now', list.counts.inside],
    ['all', 'Everything', null],
  ];
  return (
    <>
      <PageHeader
        kicker="Appointments"
        title="Front desk"
        description="Requests from parents and outside visitors. Confirm, decline or give a new time; the visitor is told."
        actions={
          canDecide ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/engagement/appointments/new">
              Book an appointment
            </a>
          ) : null
        }
      />
      <AppointmentNav current="/engagement/appointments" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {tabs.map(([value, label, n]) => (
          <a
            key={value}
            href={`/engagement/appointments?state=${value}`}
            aria-current={state === value ? 'page' : undefined}
          >
            {label}
            {n === null ? '' : ` · ${String(n)}`}
          </a>
        ))}
      </nav>
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <SelectField
            id="ap-state"
            name="state"
            label="Show"
            defaultValue={state}
            options={STATES}
          />
          <SelectField
            id="ap-host"
            name="hostId"
            label="To meet"
            defaultValue={filters.hostId ?? ''}
            options={[
              { value: '', label: 'Anyone' },
              ...hosts.data.map((h) => ({ value: h.id, label: h.name })),
            ]}
          />
          <SelectField
            id="ap-source"
            name="source"
            label="Booked from"
            defaultValue={filters.source ?? ''}
            options={[
              { value: '', label: 'Anywhere' },
              ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          <label className="ep-field" htmlFor="ap-from">
            <span className="ep-field__label">Visit from</span>
            <input
              id="ap-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={filters.from ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="ap-to">
            <span className="ep-field__label">Visit to</span>
            <input
              id="ap-to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={filters.to ?? ''}
            />
          </label>
          <label className="ep-field ep-dlog__search" htmlFor="ap-q">
            <span className="ep-field__label">Number, visitor, mobile, student or purpose</span>
            <input
              id="ap-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={filters.q ?? ''}
              maxLength={80}
            />
          </label>
          <SelectField
            id="ap-order"
            name="order"
            label="Order"
            defaultValue={filters.order ?? 'latest'}
            options={[
              { value: 'latest', label: 'Latest booked first' },
              { value: 'time', label: 'By visit time' },
            ]}
          />
          <SelectField
            id="ap-size"
            name="size"
            label="Rows per page"
            defaultValue={size}
            options={SIZES.map((v) => ({ value: v, label: v }))}
          />
          <Button type="submit">Show</Button>
        </form>
      </div>
      <Card>
        <div className="ep-hd__listhead">
          <p className="ep-field__help" style={{ margin: 0 }} aria-live="polite">
            {list.page.total
              ? `${String(list.page.total)} ${list.page.total === 1 ? 'appointment' : 'appointments'}`
              : 'No appointments for these filters.'}
          </p>
          {list.page.total ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/appointments/report?${new URLSearchParams(filters).toString()}`}
              download
            >
              Excel
            </a>
          ) : null}
        </div>
        {list.data.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Appointments">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Appointments</caption>
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">Visitor</th>
                  <th scope="col">To meet</th>
                  <th scope="col">Visit time</th>
                  <th scope="col">Purpose</th>
                  <th scope="col">Status</th>
                  <th scope="col">Booked</th>
                  <th scope="col">
                    <span className="ep-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <a href={`/engagement/appointments/${a.id}`}>{a.number}</a>
                    </td>
                    <td>
                      {whoOf(a)}
                      <div className="ep-field__help">
                        {[
                          a.visitorMobile,
                          a.visitorOrg,
                          a.partySize > 1 ? `${String(a.partySize)} people` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>
                      {a.hostName ?? '—'}
                      {a.withName ? <div className="ep-field__help">{a.withName}</div> : null}
                    </td>
                    <td>
                      {a.startsAt ? (
                        when(a.startsAt)
                      ) : (
                        <span className="ep-field__help">
                          No slot yet
                          {a.preferredSlots.length
                            ? ` · asked ${a.preferredSlots.map((x) => x.replace('T', ' ')).join(', ')}`
                            : ''}
                        </span>
                      )}
                      {a.place ? <div className="ep-field__help">{a.place}</div> : null}
                    </td>
                    <td>{a.purpose}</td>
                    <td>
                      <Badge tone={STATE_TONE[a.state]}>{STATE_LABEL[a.state]}</Badge>
                      {a.rescheduleCount ? <div className="ep-field__help">moved</div> : null}
                    </td>
                    <td className="ep-field__help">
                      {SOURCE_LABEL[a.source]}
                      <div>{when(a.createdAt)}</div>
                    </td>
                    <td>
                      {a.state === 'requested' && a.startsAt && canDecide ? (
                        <form action={approveAppointment}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="returnTo" value={here} />
                          <Button type="submit" size="sm" aria-label={`Confirm ${a.number}`}>
                            Confirm
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {pages > 1 ? (
          <nav className="ep-grid__pager ep-dlog__pager" aria-label="Pages">
            {page > 1 ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`?${qs({ page: String(page - 1) })}`}
              >
                ← Previous
              </a>
            ) : null}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`?${qs({ page: String(page + 1) })}`}
              >
                Next →
              </a>
            ) : null}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
