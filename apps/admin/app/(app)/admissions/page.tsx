import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BarChart, DonutChart, type ChartTone } from '@/components/charts/Charts';
import { rupees } from '@/lib/admission-desk';
import { apiFetch, getMe } from '@/lib/api';

interface Overview {
  cycles: Array<{ id: string; name: string; status: string }>;
  session: { id: string; name: string; status: string } | null;
  figures?: Record<
    | 'started'
    | 'submitted'
    | 'registered'
    | 'drafts'
    | 'feeDue'
    | 'inProcess'
    | 'sentBack'
    | 'atTest'
    | 'offered'
    | 'waitlisted'
    | 'feePaid'
    | 'admitted'
    | 'rejected'
    | 'cancelled'
    | 'desk'
    | 'registrationFees'
    | 'admissionFees'
    | 'refunds',
    number
  >;
  byClass?: Array<{
    classId: string;
    className: string;
    seats: number;
    registered: number;
    inProcess: number;
    offered: number;
    waitlisted: number;
    confirmed: number;
    admitted: number;
    cancelled: number;
  }>;
  daily?: Array<{ day: string; registrations: number; collected: number }>;
  byCategory?: Array<{ name: string; n: number }>;
}

const TONES: ChartTone[] = ['navy', 'cyan', 'success', 'warning', 'info', 'danger', 'muted'];

/**
 * The admissions dashboard (docs/design/39, part 7): figures first (registrations, fees, where the
 * candidates are, admitted, cancelled), then the funnel per class against its seats, then small charts.
 */
export default async function AdmissionsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cycleId?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const o = await apiFetch<Overview>(
    `/admissions/overview${sp.cycleId && /^\d{1,18}$/.test(sp.cycleId) ? `?cycleId=${sp.cycleId}` : ''}`,
  );
  const f = o.figures;
  // registrations waiting for this user's decision (docs/design/47): a line above the figures
  const decides = ['admissions.application.decide', 'admissions.setup.manage'].some((p) =>
    me.permissions.includes(p),
  );
  const mine = decides
    ? await apiFetch<{ total: number; overdue: number }>(
        '/admissions/registrations/mine?size=1',
      ).catch(() => ({ total: 0, overdue: 0 }))
    : { total: 0, overdue: 0 };
  const tile = (title: string, value: string | number, help: string, href?: string) => {
    const body = (
      <Card title={title}>
        <div className="ep-cdash__big">{value}</div>
        <p className="ep-field__help" style={{ margin: 0 }}>
          {help}
        </p>
      </Card>
    );
    return href ? (
      <a
        key={title}
        href={href}
        className="ep-tile-link"
        aria-label={`${title}: ${String(value)}. Open the list`}
      >
        {body}
      </a>
    ) : (
      <div key={title}>{body}</div>
    );
  };
  // the registrations list filtered on this session (and statuses, by their list labels)
  const list = (status?: string) => {
    const q = new URLSearchParams({ session: o.session?.name ?? '' });
    if (status) q.set('status', status);
    return `/admissions/registrations?${q.toString()}`;
  };
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Admissions dashboard"
        description={
          o.session
            ? `${o.session.name}: registrations, fees and where every candidate stands.`
            : 'No admission session yet.'
        }
        actions={
          o.cycles.length > 1 ? (
            <form method="get" style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'end' }}>
              <label className="ep-field">
                <span className="ep-field__label">Session</span>
                <select className="ep-select" name="cycleId" defaultValue={o.session?.id ?? ''}>
                  {o.cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="ep-btn ep-btn--secondary ep-btn--sm" type="submit">
                Show
              </button>
            </form>
          ) : undefined
        }
      />
      {mine.total ? (
        <p
          className={`ep-alert ep-alert--${mine.overdue ? 'warning' : 'info'}`}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {mine.total} registration{mine.total === 1 ? '' : 's'} wait
          {mine.total === 1 ? 's' : ''} for your decision
          {mine.overdue ? ` (${String(mine.overdue)} past the time limit)` : ''}.{' '}
          <a href="/admissions/registrations?tab=mine">Open Waiting for me</a>
        </p>
      ) : null}
      {f ? (
        <>
          <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
            {tile(
              'Registered',
              f.registered,
              `${String(f.desk)} at the desk · ${String(f.feeDue)} fee due · ${String(f.drafts)} forms open`,
              list(),
            )}
            {tile(
              'Fees collected',
              rupees(f.registrationFees + f.admissionFees - f.refunds),
              `registration ${rupees(f.registrationFees)} · admission ${rupees(f.admissionFees)}`,
              '/admissions/fee-collection',
            )}
            {tile(
              'In process',
              f.inProcess,
              `${String(f.atTest)} at a test or interview · ${String(f.sentBack)} sent back`,
              `/admissions/registrations?tab=in_progress`,
            )}
            {tile(
              'Offered',
              f.offered,
              `${String(f.waitlisted)} on the waiting list`,
              list('Offered|Waiting list'),
            )}
            {tile('Admission fee paid', f.feePaid, 'waiting to be admitted', '/admissions/admit')}
            {tile('Admitted', f.admitted, 'in the student master', list('Admitted'))}
            {tile('Not selected', f.rejected, 'closed at a step', list('Not selected'))}
            {tile(
              'Cancelled',
              f.cancelled,
              f.refunds ? `refunds paid ${rupees(f.refunds)}` : 'no refund paid',
              list('Cancelled'),
            )}
          </div>
          <Card elevated title="By class" style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="ep-table-wrap">
              <table className="ep-table">
                <caption className="ep-sr-only">Admissions by class</caption>
                <thead>
                  <tr>
                    <th scope="col">Class</th>
                    <th scope="col">Seats</th>
                    <th scope="col">Registered</th>
                    <th scope="col">In process</th>
                    <th scope="col">Offered</th>
                    <th scope="col">Waiting list</th>
                    <th scope="col">Fee paid</th>
                    <th scope="col">Admitted</th>
                    <th scope="col">Seats left</th>
                  </tr>
                </thead>
                <tbody>
                  {(o.byClass ?? []).map((k) => (
                    <tr key={k.classId}>
                      <th scope="row">
                        <a
                          href={`/admissions/selection?cycleId=${o.session!.id}&classId=${k.classId}`}
                        >
                          {k.className}
                        </a>
                      </th>
                      <td>{k.seats}</td>
                      <td>{k.registered}</td>
                      <td>{k.inProcess}</td>
                      <td>{k.offered}</td>
                      <td>{k.waitlisted}</td>
                      <td>{k.confirmed}</td>
                      <td>{k.admitted}</td>
                      <td>{Math.max(k.seats - k.confirmed - k.offered, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
              gap: 'var(--sp-4)',
            }}
          >
            <Card title="Registrations, last 30 days">
              <BarChart
                title="Registrations per day, last 30 days"
                data={(o.daily ?? []).map((d) => ({ label: d.day, values: [d.registrations] }))}
                series={[{ label: 'Registrations', tone: 'navy' }]}
              />
            </Card>
            <Card title="Registered by fee category">
              <DonutChart
                title="Registered by fee category"
                parts={(o.byCategory ?? []).map((c, i) => ({
                  label: c.name,
                  value: c.n,
                  tone: TONES[i % TONES.length]!,
                }))}
                centre={String(f.registered)}
                caption="registered"
              />
            </Card>
          </div>
        </>
      ) : (
        <Card>
          No admission session yet. Start one at <a href="/admissions/cycles">Admission sessions</a>
          .
        </Card>
      )}
    </>
  );
}
