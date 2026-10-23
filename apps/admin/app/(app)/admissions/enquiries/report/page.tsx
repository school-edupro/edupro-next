import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { BarChart } from '@/components/charts/Charts';
import { apiFetch, getMe } from '@/lib/api';
import type { AdmissionCycle } from '@/lib/types';

interface Line {
  name?: string;
  enquiries: number;
  open: number;
  registered: number;
  admitted: number;
  lost: number;
  toRegistration: number;
  toAdmission: number;
}

/** Enquiry → registration → admission by source and class (docs/design/39, part 8). */
export default async function EnquiryReportPage({
  searchParams,
}: {
  searchParams: Promise<{ cycleId?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const cycles = await apiFetch<{ data: AdmissionCycle[] }>('/admissions/cycles').then(
    (r) => r.data,
  );
  const q = new URLSearchParams();
  if (sp.cycleId && /^\d{1,18}$/.test(sp.cycleId)) q.set('cycleId', sp.cycleId);
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) q.set('from', sp.from);
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) q.set('to', sp.to);
  const r = await apiFetch<{
    total: Line;
    bySource: Line[];
    byClass: Line[];
    registeredWithoutEnquiry: number;
  }>(`/admissions/enquiries/report?${q.toString()}`);
  const table = (title: string, rows: Line[]) => (
    <Card elevated title={title} style={{ marginBottom: 'var(--sp-4)' }}>
      <div className="ep-table-wrap">
        <table className="ep-table">
          <caption className="ep-sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">{title.replace('By ', '')}</th>
              <th scope="col">Enquiries</th>
              <th scope="col">Still open</th>
              <th scope="col">Registered</th>
              <th scope="col">Admitted</th>
              <th scope="col">Lost</th>
              <th scope="col">To registration</th>
              <th scope="col">To admission</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.name}>
                <th scope="row">{x.name}</th>
                <td>{x.enquiries}</td>
                <td>{x.open}</td>
                <td>{x.registered}</td>
                <td>{x.admitted}</td>
                <td>{x.lost}</td>
                <td>{x.toRegistration}%</td>
                <td>{x.toAdmission}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
  return (
    <>
      <PageHeader
        kicker="Admissions · Enquiries"
        title="Enquiry conversion"
        description="How many enquiries became registrations and admissions, by where they came from and by class."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/enquiries">
            Enquiries
          </a>
        }
      />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'end', flexWrap: 'wrap' }}
        >
          <label className="ep-field">
            <span className="ep-field__label">Session</span>
            <select className="ep-select" name="cycleId" defaultValue={sp.cycleId ?? ''}>
              <option value="">Every session</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Enquiries from</span>
            <input className="ep-input" type="date" name="from" defaultValue={sp.from ?? ''} />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">To</span>
            <input className="ep-input" type="date" name="to" defaultValue={sp.to ?? ''} />
          </label>
          <button className="ep-btn ep-btn--secondary" type="submit">
            Show
          </button>
        </form>
      </Card>
      <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
        <Card title="Enquiries">
          <div className="ep-cdash__big">{r.total.enquiries}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {r.total.open} still open
          </p>
        </Card>
        <Card title="Registered">
          <div className="ep-cdash__big">{r.total.registered}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {r.total.toRegistration}% of enquiries
          </p>
        </Card>
        <Card title="Admitted">
          <div className="ep-cdash__big">{r.total.admitted}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {r.total.toAdmission}% of enquiries
          </p>
        </Card>
        <Card title="Registered without an enquiry">
          <div className="ep-cdash__big">{r.registeredWithoutEnquiry}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            came straight to the portal or desk
          </p>
        </Card>
      </div>
      {table('By source', r.bySource)}
      {table('By class', r.byClass)}
      {r.bySource.length ? (
        <Card title="Enquiries and registrations by source">
          <BarChart
            title="Enquiries and registrations by source"
            data={r.bySource.map((x) => ({
              label: x.name ?? '',
              values: [x.enquiries, x.registered],
            }))}
            series={[
              { label: 'Enquiries', tone: 'navy' },
              { label: 'Registered', tone: 'cyan' },
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}
